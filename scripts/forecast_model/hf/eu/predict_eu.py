#!/usr/bin/env python3
"""Forecast the day-ahead price of EU bidding zones 2-7 days ahead with the published fuel-free eu-ens-v2 weights.

    pip install -r requirements.txt
    export ENTSOE_TOKEN=...            # a free ENTSO-E Transparency Platform API token (read once per run: the last 60 days of prices)
    python3 predict_eu.py --zones de,fr [--out forecast.json]

Inputs, all public: day-ahead prices of the 25 zones for the last 60 days (ENTSO-E Transparency Platform, A44; one request per zone) and the
current Open-Meteo forecast (no key). Offline use: --prices-dir with one price_<zone>.parquet per zone (columns t, eur_mwh; hourly means on the
zone's local clock) and --weather-pickle with the result of fetch_weather.live().
The output is a forecast of the whole day-ahead price (EUR/MWh) per hour, with a P10-P90 band, for the horizons the publish gate lets through.
"""
import argparse
import json
import os
import pickle
import sys
from datetime import datetime, timedelta, timezone

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import eu_infer as EI                  # noqa: E402,F401  (puts code/ on the path)
import fetch_prices as FP              # noqa: E402
import fetch_weather as W              # noqa: E402
from zones import ZONES                # noqa: E402

HISTORY_DAYS = 60


def prices_from_entsoe(days=HISTORY_DAYS):
    today = datetime.now(timezone.utc).date()
    out = {}
    for z in ZONES:
        try:
            out[z] = FP.pull_zone(z, today - timedelta(days=days), today + timedelta(days=2))
        except Exception as e:
            print(f"  {z}: price download failed ({e})", file=sys.stderr)
    return out


def prices_from_dir(path):
    out = {}
    for z in ZONES:
        f = os.path.join(path, f"price_{z}.parquet")
        if os.path.exists(f):
            df = pd.read_parquet(f)
            s = df.set_index(pd.to_datetime(df["t"]))["eur_mwh"].sort_index()
            out[z] = s[~s.index.duplicated(keep="last")]
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--zones", help="comma-separated, default all 25")
    ap.add_argument("--weights", default=os.path.join(HERE, "weights"))
    ap.add_argument("--prices-dir")
    ap.add_argument("--weather-pickle")
    ap.add_argument("--out", help="write the JSON payloads here")
    a = ap.parse_args(argv)
    if a.prices_dir:
        prices = prices_from_dir(a.prices_dir)
    else:
        if not os.environ.get("ENTSOE_TOKEN"):
            sys.exit("set ENTSOE_TOKEN (free: register at transparency.entsoe.eu, then ask transparency@entsoe.eu for RESTful API access) or use --prices-dir")
        prices = prices_from_entsoe()
    if a.weather_pickle:
        with open(a.weather_pickle, "rb") as f:
            live = pickle.load(f)
    else:
        live = W.live()
    res = EI.forecast(prices, live, a.weights, zones=a.zones.split(",") if a.zones else None)
    for z, pl in res.items():
        print(f"\n{z}  ({pl['recipe']}, weights trained through {pl['trainedThrough']})")
        for d in pl["days"]:
            p = [x["eur_mwh"] for x in d["prices"]]
            cheap = sorted(range(24), key=lambda i: p[i])[:3]
            print(f"  {d['date']}  D+{d['horizon']}  mean {sum(p)/24:7.1f}  min {min(p):7.1f}  max {max(p):7.1f} EUR/MWh   cheapest hours {sorted(cheap)}")
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(res, f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
