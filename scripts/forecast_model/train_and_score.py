#!/usr/bin/env python3
"""
Trains a fresh LightGBM quantile price model each run (no model persistence
needed — training takes seconds) and writes a 7-day forecast per area to
Cloudflare KV, which functions/api/[[catchall]].js reads with a fallback to
the seasonal heuristic in buildForecast() if this is missing or stale.

Why retrain from scratch every run instead of persisting a model: training on
~10 months of hourly data takes a few seconds with LightGBM, and always using
the freshest data removes any need for model versioning/staleness handling.

Feature design (see /Users/cc/elpriser/memory `price-forecasting-analysis.md`
for the full history — this replaces the old hand-picked wind/solar
correction constant that Phase 0 found was actively hurting accuracy):
  - hour/weekday/month/is_weekend + lag7/14/21/28 + trailing 4-week seasonal
    average, all in raw spot DKK/MWh (mode conversion happens in JS at read
    time via cvtForecast(), same as the existing heuristic).
  - estimated_production: NOT hindsight actual production (which doesn't
    exist yet at forecast time). Instead, a small regression
    (production_mw ~ wind_speed_100m + direct_radiation + month) is fit once
    per run against Open-Meteo's ARCHIVE api (real historical weather
    observations) vs EDS actual production, then applied consistently to
    BOTH historical training rows (using archived actual weather) and future
    rows (using Open-Meteo's live forecast). This keeps train/serve
    consistent: the feature is always "weather-derived estimate", differing
    only in whether the weather number is observed or forecast.
  - JAO congestion data is deliberately NOT used here: it was found to only
    be available ~1 day ahead of delivery (a day-ahead calculation, not a
    multi-day forecast), so it can't help a T+2..T+6 forecast.

Live accuracy monitoring: before generating today's forecast, this script
also scores yesterday's stored prediction against the now-known actual price
and appends to a rolling error log in KV (`forecast-model-monitoring`),
since Open-Meteo doesn't archive historical forecasts and we can't backtest
this exact pipeline offline.
"""
import json
import os
import sys
import urllib.request
import urllib.parse
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
import lightgbm as lgb

AREAS = ["DK1", "DK2"]
COORDS = {"DK1": (56.0, 9.5), "DK2": (55.5, 12.0)}
TRAIN_LOOKBACK_DAYS = 300  # ~10 months
MONITOR_KEEP_DAYS = 60

CF_ACCOUNT_ID = os.environ["CLOUDFLARE_ACCOUNT_ID"]
CF_API_TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
CF_KV_NAMESPACE_ID = os.environ["CLOUDFLARE_KV_NAMESPACE_ID"]


def fetch_json(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def fetch_day_ahead_prices(area, start, end):
    f = urllib.parse.quote(json.dumps({"PriceArea": area}))
    url = (f"https://api.energidataservice.dk/dataset/DayAheadPrices"
           f"?start={start}&end={end}&filter={f}&sort=TimeDK%20asc&limit=0")
    j = fetch_json(url)
    buckets = {}
    for r in j.get("records", []):
        dt = r["TimeDK"][:10]
        h = int(r["TimeDK"][11:13])
        buckets.setdefault(dt, {}).setdefault(h, []).append(r["DayAheadPriceDKK"])
    return {dt: {h: sum(v) / len(v) for h, v in hours.items()} for dt, hours in buckets.items()}


def fetch_production(area, start, end):
    f = urllib.parse.quote(json.dumps({"PriceArea": area}))
    url = (f"https://api.energidataservice.dk/dataset/ProductionConsumptionSettlement"
           f"?start={start}&end={end}&filter={f}&limit=0")
    j = fetch_json(url)
    out = {}
    for r in j.get("records", []):
        dt = r["HourDK"][:10]
        h = int(r["HourDK"][11:13])
        wind = (r.get("OffshoreWindLt100MW_MWh") or 0) + (r.get("OffshoreWindGe100MW_MWh") or 0) \
             + (r.get("OnshoreWindLt50kW_MWh") or 0) + (r.get("OnshoreWindGe50kW_MWh") or 0)
        solar = (r.get("SolarPowerLt10kW_MWh") or 0) + (r.get("SolarPowerGe10Lt40kW_MWh") or 0) \
              + (r.get("SolarPowerGe40kW_MWh") or 0) + (r.get("SolarPowerSelfConMWh") or 0)
        out[f"{dt}:{h}"] = wind + solar
    return out


def fetch_archive_weather(lat, lon, start, end):
    url = (f"https://archive-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lon}"
           f"&start_date={start}&end_date={end}&hourly=wind_speed_100m,direct_radiation"
           f"&timezone=Europe/Copenhagen")
    j = fetch_json(url)
    out = {}
    times = j.get("hourly", {}).get("time", [])
    wind = j.get("hourly", {}).get("wind_speed_100m", [])
    solar = j.get("hourly", {}).get("direct_radiation", [])
    for i, t in enumerate(times):
        dt = t[:10]
        h = int(t[11:13])
        w = wind[i] if i < len(wind) and wind[i] is not None else np.nan
        s = solar[i] if i < len(solar) and solar[i] is not None else np.nan
        out[f"{dt}:{h}"] = (w, s)
    return out


def fetch_forecast_weather(lat, lon):
    url = (f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
           f"&hourly=wind_speed_100m,direct_radiation&forecast_days=8&timezone=Europe/Copenhagen")
    j = fetch_json(url)
    out = {}
    times = j.get("hourly", {}).get("time", [])
    wind = j.get("hourly", {}).get("wind_speed_100m", [])
    solar = j.get("hourly", {}).get("direct_radiation", [])
    for i, t in enumerate(times):
        dt = t[:10]
        h = int(t[11:13])
        out[f"{dt}:{h}"] = (wind[i], solar[i])
    return out


def kv_get(key):
    url = (f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}"
           f"/storage/kv/namespaces/{CF_KV_NAMESPACE_ID}/values/{urllib.parse.quote(key)}")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {CF_API_TOKEN}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def kv_put(key, value, expiration_ttl=None):
    url = (f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}"
           f"/storage/kv/namespaces/{CF_KV_NAMESPACE_ID}/values/{urllib.parse.quote(key)}")
    if expiration_ttl:
        url += f"?expiration_ttl={expiration_ttl}"
    body = json.dumps(value).encode()
    req = urllib.request.Request(url, data=body, method="PUT", headers={
        "Authorization": f"Bearer {CF_API_TOKEN}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read())
    if not resp.get("success"):
        raise RuntimeError(f"KV put failed for {key}: {resp}")


def fit_production_estimator(weather_by_key, production_by_key):
    """production_mw ~ wind_speed_100m + direct_radiation + month, fit on archived actual weather."""
    rows = []
    for key, (wind, solar) in weather_by_key.items():
        prod = production_by_key.get(key)
        if prod is None or np.isnan(wind) or np.isnan(solar):
            continue
        month = int(key.split(":")[0].split("-")[1])
        rows.append({"wind_speed_100m": wind, "direct_radiation": solar, "month": month, "production_mw": prod})
    df = pd.DataFrame(rows)
    if len(df) < 100:
        raise RuntimeError(f"Not enough overlapping weather/production rows to fit estimator: {len(df)}")
    model = lgb.LGBMRegressor(n_estimators=100, num_leaves=15, learning_rate=0.1, verbosity=-1)
    model.fit(df[["wind_speed_100m", "direct_radiation", "month"]], df["production_mw"])
    return model


def build_training_frame(prices, estimated_production_by_key):
    rows = []
    all_dates = sorted(prices.keys())
    for ds in all_dates:
        d = date.fromisoformat(ds)
        wd = d.weekday()
        for h in range(24):
            raw = prices[ds].get(h)
            if raw is None:
                continue

            def lag(days_back):
                dd = (d - timedelta(days=days_back)).isoformat()
                return prices.get(dd, {}).get(h, np.nan)

            lag7, lag14, lag21, lag28 = lag(7), lag(14), lag(21), lag(28)
            seasonal4w = np.nanmean([lag7, lag14, lag21, lag28])
            est_prod = estimated_production_by_key.get(f"{ds}:{h}", np.nan)

            rows.append({
                "date": ds, "hour": h, "weekday": wd, "month": d.month,
                "is_weekend": 1 if wd >= 5 else 0,
                "lag7": lag7, "lag14": lag14, "lag21": lag21, "lag28": lag28,
                "seasonal4w": seasonal4w, "est_production": est_prod,
                "spot_dkk_mwh": raw,
            })
    return pd.DataFrame(rows)


FEATURES = ["hour", "weekday", "month", "is_weekend", "lag7", "lag14", "lag21", "lag28", "seasonal4w", "est_production"]


def train_quantile_models(df):
    train = df.dropna(subset=FEATURES + ["spot_dkk_mwh"])
    models = {}
    for alpha, name in [(0.1, "low"), (0.5, "median"), (0.9, "high")]:
        m = lgb.LGBMRegressor(objective="quantile", alpha=alpha, n_estimators=300,
                               num_leaves=15, min_child_samples=20, learning_rate=0.05, verbosity=-1)
        m.fit(train[FEATURES], train["spot_dkk_mwh"])
        models[name] = m
    return models


def score_future_days(prices, models, estimated_production_by_key, today):
    """Predict spot price for the next 7 days (today..today+6). Days with an
    already-published actual price are marked 'actual' and use the real
    value; the rest use the model."""
    rows = []
    dates_with_price = set(prices.keys())
    for offset in range(7):
        d = today + timedelta(days=offset)
        ds = d.isoformat()
        wd = d.weekday()
        is_actual = ds in dates_with_price and len(prices[ds]) > 12
        hours_out = []
        for h in range(24):
            if is_actual:
                raw = prices[ds].get(h)
                hours_out.append({"hour": h, "spot_dkk_mwh": raw})
                continue

            def lag(days_back):
                dd = (d - timedelta(days=days_back)).isoformat()
                return prices.get(dd, {}).get(h, np.nan)
            lag7, lag14, lag21, lag28 = lag(7), lag(14), lag(21), lag(28)
            seasonal4w = np.nanmean([lag7, lag14, lag21, lag28])
            est_prod = estimated_production_by_key.get(f"{ds}:{h}", np.nan)
            feat = pd.DataFrame([{
                "hour": h, "weekday": wd, "month": d.month, "is_weekend": 1 if wd >= 5 else 0,
                "lag7": lag7, "lag14": lag14, "lag21": lag21, "lag28": lag28,
                "seasonal4w": seasonal4w, "est_production": est_prod,
            }])
            if feat.isna().any(axis=None):
                hours_out.append({"hour": h, "spot_dkk_mwh": None})
                continue
            median = float(models["median"].predict(feat)[0])
            low = float(models["low"].predict(feat)[0])
            high = float(models["high"].predict(feat)[0])
            hours_out.append({
                "hour": h,
                "spot_dkk_mwh": round(median, 2),
                "spot_min_dkk_mwh": round(min(low, median), 2),
                "spot_max_dkk_mwh": round(max(high, median), 2),
            })
        rows.append({"date": ds, "type": "actual" if is_actual else "forecast", "weekday": wd, "prices": hours_out})
    return rows


def update_monitoring_log(area, days, today):
    """Compare what we predicted for `today` in a prior run against the now-known actual price."""
    log_key = f"forecast-model-monitoring-{area}"
    log = kv_get(log_key) or []

    prev = kv_get(f"forecast-model-{area}")
    if prev:
        prev_today_entry = next((d for d in prev.get("days", []) if d["date"] == today.isoformat()), None)
        if prev_today_entry and prev_today_entry["type"] == "forecast":
            actual_today = next((d for d in days if d["date"] == today.isoformat()), None)
            if actual_today and actual_today["type"] == "actual":
                errs = []
                for p_pred, p_actual in zip(prev_today_entry["prices"], actual_today["prices"]):
                    if p_pred.get("spot_dkk_mwh") is not None and p_actual.get("spot_dkk_mwh") is not None:
                        errs.append(abs(p_pred["spot_dkk_mwh"] - p_actual["spot_dkk_mwh"]))
                if errs:
                    log.append({
                        "date": today.isoformat(),
                        "mae_dkk_mwh": round(sum(errs) / len(errs), 2),
                        "n_hours": len(errs),
                    })

    cutoff = (today - timedelta(days=MONITOR_KEEP_DAYS)).isoformat()
    log = [e for e in log if e["date"] >= cutoff]
    kv_put(log_key, log)
    return log


def main():
    today = datetime.now(timezone.utc).date()
    lookback_start = (today - timedelta(days=TRAIN_LOOKBACK_DAYS)).isoformat()
    fetch_end = (today + timedelta(days=1)).isoformat()

    for area in AREAS:
        print(f"=== {area} ===")
        lat, lon = COORDS[area]

        print("Fetching EDS day-ahead prices...")
        prices = fetch_day_ahead_prices(area, lookback_start, fetch_end)
        print(f"  {len(prices)} days")

        print("Fetching EDS actual production...")
        production = fetch_production(area, lookback_start, fetch_end)

        print("Fetching Open-Meteo archive weather (for fitting production estimator)...")
        archive_end = min(today - timedelta(days=1), today).isoformat()
        weather_hist = fetch_archive_weather(lat, lon, lookback_start, archive_end)

        print("Fitting weather -> production estimator...")
        prod_estimator = fit_production_estimator(weather_hist, production)

        est_production_by_key = {}
        for key, (wind, solar) in weather_hist.items():
            if np.isnan(wind) or np.isnan(solar):
                continue
            month = int(key.split(":")[0].split("-")[1])
            est_production_by_key[key] = float(prod_estimator.predict(
                pd.DataFrame([{"wind_speed_100m": wind, "direct_radiation": solar, "month": month}]))[0])

        print("Fetching Open-Meteo LIVE forecast (for scoring the next 7 days)...")
        weather_fc = fetch_forecast_weather(lat, lon)
        for key, (wind, solar) in weather_fc.items():
            if wind is None or solar is None:
                continue
            month = int(key.split(":")[0].split("-")[1])
            est_production_by_key[key] = float(prod_estimator.predict(
                pd.DataFrame([{"wind_speed_100m": wind, "direct_radiation": solar, "month": month}]))[0])

        print("Building training frame + training quantile models...")
        train_df = build_training_frame(prices, est_production_by_key)
        models = train_quantile_models(train_df)

        print("Scoring next 7 days...")
        days = score_future_days(prices, models, est_production_by_key, today)

        print("Updating live-monitoring log...")
        log = update_monitoring_log(area, days, today)
        if log:
            recent_mae = sum(e["mae_dkk_mwh"] for e in log) / len(log)
            print(f"  monitoring log: {len(log)} entries, avg MAE {recent_mae:.2f} DKK/MWh")

        output = {"area": area, "generated": today.isoformat(), "generatedAt": datetime.now(timezone.utc).isoformat(), "days": days}
        kv_put(f"forecast-model-{area}", output, expiration_ttl=7 * 86400)
        print(f"  wrote forecast-model-{area} to KV")


if __name__ == "__main__":
    main()
