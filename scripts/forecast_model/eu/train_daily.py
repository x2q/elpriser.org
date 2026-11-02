#!/usr/bin/env python3
"""EU price forecast - daily train and score for the 25 EU zones of /api/nordic that have only settled prices today.

    cd ~/eu-forecast && set -a && . ~/.config/elpriser.env && set +a && python3 train_daily.py [--dry-run] [--zones de,fr]

What it does, in order: tops up the price history (ENTSO-E A44) and the weather history (Open-Meteo previous-runs), fetches the
live 10-day weather forecast, builds the pooled training set, trains ONE LightGBM median model (all zones, `zone` categorical),
scores every zone for the days after its last published price, and writes
    eu-forecast-<zone>                          the forecast (TTL 3 days), read by /api/nordic
    eu-forecast-archive-<zone>-<YYYY-MM-DD>     the run as published (TTL 200 days), for measuring real accuracy later
It NEVER writes eu-prices-<zone> or any nordic-forecast-* / forecast-v3-* key. --dry-run does everything except the KV writes
and prints a summary; it needs only ENTSOE_TOKEN (and network), not the Cloudflare pair.

Failure policy: a zone that cannot be scored is skipped (its old key expires after 3 days and the API then serves the settled
prices alone); a missing live weather forecast aborts the whole run with exit 1 before anything is written, because a model
trained with weather must not be fed NaN weather; the job exits 0 otherwise. Bands and the accuracy block come from
calibration_eu.json and accuracy_eu.json, written by calibrate.py from the backtest - without them days are published
without a band and without `accuracy`, never with an invented one.
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import backtest as B                  # noqa: E402
import dataset as ds                  # noqa: E402
import features as F                  # noqa: E402
import fetch_prices                   # noqa: E402
import fetch_weather as W             # noqa: E402
import forecast as FC                 # noqa: E402
import kv                             # noqa: E402
from zones import ZONES               # noqa: E402

PRICE_SANITY = (-500.0, 4000.0)       # EUR/MWh: the harmonised day-ahead limits are -500 and 4,000
MIN_ZONES = 20                        # fewer zones scored than this is reported as a failed run (exit 3) after writing what there is


def load_env():
    path = os.path.expanduser("~/.config/elpriser.env")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"'))


def log(msg):
    print(msg, flush=True)


def load_json(name):
    path = os.path.join(DIR, name)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def refresh(zones):
    log("Refreshing prices...")
    for z in zones:
        try:
            fetch_prices.update(z)
        except Exception as e:           # a zone's price top-up failing leaves its cache as it was
            log(f"  {z}: price refresh failed, using cached: {e}")
    log("Refreshing weather history...")
    try:
        W.fetch_history(pause=3)
    except Exception as e:
        log(f"  weather history refresh failed, using cached: {e}")


def train(df, variant):
    import lightgbm as lgb
    feats = B.feats_for(variant)
    tr = df.dropna(subset=B.required(feats) + ["y"])
    y = tr["y"] - tr["level_7d"] if "rel" in B.flags(variant) else tr["y"]
    m = lgb.LGBMRegressor(n_jobs=int(os.environ.get("EU_FORECAST_JOBS", "8")), **B.PARAMS)
    m.fit(tr[feats], y, categorical_feature=["zone"])
    trained_through = pd.to_datetime(tr["t"]).max().date()
    return m, feats, len(tr), trained_through


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="do everything except write to KV")
    ap.add_argument("--zones", help="comma-separated subset to score (the model is always trained on all zones)")
    ap.add_argument("--skip-refresh", action="store_true", help="use the cached prices and weather as they are")
    ap.add_argument("--variant", default=os.environ.get("EU_FORECAST_VARIANT", "raw"))
    a = ap.parse_args(argv)
    load_env()
    now = datetime.now(timezone.utc)
    log(f"=== EU forecast run {now:%Y-%m-%d %H:%M}Z{' (dry run)' if a.dry_run else ''} ===")
    acct, cf = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    if not a.dry_run and not (acct and cf):
        log("missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN")
        return 2
    if not os.environ.get("ENTSOE_TOKEN") and not a.skip_refresh:
        log("missing ENTSOE_TOKEN")
        return 2
    zones = a.zones.split(",") if a.zones else list(ZONES)
    unknown = [z for z in zones if z not in ZONES]
    if unknown:
        log("unknown zone(s): " + ", ".join(unknown))
        return 2

    if not a.skip_refresh:
        refresh(list(ZONES))
    try:
        live = W.live()
    except Exception as e:
        log(f"live weather forecast unavailable ({type(e).__name__}): aborting before anything is written")
        return 1
    if len(live) < len(ZONES):
        log(f"live weather for {len(live)}/{len(ZONES)} zones: aborting before anything is written")
        return 1

    log("Building dataset...")
    df = ds.build(save=False)
    if df.empty or df["zone"].nunique() < MIN_ZONES:
        log("dataset has too few zones: aborting")
        return 1
    model, feats, n, trained_through = train(df, a.variant)
    lag = (now.date() - trained_through).days
    log(f"  trained on {n:,} rows, through {trained_through} ({lag} days before today)")
    if lag > 7:
        log(f"  WARNING: the newest training row is {lag} days old - a source has stopped refreshing")

    def predict(X):
        p = model.predict(X[feats])
        return p + X["level_7d"].to_numpy() if "rel" in B.flags(a.variant) else p

    prices = ds.load_prices()
    days, eu = F.day_table(prices)
    cal, acc = load_json("calibration_eu.json"), load_json("accuracy_eu.json")
    if cal is None:
        log("  calibration_eu.json missing: days are published WITHOUT a band")
    wrote, skipped = 0, []
    for z in zones:
        try:
            tz = ZoneInfo(ZONES[z][1])
            today = now.astimezone(tz).date()
            wx = FC.live_weather_local(live, z)
            reg = FC.live_regional_local(live, z)
            fdays = FC.forecast_zone(z, predict, prices, wx, reg, days, eu, today, cal)
            fdays = [d for d in fdays if all(PRICE_SANITY[0] <= p["eur_mwh"] <= PRICE_SANITY[1] for p in d["prices"])]
            if not fdays:
                skipped.append(z)
                log(f"  {z}: nothing to publish (stale prices or no finite forecast)")
                continue
            pl = FC.payload(z, fdays, today, trained_through, now.isoformat(timespec="seconds"), (acc or {}).get(z))
            horizons = ",".join(str(d["horizon"]) for d in fdays)
            mean = np.mean([p["eur_mwh"] for d in fdays for p in d["prices"]])
            if a.dry_run:
                log(f"  {z}: would write eu-forecast-{z}: {len(fdays)} days (h {horizons}), mean {mean:.1f} EUR/MWh")
            else:
                kv.put(f"eu-forecast-{z}", pl, kv.FORECAST_TTL, acct, cf)
                kv.put(f"eu-forecast-archive-{z}-{today.isoformat()}", FC.archive_payload(pl), kv.ARCHIVE_TTL, acct, cf)
                log(f"  {z}: wrote eu-forecast-{z} (+ archive): {len(fdays)} days (h {horizons}), mean {mean:.1f} EUR/MWh")
            wrote += 1
            time.sleep(0.2)
        except Exception as e:
            skipped.append(z)
            log(f"  {z}: FAILED (non-fatal): {type(e).__name__}: {e}")
    log(f"DONE {wrote}/{len(zones)} zones" + (f", skipped: {', '.join(skipped)}" if skipped else ""))
    return 3 if (len(zones) == len(ZONES) and wrote < MIN_ZONES) else 0


if __name__ == "__main__":
    sys.exit(main())
