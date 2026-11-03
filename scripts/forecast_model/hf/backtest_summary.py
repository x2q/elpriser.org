#!/usr/bin/env python3
"""The pooled backtest figures quoted in the eu-price-forecast model card, recomputed from the research backtest frame.

    PYTHONDONTWRITEBYTECODE=1 python3 backtest_summary.py [--src ~/eu-forecast]

Reads regions/regions_all.parquet (written by region_all.py: one row per zone, hour and horizon with the actual price `y`, the naive 'level + shape' forecast
`b_lvlshape` and the model columns). Compares the FUEL-FREE recipe (mean of `lear_r365` and `lgb_base`; the Baltics: `lgb_base`) and the production recipe with fuel
(mean of `lear_r365_g` and `lgb_fuel`) against the naive method, for hourly MAE, the error of the DAILY MEAN (the price level), bias and regret of the three cheapest hours.
All zones are pooled with equal weight per forecast hour. Prints text only.
"""
import argparse
import os
import sys

import numpy as np
import pandas as pd


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.expanduser("~/eu-forecast"))
    ap.add_argument("--recent", default="2026-09-01")
    a = ap.parse_args(argv)
    sys.dont_write_bytecode = True
    sys.path.insert(0, a.src)
    import metrics as M
    from zones import ZONES
    df = pd.read_parquet(os.path.join(a.src, "regions", "regions_all.parquet"),
                         columns=["zone", "t", "date", "h", "hour", "y", "b_lvlshape", "lear_r365", "lear_r365_g", "lgb_fuel", "lgb_base"])
    df["zone"] = df["zone"].astype(str)
    df["date"] = pd.to_datetime(df["date"])
    df = df[df.zone.isin(list(ZONES)) & df.h.between(2, 7)].copy()
    balt = df.zone.isin(["ee", "lv", "lt"])
    df["nofuel"] = np.where(balt, df.lgb_base, (df.lear_r365 + df.lgb_base) / 2)
    df["fuel"] = np.where(balt, df.lgb_base, (df.lear_r365_g + df.lgb_fuel) / 2)
    df = df.dropna(subset=["y", "b_lvlshape", "nofuel", "fuel"])
    rec = pd.Timestamp(a.recent)
    print(f"rows {len(df):,}, zones {df.zone.nunique()}, {df.date.min().date()} .. {df.date.max().date()}")

    def stats(d, label):
        print(label, f"({len(d):,} rows)")
        out = {}
        for col in ("b_lvlshape", "nofuel", "fuel"):
            g = d.groupby(["zone", "date", "h"])
            out[col] = ((d[col] - d.y).abs().mean(), (g[col].mean() - g.y.mean()).abs().mean(), (d[col] - d.y).mean())
            print(f"   {col:11s} hourly MAE {out[col][0]:6.2f}   day-mean MAE {out[col][1]:6.2f}   bias {out[col][2]:7.2f}")
        b = out["b_lvlshape"]
        for col in ("nofuel", "fuel"):
            print(f"   gain vs naive, {col:7s} hourly {1 - out[col][0] / b[0]:6.1%}   day-mean (level) {1 - out[col][1] / b[1]:6.1%}")

    for h in (2, 4, 7):
        stats(df[(df.h == h) & (df.date >= rec)], f"since {a.recent}, D+{h}")
    stats(df[df.date >= rec], f"since {a.recent}, D+2..D+7")
    stats(df[df.h == 2], "whole backtest, D+2")
    stats(df, "whole backtest, D+2..D+7")
    for label, d in (("whole backtest", df), (f"since {a.recent}", df[df.date >= rec])):
        res = {}
        for col in ("b_lvlshape", "nofuel", "fuel"):
            _, A = M.day_matrix(d, "y")
            _, Fm = M.day_matrix(d, col)
            res[col] = float(np.nanmean(M.regret(A, Fm)))
        print(f"regret of the 3 cheapest hours, {label}: " + ", ".join(f"{k} {v:.2f}" for k, v in res.items())
              + f"  (fuel-free gain {1 - res['nofuel'] / res['b_lvlshape']:.1%}, with fuel {1 - res['fuel'] / res['b_lvlshape']:.1%})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
