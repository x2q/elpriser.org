#!/usr/bin/env python3
"""Does the production ridge reproduce the research's `lear_r365_g` / `lear_r365`?

    python3 verify_parity.py [--research regions] [--days 2026-10-13,2026-08-04] [--zones de,it-n,pl,es,ro]

The research (family_backtest.py) refits every 7 days from 2025-04-01 and predicts the 7 target days of the block with that refit. Production
refits every day. On a REFIT DAY r the two use the same training window (targets in (r - h - 365, r - h]) for the rows dated r, so those rows must
agree to float precision. This script rebuilds them with recipe.lear_predict from the research's own dataset (dataset_eu_fuel.parquet, price_*.parquet)
and compares them with the columns of regions_all.parquet. Needs the research files; run it on the Spark after the research pipeline.
"""
import argparse
import os
import sys

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import dataset as ds             # noqa: E402
import recipe as RC              # noqa: E402
from zones import ZONES          # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--research", default=os.path.join(DIR, "regions"))
    ap.add_argument("--days", default="2026-10-13,2026-08-04", help="refit days of the research (2025-04-01 + 7k)")
    ap.add_argument("--zones", default="de,it-n,pl,es,ro")
    a = ap.parse_args()
    zones = a.zones.split(",")
    days = [pd.Timestamp(d) for d in a.days.split(",")]
    prices = ds.load_prices(a.research, zones=zones)
    cols = ["zone", "t", "h", "date", "y", "lear_r365_g", "lear_r365"]
    ref = pd.read_parquet(os.path.join(a.research, "regions_all.parquet"), columns=cols)
    ref["zone"] = ref["zone"].astype(str)
    ref["date"] = pd.to_datetime(ref["date"])
    df = pd.read_parquet(os.path.join(a.research, "dataset_eu_fuel.parquet"))
    df["zone"] = df["zone"].astype(str)
    df["t"] = pd.to_datetime(df["t"])
    df["date"] = df["t"].dt.normalize()
    df = df[df["zone"].isin(zones) & df["h"].between(2, 7) & df["y"].notna()]
    worst = 0.0
    for day in days:
        hist = df[(df["date"] <= day) & (df["date"] > day - pd.Timedelta(days=RC.LEAR_WINDOW_DAYS + 20))].copy()
        hist = RC.augment(hist, prices)
        live = hist[hist["date"] == day]
        for fuel, col in ((True, "lear_r365_g"), (False, "lear_r365")):
            mine = RC.lear_predict(hist, live, fuel)
            m = pd.DataFrame({"zone": live["zone"], "t": live["t"], "h": live["h"], "mine": mine}).merge(
                ref[ref["date"] == day][["zone", "t", "h", col]], on=["zone", "t", "h"], how="inner").dropna()
            d = (m["mine"] - m[col]).abs()
            worst = max(worst, float(d.max())) if len(d) else worst
            print(f"{day:%Y-%m-%d} {'with' if fuel else 'without'} fuel: {len(m):5d} hours compared, max |diff| {d.max():.5f} EUR/MWh, mean {d.mean():.5f}, "
                  f"{(d < 0.01).mean():.1%} within 0.01")
    print("PARITY OK" if worst < 0.05 else f"PARITY FAILED (max {worst:.3f})")
    return 0 if worst < 0.05 else 1


if __name__ == "__main__":
    sys.exit(main())
