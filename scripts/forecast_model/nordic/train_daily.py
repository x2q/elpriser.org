#!/usr/bin/env python3
"""Nordic + NL price forecast — daily training and scoring for 13 bidding zones.

DK1, DK2, NO1-NO5, SE1-SE4, FI, NL. Horizons 2-9 days, hourly, EUR/MWh.

DESIGN: one pooled LightGBM model with zone as a categorical feature, not 13
separate pipelines. The zones share nearly all their structure — calendar
effects, weather physics, lag behaviour — so pooling lets a thin zone borrow
strength from a busy one, and leaves a single thing to maintain.

Pooling only works because three features let the model tell zones apart on
LEVEL before it starts explaining deviations: the zone id, `last_day_mean`,
and `level_30d`. Without them a pooled model on raw EUR/MWh would spend its
capacity learning that NO4 averages 22 and NL averages 86.

WHAT THE BACKTEST FOUND, and why the metrics here are not the Danish ones:
percentage MAE and min-hour hit-rate are both distorted across zones with
very different price levels and intraday spreads. NO4's median daily spread
is 12 EUR/MWh with 28% of days essentially flat, so ranking its hours is
near-random AND nearly free to get wrong; NL's spread is 128 EUR. The metric
that survives that is REGRET — what following the forecast's three cheapest
hours costs versus perfect timing. On regret the model beats a seasonal
baseline in all 13 zones, and absolute regret is remarkably uniform
(6-11 EUR/MWh) even where percentage metrics look alarming.

Reservoir levels are in because the first backtest showed the model LOSING to
a plain seasonal average in NO1/NO2 — the signature of a missing level driver.
Nordic prices follow water value. Adding them turned NO1 from +1.3% to -1.7%
and NO2 from +8.1% to -0.3% against that baseline.

Bands are additive empirical residual quantiles, not scaled model quantiles:
in the flat zones the model's own quantile spread needed 8x inflation and
still missed 80% coverage, which is stretching a number rather than measuring
uncertainty.

Needs ~/.config/elpriser.env with ENTSOE_TOKEN (+ optional HF_TOKEN).
"""
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

import urllib.parse
import urllib.request

import numpy as np
import pandas as pd
import lightgbm as lgb

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import dataset as ds
import fetch_prices, fetch_weather, fetch_reservoir

ZONES = ds.ZONES
FEATS = ["zone", "h", "hour", "weekday", "month", "is_weekend", "doy_sin", "doy_cos",
         "lag1", "lag2", "lag3", "lag7", "lag14", "lag21", "lag28",
         "seasonal4w", "last_day_mean", "level_30d",
         "wind", "rad", "temp", "precip", "precip_24h",
         "reg_wind", "reg_temp", "hydro_precip", "hydro_precip_7d",
         "reservoir_pct", "reservoir_anom", "nordic_reservoir_anom"]
# Reservoir columns are legitimately empty for the non-hydro zones, so they
# must never enter a dropna subset — that would delete DK1/DK2/NL entirely.
NULLABLE = {"reservoir_pct", "reservoir_anom"}
BLEND = 0.5
CAL = json.load(open(f"{DIR}/calibration_nordic.json"))


KV_NAMESPACE = "126700e66e8d4a19b289b0e8afdaff69"


def kv_put(key, value, ttl, account, token):
    url = (f"https://api.cloudflare.com/client/v4/accounts/{account}"
           f"/storage/kv/namespaces/{KV_NAMESPACE}/values/{urllib.parse.quote(key)}"
           f"?expiration_ttl={ttl}")
    req = urllib.request.Request(url, data=json.dumps(value).encode(), method="PUT",
                                 headers={"Authorization": f"Bearer {token}",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read())
    if not resp.get("success"):
        raise RuntimeError(f"KV put failed for {key}: {resp}")


def env():
    path = os.path.expanduser("~/.config/elpriser.env")
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))


def refresh():
    """Top up each source. Prices are required; the slower-moving sources are
    best-effort — a day-old reservoir reading beats failing the whole run."""
    print("Refreshing prices...", flush=True)
    for f in list(os.listdir(DIR)):
        if f.startswith("price_") and f.endswith(".parquet"):
            os.remove(os.path.join(DIR, f))   # force a re-pull of the recent window
    fetch_prices.main()
    for label, fn in (("weather", fetch_weather.fetch), ("reservoir", fetch_reservoir.main)):
        try:
            print(f"Refreshing {label}...", flush=True)
            fn("prev") if label == "weather" else fn()
            if label == "weather":
                fetch_weather.fetch("actual")
        except Exception as e:
            print(f"  {label} refresh failed, using cached: {e}", flush=True)


def live_weather():
    out = {}
    for z, (lat, lon) in fetch_weather.POINTS.items():
        j = fetch_weather.get(
            f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
            f"&hourly=wind_speed_100m,direct_radiation,temperature_2m,precipitation"
            f"&forecast_days=10&timezone=Europe/Copenhagen")
        df = pd.DataFrame(j.get("hourly", {}))
        df["t"] = pd.to_datetime(df["time"])
        out[z] = df.set_index("t").drop(columns=["time"])
        time.sleep(1)
    return out


def score(models, prices, live, reservoirs, nordic_res, today):
    """10-day forecast per zone in a compact JSON-ready structure."""
    out = {}
    idx_all = pd.date_range(pd.Timestamp(today), periods=10 * 24, freq="h")
    reg = {}
    for lead in range(1, 8):
        reg[lead] = {
            "reg_wind": np.nanmean([live[z].wind_speed_100m.reindex(idx_all).values
                                    for z in ZONES], axis=0),
            "reg_temp": np.nanmean([live[z].temperature_2m.reindex(idx_all).values
                                    for z in ZONES], axis=0),
            "hydro_precip": np.nanmean([live[z].precipitation.reindex(idx_all).values
                                        for z in ds.HYDRO], axis=0),
        }
        reg[lead]["hydro_precip_7d"] = pd.Series(
            reg[lead]["hydro_precip"], index=idx_all).rolling(24 * 7, min_periods=24).sum().values

    for z in ZONES:
        p = prices[z]
        day_mean = p.groupby(p.index.normalize()).mean()
        lvl30 = day_mean.rolling(30, min_periods=10).mean()
        sc = _seasonal(p, today)
        days = []
        for offset in range(10):
            d = today + timedelta(days=offset)
            dayp = p[p.index.normalize() == pd.Timestamp(d)]
            if len(dayp) > 12:
                days.append({"date": d.isoformat(), "type": "actual",
                             "prices": [{"hour": h,
                                         "eur_mwh": (round(float(dayp[dayp.index.hour == h].mean()), 2)
                                                     if len(dayp[dayp.index.hour == h]) else None)}
                                        for h in range(24)]})
                continue
            # No published prices for this day yet — forecast it rather than
            # emitting nulls. Between midnight and the ~13:00 CET day-ahead
            # auction, tomorrow is genuinely unknown, and a forecast is exactly
            # what a visitor wants there.
            #
            # h = max(offset, 2) is not a fallback, it is the correct horizon.
            # The training convention is "the last known price day is
            # target - (h-1)". Tomorrow, before its auction publishes, has
            # today as its last known day — i.e. target - 1 — which is exactly
            # the h=2 information state. So the h=2 model is being asked the
            # question it was trained on. (A separate h=1 model would describe
            # the state where the target day's own prices are already known,
            # in which case no forecast is needed at all.)
            h = max(offset, 2)
            idx = pd.date_range(pd.Timestamp(d), periods=24, freq="h")
            row = pd.DataFrame({"h": h, "hour": range(24)})
            row["zone"] = pd.Categorical([z] * 24, categories=ZONES)
            row["weekday"] = d.weekday(); row["month"] = d.month
            row["is_weekend"] = 1 if d.weekday() >= 5 else 0
            doy = d.timetuple().tm_yday
            row["doy_sin"] = np.sin(2 * np.pi * doy / 365.25)
            row["doy_cos"] = np.cos(2 * np.pi * doy / 365.25)
            for k in (1, 2, 3, 7, 14, 21, 28):
                row[f"lag{k}"] = ([p.get(t - pd.Timedelta(days=k), np.nan) for t in idx]
                                  if k >= h - 1 else np.nan)
            row["seasonal4w"] = row[[f"lag{k}" for k in (7, 14, 21, 28)]].mean(axis=1)
            lk = pd.Timestamp(d) - pd.Timedelta(days=h - 1)
            row["last_day_mean"] = day_mean.get(lk, np.nan)
            row["level_30d"] = lvl30.get(lk, np.nan)
            lw = live[z].reindex(idx)
            row["wind"] = lw.wind_speed_100m.values
            row["rad"] = lw.direct_radiation.values
            row["temp"] = lw.temperature_2m.values
            row["precip"] = lw.precipitation.values
            row["precip_24h"] = lw.precipitation.rolling(24, min_periods=6).sum().values
            sel = idx_all.isin(idx)
            for k, v in reg[min(h, 7)].items():
                row[k] = v[sel]
            rz = reservoirs.get(z)
            row["reservoir_pct"] = rz["reservoir_pct"].iloc[-1] if rz is not None else np.nan
            row["reservoir_anom"] = rz["reservoir_anom"].iloc[-1] if rz is not None else np.nan
            row["nordic_reservoir_anom"] = (nordic_res.iloc[-1] if nordic_res is not None else np.nan)

            X = row[FEATS]
            md = models["md"].predict(X)
            se = np.array([sc.get((d.weekday(), hh), np.nan) for hh in range(24)])
            hyb = md if np.isnan(se).any() else (
                md.mean() + (1 - BLEND) * (md - md.mean()) + BLEND * (se - se.mean()))
            band = CAL.get(z, {}).get(str(h), {"lo": -30.0, "hi": 30.0})
            days.append({"date": d.isoformat(), "type": "forecast",
                         "prices": [{"hour": hh, "eur_mwh": round(float(hyb[hh]), 2),
                                     "min_eur_mwh": round(float(hyb[hh] + band["lo"]), 2),
                                     "max_eur_mwh": round(float(hyb[hh] + band["hi"]), 2)}
                                    for hh in range(24)]})
        out[z] = days
    return out


def _seasonal(p, today):
    hist = p[(p.index >= pd.Timestamp(today) - pd.Timedelta(days=28))
             & (p.index < pd.Timestamp(today) + pd.Timedelta(days=2))]
    d = pd.DataFrame({"p": hist, "wd": hist.index.weekday, "h": hist.index.hour})
    return d.groupby(["wd", "h"]).p.mean()


def main():
    env()
    today = datetime.now(timezone.utc).date()
    print(f"=== Nordic daily run {today} ===", flush=True)
    refresh()

    print("Building dataset...", flush=True)
    ds.build()
    df = pd.read_parquet(f"{DIR}/dataset_nordic.parquet")
    train = df.dropna(subset=["y"])
    tr = train.dropna(subset=[c for c in FEATS
                              if not c.startswith("lag") and c != "zone" and c not in NULLABLE])
    models = {}
    for a, name in [(0.1, "lo"), (0.5, "md"), (0.9, "hi")]:
        m = lgb.LGBMRegressor(objective="quantile", alpha=a, n_estimators=500,
                              num_leaves=127, min_child_samples=40, learning_rate=0.05,
                              verbosity=-1, n_jobs=12)
        m.fit(tr[FEATS], tr["y"], categorical_feature=["zone"])
        models[name] = m
    print(f"  trained on {len(tr):,} rows across {tr.zone.nunique()} zones", flush=True)

    prices = ds.load_prices()
    res = ds.load_reservoir()
    reservoirs, nordic_res = res if res else ({}, None)
    out = score(models, prices, live_weather(), reservoirs, nordic_res, today)

    payload = {"generated": today.isoformat(),
               "generatedAt": datetime.now(timezone.utc).isoformat(),
               "unit": "EUR/MWh", "model": "nordic-pooled-v1", "zones": out}
    with open(f"{DIR}/forecast_latest.json", "w") as f:
        json.dump(payload, f)
    print(f"  wrote forecast_latest.json ({len(out)} zones)", flush=True)

    # One KV key per zone rather than one big blob: the site only ever renders
    # one zone at a time, and a per-zone key keeps each read small.
    acct = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    tok = os.environ.get("CLOUDFLARE_API_TOKEN")
    if acct and tok:
        written = 0
        for z, days in out.items():
            try:
                kv_put(f"nordic-forecast-{z}",
                       {"zone": z, "generated": today.isoformat(),
                        "unit": "EUR/MWh", "days": days},
                       3 * 86400, acct, tok)
                written += 1
            except Exception as e:
                print(f"  KV write failed for {z}: {e}", flush=True)
        print(f"  KV: wrote {written}/{len(out)} zones", flush=True)
    else:
        print("  Cloudflare creds not set - skipping KV", flush=True)

    hf = os.environ.get("HF_TOKEN")
    if hf:
        try:
            import publish_hf
            publish_hf.publish(models, CAL, FEATS, ZONES, today, hf)
        except Exception:
            import traceback
            print("  HF publish failed (non-fatal):", flush=True)
            traceback.print_exc()
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
