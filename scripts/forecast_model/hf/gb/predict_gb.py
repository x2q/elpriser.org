#!/usr/bin/env python3
"""Estimate Great Britain's day-ahead-style hourly price: the rest of today (the Elexon Market Index Price appears hour by hour) and D+1 .. D+7.

    pip install -r requirements.txt
    python3 predict_gb.py [--out estimate.json]

No key is needed: the inputs are the Elexon BMRS Market Index Price of the last 60 days (public, ~10 requests) and the current Open-Meteo forecast.
Contains BMRS data (c) Elexon Limited copyright and database right 2026. Weather data by Open-Meteo.com.

Portugal and Ireland's single missing hour 23 is not a model: see hour23.py and weights/../gate/hour23_gate.json (persistence of hour 22, or hour 22 plus the median
hour-23 step of the last 28 days).
"""
import argparse
import json
import os
import pickle
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gb_infer as GI                  # noqa: E402,F401  (puts code/ on the path)
import fetch_mid                       # noqa: E402
import fetch_weather_gb as FW          # noqa: E402
import gbfeat as GF                    # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--weights", default=os.path.join(HERE, "weights"))
    ap.add_argument("--days", type=int, default=60, help="days of Elexon history to download")
    ap.add_argument("--frozen", help="a pickle {'price':..., 'wx':..., 'now': iso} instead of the live downloads (offline use / the parity check)")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    if a.frozen:
        with open(a.frozen, "rb") as f:
            fz = pickle.load(f)
        price, wx, now = fz["price"], fz["wx"], datetime.fromisoformat(fz["now"])
    else:
        now = datetime.now(timezone.utc)
        price = fetch_mid.pull(now.date() - timedelta(days=a.days), now.date())
        wx = GF.live_local(FW.live())
    res = GI.estimate(price, wx, a.weights, now)
    est, fc = res["estimate"], res["forecast"]
    if est:
        print(f"Rest of today ({est['date']}), GBP/MWh [model {est['model']}]:")
        for r in est["hours"]:
            print(f"  {r['hour']:02d}:00  {r['eur_mwh']:7.1f}   P10-P90 {r.get('min_eur_mwh', float('nan')):7.1f} .. {r.get('max_eur_mwh', float('nan')):7.1f}")
    else:
        print("No estimate for the rest of today (the gate or the data lets nothing through).")
    if fc:
        for d in fc["days"]:
            p = [x["eur_mwh"] for x in d["prices"]]
            print(f"  {d['date']}  D+{d['horizon']}  mean {sum(p)/24:7.1f}  min {min(p):7.1f}  max {max(p):7.1f} GBP/MWh")
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump({"estimate": est, "forecast": fc}, f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
