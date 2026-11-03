#!/usr/bin/env python3
"""MAE tables of backtest_gb.parquet (GBP/MWh): the rest of today at several as-of hours, then D+1 .. D+7, against the naive baselines.

    GB_DATA_DIR=. python3 score_gb.py [--csv scores_gb.csv]

Windows: `all` = the whole backtest, `hold` = the hold-out (2026-07-01 ..), `since` = since the September 2026 price shift (2026-09-01 ..), `pre` = before the hold-out.
"""
import argparse
import os
import sys

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
DATA = os.environ.get("GB_DATA_DIR", DIR)
HOLD = pd.Timestamp("2026-07-01")
SINCE = pd.Timestamp("2026-09-01")
METHODS = ["b_persist", "b_lag7", "b_sea", "b_A", "b_simple", "b_mult", "b_ridge", "c_ridge", "c_lgb", "c_ens"]
TEST_ASOF = (2, 8, 14)


def windows(df):
    d = df["asof_date"]
    return {"all": df, "pre": df[d < HOLD], "hold": df[d >= HOLD], "since": df[d >= SINCE]}


def mae(df, m):
    s = df.dropna(subset=["y", m]) if m in df else df.iloc[:0]
    return float((s[m] - s["y"]).abs().mean()) if len(s) else np.nan


def table(df, methods=METHODS):
    """One row per method: n, MAE in each window, the gain over level+shape (b_A) in each window and the bias since the shift."""
    w = windows(df)
    # only rows where every method in `methods` that exists has a forecast: the comparison is on the same hours
    have = [m for m in methods if m in df.columns]
    common = df.dropna(subset=have + ["y"])
    wc = windows(common)
    rows = []
    for m in have:
        r = {"method": m, "n": len(common)}
        for k, x in wc.items():
            r[f"mae_{k}"] = mae(x, m)
        for k in ("all", "pre", "hold", "since"):
            base = mae(wc[k], "b_A")
            r[f"gain_{k}"] = 1 - r[f"mae_{k}"] / base if base else np.nan
        s = wc["since"]
        r["bias_since"] = float((s[m] - s["y"]).mean()) if len(s) else np.nan
        rows.append(r)
    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv")
    a = ap.parse_args()
    df = pd.read_parquet(os.path.join(DATA, "backtest_gb.parquet"))
    df["asof_date"] = pd.to_datetime(df["asof_date"])
    df["date"] = pd.to_datetime(df["date"])
    pd.set_option("display.width", 250)
    allrows = []
    print(f"backtest {df['asof_date'].min():%Y-%m-%d} .. {df['asof_date'].max():%Y-%m-%d}, {len(df):,} rows; hold-out from {HOLD:%Y-%m-%d}, shift from {SINCE:%Y-%m-%d}\n")
    for a_ in sorted(df["a"].unique()):
        s = df[(df["a"] == a_) & (df["k"] == 0)]
        if s.empty:
            continue
        t = table(s)
        t.insert(0, "class", f"rest@{int(a_):02d}")
        allrows.append(t)
        print(f"== rest of today, as-of {int(a_):02d}:00 (hours {int(a_)}..23)")
        print(t.drop(columns="class").round(3).to_string(index=False), "\n")
    for k in range(1, 8):
        s = df[(df["k"] == k) & df["a"].isin(TEST_ASOF)]
        if s.empty:
            continue
        t = table(s)
        t.insert(0, "class", f"D+{k}")
        allrows.append(t)
        print(f"== D+{k} (as-of 02/08/14 pooled)")
        print(t.drop(columns="class").round(3).to_string(index=False), "\n")
    if a.csv:
        pd.concat(allrows).to_csv(a.csv, index=False)


if __name__ == "__main__":
    main()
