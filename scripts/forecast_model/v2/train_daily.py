#!/usr/bin/env python3
"""Prognosemodel v2 — daglig træning + scoring. Kører på DGX Spark via cron.

Fire horisonter, tre modeller, én kørsel:
  - T+2..T+9 timeopløst: LGBM-kvantiler på lead-korrekt vejr (previous-runs-
    arkivet), prislags kendte ved udgivelsestid, temperatur (efterspørgsel),
    DK+DE vejr→produktions-estimater. Efterbehandling: hybrid = modellens
    døgnniveau + 50/50 formblanding med sæsonprofilen (backtest: vinder på
    både MAE og min-time-hitrate) + konformal kvantil-udvidelse
    (calibration_hourly.json — LGBM-kvantiler var ~2x for smalle).

Backtest-facit (rullende origin 2025-04→2026-07, se memory):
  time-MAE 27-33 % (heuristik: 35-36 %), min-time-hitrate 70/69 %
  (heuristik 67/68 %), båndene rammer 80 % dækning efter kalibrering.

KV-nøgler: forecast-v2-{area} (samme days-skema som v1 → worker-overlay
genbruges) og forecast-v2-monitoring-{area}.
Fallback-kæden i workeren er uændret: v2 → v1 (GitHub Actions) → heuristik,
så en død Spark degraderer stille og roligt.

Kræver: ~/.config/elpriser.env med CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
import lightgbm as lgb

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dataset as ds  # genbruger builder + estimatorer, samme kode som backtesten

V2DIR = os.path.dirname(os.path.abspath(__file__))
BACKUP = os.path.expanduser("~/elpriser-data-backup")
AREAS = ["DK1", "DK2"]
COORDS = {"dk1": (56.0, 9.5), "dk2": (55.5, 12.0), "de": (54.0, 9.5)}
KV_NAMESPACE = "126700e66e8d4a19b289b0e8afdaff69"

FEATS = ["h", "hour", "weekday", "month", "is_weekend", "doy_sin", "doy_cos",
         "lag1", "lag2", "lag3", "lag7", "lag14", "lag21", "lag28",
         "seasonal4w", "last_day_mean",
         "est_prod", "est_prod_de", "wind", "rad", "wind_de", "rad_de", "temp"]

CAL_H = json.load(open(f"{V2DIR}/calibration_hourly.json"))


def env_creds():
    path = os.path.expanduser("~/.config/elpriser.env")
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))
    return os.environ["CLOUDFLARE_ACCOUNT_ID"], os.environ["CLOUDFLARE_API_TOKEN"]


def fetch_json(url, tries=5, timeout=120):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return json.loads(r.read())
        except Exception as e:
            if i == tries - 1:
                raise
            wait = 30 * (i + 1) if "429" in str(e) else 15
            print(f"    retry om {wait}s: {e}", flush=True)
            time.sleep(wait)


def kv_put(key, value, ttl, account, token):
    url = (f"https://api.cloudflare.com/client/v4/accounts/{account}"
           f"/storage/kv/namespaces/{KV_NAMESPACE}/values/{urllib.parse.quote(key)}?expiration_ttl={ttl}")
    req = urllib.request.Request(url, data=json.dumps(value).encode(), method="PUT",
                                 headers={"Authorization": f"Bearer {token}",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read())
    if not resp.get("success"):
        raise RuntimeError(f"KV put fejlede for {key}: {resp}")


def kv_get(key, account, token):
    url = (f"https://api.cloudflare.com/client/v4/accounts/{account}"
           f"/storage/kv/namespaces/{KV_NAMESPACE}/values/{urllib.parse.quote(key)}")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


# ─── inkrementel dataopdatering ─────────────────────────────────────────────

def refresh_prices():
    """Seneste 40 dages DayAheadPrices → append til parquet-spejlene."""
    start = (date.today() - timedelta(days=40)).isoformat()
    end = (date.today() + timedelta(days=2)).isoformat()
    for area in AREAS:
        f = urllib.parse.quote(json.dumps({"PriceArea": area}))
        j = fetch_json(f"https://api.energidataservice.dk/dataset/DayAheadPrices"
                       f"?start={start}&end={end}&filter={f}&limit=0")
        new = pd.DataFrame(j.get("records", []))
        if not len(new):
            raise RuntimeError(f"ingen friske priser for {area}")
        path = f"{BACKUP}/eds_dayaheadprices_{area.lower()}.parquet"
        old = pd.read_parquet(path)
        merged = (pd.concat([old, new[old.columns.intersection(new.columns)]])
                    .drop_duplicates(subset=["TimeDK"], keep="last"))
        merged.to_parquet(path, index=False)
        print(f"  priser {area}: +{len(new)} rækker → {len(merged):,}", flush=True)
        time.sleep(5)


def refresh_production():
    """Seneste 60 dages produktion (estimator-target) — EDS publicerer med uger
    af forsinkelse, så vi henter rullende og tager hvad der er."""
    start = (date.today() - timedelta(days=60)).isoformat()
    end = date.today().isoformat()
    for area in AREAS:
        f = urllib.parse.quote(json.dumps({"PriceArea": area}))
        try:
            j = fetch_json(f"https://api.energidataservice.dk/dataset/ProductionConsumptionSettlement"
                           f"?start={start}&end={end}&filter={f}&limit=0")
        except Exception as e:
            print(f"  produktion {area} sprunget over: {e}", flush=True)
            continue
        new = pd.DataFrame(j.get("records", []))
        if not len(new):
            continue
        path = f"{BACKUP}/eds_productionconsumptionsettlement_{area.lower()}.parquet"
        old = pd.read_parquet(path)
        merged = (pd.concat([old, new[old.columns.intersection(new.columns)]])
                    .drop_duplicates(subset=["HourDK"], keep="last"))
        merged.to_parquet(path, index=False)
        print(f"  produktion {area}: nu {len(merged):,} rækker", flush=True)
        time.sleep(5)


def _append_weather(path, frames_getter, dedupe_col="time"):
    old = pd.read_parquet(path)
    last = pd.to_datetime(old[dedupe_col]).max().date()
    fetch_from = last - timedelta(days=2)
    fetch_to = date.today() - timedelta(days=1)
    if fetch_from >= fetch_to:
        return
    new = frames_getter(fetch_from.isoformat(), fetch_to.isoformat())
    if new is None or not len(new):
        return
    merged = pd.concat([old, new]).drop_duplicates(dedupe_col, keep="last")
    merged.to_parquet(path, index=False)
    print(f"  {os.path.basename(path)}: → {len(merged):,} timer", flush=True)


def refresh_weather():
    prev_vars = ",".join(f"{v}_previous_day{d}" for v in ("wind_speed_100m", "direct_radiation")
                         for d in range(1, 8))
    temp_prev = ",".join(f"temperature_2m_previous_day{d}" for d in range(1, 8))
    for name, (lat, lon) in COORDS.items():
        _append_weather(f"{V2DIR}/weather_prev_{name}.parquet", lambda s, e: pd.DataFrame(
            fetch_json(f"https://previous-runs-api.open-meteo.com/v1/forecast?latitude={lat}"
                       f"&longitude={lon}&hourly={prev_vars}&start_date={s}&end_date={e}"
                       f"&timezone=Europe/Copenhagen").get("hourly", {})))
        _append_weather(f"{V2DIR}/temp_prev_{name}.parquet", lambda s, e: pd.DataFrame(
            fetch_json(f"https://previous-runs-api.open-meteo.com/v1/forecast?latitude={lat}"
                       f"&longitude={lon}&hourly={temp_prev}&start_date={s}&end_date={e}"
                       f"&timezone=Europe/Copenhagen").get("hourly", {})))
        _append_weather(f"{V2DIR}/weather_actual_{name}.parquet", lambda s, e: pd.DataFrame(
            fetch_json(f"https://archive-api.open-meteo.com/v1/archive?latitude={lat}"
                       f"&longitude={lon}&hourly=wind_speed_100m,direct_radiation"
                       f"&start_date={s}&end_date={e}&timezone=Europe/Copenhagen").get("hourly", {})))
        time.sleep(3)


def fetch_live_forecast(name):
    """Live vejrprognose 10 dage frem: vind, sol, temp — som DataFrame med t-indeks."""
    lat, lon = COORDS[name]
    j = fetch_json(f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
                   f"&hourly=wind_speed_100m,direct_radiation,temperature_2m"
                   f"&forecast_days=10&timezone=Europe/Copenhagen")
    df = pd.DataFrame(j.get("hourly", {}))
    df["t"] = pd.to_datetime(df["time"])
    return df.set_index("t").drop(columns=["time"])


# ─── scoring ────────────────────────────────────────────────────────────────

def seasonal_curve(prices, today):
    """(weekday, hour) → gennemsnit over de sidste 28 kendte dage. Samme
    definition som seasonal4w-featuren; bruges også til hybrid-formen."""
    hist = prices[(prices.index >= pd.Timestamp(today) - pd.Timedelta(days=28))
                  & (prices.index < pd.Timestamp(today) + pd.Timedelta(days=2))]
    df = pd.DataFrame({"p": hist, "wd": hist.index.weekday, "h": hist.index.hour})
    return df.groupby(["wd", "h"]).p.mean()


def score_area(area, models, prices, est, est_de, live_w, live_w_de, today):
    """Bygger days-payload D+0..D+9 i v1-skemaet."""
    sc = seasonal_curve(prices, today)
    day_mean = prices.groupby(prices.index.normalize()).mean()
    days_out = []
    for offset in range(10):
        d = today + timedelta(days=offset)
        ds_ = d.isoformat()
        day_prices = prices[prices.index.normalize() == pd.Timestamp(d)]
        is_actual = len(day_prices) > 12
        h = offset  # horisont ift. i dag; modellen er trænet på h=2..9
        if is_actual or h < 2:
            hours = [{"hour": hh, "spot_dkk_mwh": (round(float(day_prices[day_prices.index.hour == hh].mean()), 2)
                                                    if len(day_prices[day_prices.index.hour == hh]) else None)}
                     for hh in range(24)]
            days_out.append({"date": ds_, "type": "actual" if is_actual else "forecast",
                             "weekday": d.weekday(), "prices": hours})
            continue

        rows = []
        for hh in range(24):
            t = pd.Timestamp(d) + pd.Timedelta(hours=hh)
            def lag(k):
                v = prices.get(t - pd.Timedelta(days=k), np.nan)
                return v if k >= h - 1 else np.nan
            lags = {f"lag{k}": lag(k) for k in (1, 2, 3, 7, 14, 21, 28)}
            lkd = pd.Timestamp(d) - pd.Timedelta(days=h - 1)
            wrow = live_w.reindex([t]); wde = live_w_de.reindex([t])
            month = d.month
            est_p = (float(est.predict(pd.DataFrame([{"wind_speed_100m": wrow.wind_speed_100m.iloc[0],
                     "direct_radiation": wrow.direct_radiation.iloc[0], "month": month}]))[0])
                     if wrow.notna().all(axis=None) else np.nan)
            est_p_de = (float(est_de.predict(pd.DataFrame([{"wind_speed_100m": wde.wind_speed_100m.iloc[0],
                        "direct_radiation": wde.direct_radiation.iloc[0], "month": month}]))[0])
                        if wde.notna().all(axis=None) else np.nan)
            rows.append({"h": h, "hour": hh, "weekday": d.weekday(), "month": month,
                         "is_weekend": 1 if d.weekday() >= 5 else 0,
                         "doy_sin": np.sin(2 * np.pi * d.timetuple().tm_yday / 365.25),
                         "doy_cos": np.cos(2 * np.pi * d.timetuple().tm_yday / 365.25),
                         **lags,
                         "seasonal4w": np.nanmean([lags["lag7"], lags["lag14"], lags["lag21"], lags["lag28"]]),
                         "last_day_mean": day_mean.get(lkd, np.nan),
                         "est_prod": est_p, "est_prod_de": est_p_de,
                         "wind": wrow.wind_speed_100m.iloc[0], "rad": wrow.direct_radiation.iloc[0],
                         "wind_de": wde.wind_speed_100m.iloc[0], "rad_de": wde.direct_radiation.iloc[0],
                         "temp": wrow.temperature_2m.iloc[0]})
        X = pd.DataFrame(rows)[FEATS]
        md = models["md"].predict(X); lo = models["lo"].predict(X); hi = models["hi"].predict(X)

        # hybrid: modellens døgnniveau + 50/50 form (model / sæsonprofil)
        se = np.array([sc.get((d.weekday(), hh), np.nan) for hh in range(24)])
        if np.isnan(se).any():
            hyb = md
        else:
            hyb = md.mean() + 0.5 * ((md - md.mean()) + (se - se.mean()))
        f = CAL_H[area.lower()][str(h)]
        lo_c = hyb - f * (md - lo)
        hi_c = hyb + f * (hi - md)
        days_out.append({"date": ds_, "type": "forecast", "weekday": d.weekday(),
                         "prices": [{"hour": hh, "spot_dkk_mwh": round(float(hyb[hh]), 2),
                                     "spot_min_dkk_mwh": round(float(min(lo_c[hh], hyb[hh])), 2),
                                     "spot_max_dkk_mwh": round(float(max(hi_c[hh], hyb[hh])), 2)}
                                    for hh in range(24)]})
    return days_out


def update_monitoring(area, days, today, account, token):
    log_key = f"forecast-v2-monitoring-{area}"
    log = kv_get(log_key, account, token) or []
    prev = kv_get(f"forecast-v2-{area}", account, token)
    if prev:
        pd_entry = next((x for x in prev.get("days", []) if x["date"] == today.isoformat()), None)
        act = next((x for x in days if x["date"] == today.isoformat()), None)
        if pd_entry and pd_entry["type"] == "forecast" and act and act["type"] == "actual":
            errs = [abs(a["spot_dkk_mwh"] - b["spot_dkk_mwh"])
                    for a, b in zip(pd_entry["prices"], act["prices"])
                    if a.get("spot_dkk_mwh") is not None and b.get("spot_dkk_mwh") is not None]
            if errs:
                log.append({"date": today.isoformat(), "mae_dkk_mwh": round(sum(errs) / len(errs), 2),
                            "n_hours": len(errs)})
    log = [e for e in log if e["date"] >= (today - timedelta(days=90)).isoformat()]
    kv_put(log_key, log, 120 * 86400, account, token)


def main():
    account, token = env_creds()
    today = datetime.now(timezone.utc).date()
    print(f"=== v2 daglig kørsel {today} ===", flush=True)

    print("Opdaterer datagrundlag...", flush=True)
    refresh_prices()
    refresh_production()
    refresh_weather()

    print("Genbygger datasæt...", flush=True)
    for area in AREAS:
        ds.build(area)

    live = {n: fetch_live_forecast(n) for n in COORDS}

    failed = []
    for area in AREAS:
        try:
            print(f"=== {area} ===", flush=True)
            df = pd.read_parquet(f"{V2DIR}/dataset_{area.lower()}.parquet")
            train = df.dropna(subset=["y"])
            models = {}
            for a, name in [(0.1, "lo"), (0.5, "md"), (0.9, "hi")]:
                m = lgb.LGBMRegressor(objective="quantile", alpha=a, n_estimators=400,
                                      num_leaves=63, min_child_samples=30, learning_rate=0.05,
                                      verbosity=-1, n_jobs=8)
                m.fit(train[FEATS], train["y"])
                models[name] = m
            print(f"  trænet på {len(train):,} rækker", flush=True)

            prices = ds.load_prices(area)
            wa, _ = ds.load_weather(area.lower())
            prod = ds.load_production(area)
            est = ds.fit_production_estimator(wa, prod)
            est_de = ds.fit_de_estimator()
            days = score_area(area, models, prices, est, est_de,
                              live[area.lower()], live["de"], today)
            update_monitoring(area, days, today, account, token)
            kv_put(f"forecast-v2-{area}",
                   {"area": area, "generated": today.isoformat(),
                    "generatedAt": datetime.now(timezone.utc).isoformat(),
                    "model": "v2-hybrid", "days": days},
                   3 * 86400, account, token)
            print(f"  KV skrevet: forecast-v2-{area}", flush=True)
        except Exception as e:
            import traceback
            traceback.print_exc()
            failed.append(area)

    if failed:
        raise SystemExit(f"fejlede: {failed}")
    print("FÆRDIG", flush=True)


if __name__ == "__main__":
    main()
