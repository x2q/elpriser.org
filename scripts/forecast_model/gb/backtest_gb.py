#!/usr/bin/env python3
"""Out-of-sample backtest of the Great Britain estimate: rolling origin, two-month folds (like the EU model), refit at every fold start on targets settled
before it. Writes backtest_gb.parquet: one row per (as-of day, as-of hour, day offset, target hour) with every candidate's forecast beside the price.

    GB_DATA_DIR=. python3 backtest_gb.py [--first 2025-04-01] [--last 2026-11-02] [--no-lgb] [--jobs 8]

Candidates (gbmodels.py): b_A level+shape, b_persist, b_lag7, b_sea, b_simple, b_mult, b_ridge (B), c_ridge, c_lgb, c_ens (C), q10 / q90 (band edges).
As-of hours: ASOF. The page's job runs at every hour; the backtest samples these.
"""
import argparse
import os
import sys
import time

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import fetch_mid                                    # noqa: E402
import fetch_weather_gb as FW                       # noqa: E402
import gbfeat as GF                                 # noqa: E402
import gbmodels as GM                               # noqa: E402

ASOF = (0, 2, 5, 8, 11, 14, 17, 20)
DATA = os.environ.get("GB_DATA_DIR", DIR)


def load_hist():
    p = fetch_mid.load(os.path.join(DATA, "price_gb.parquet"))
    prev = FW.load_prev(DATA)
    wx = {lead: GF.weather_local(prev, lead) for lead in range(1, 8)}
    return p, GF.Hist(p, wx_by_lead=wx)


def rows(h, first_day, last_day, asofs=ASOF):
    days = pd.date_range(first_day, last_day, freq="D")
    return GF.build(h, [d.date() for d in days], asofs)


def run(a):
    t0 = time.time()
    p, h = load_hist()
    print(f"prices {len(p):,} h {p.index.min():%Y-%m-%d} .. {p.index.max():%Y-%m-%d}", flush=True)
    last = min(pd.Timestamp(a.last), p.index.max().normalize())
    df = rows(h, "2024-04-25", last)
    df = df[df["y"].notna() | (df["asof_date"] >= last - pd.Timedelta(days=7))]
    print(f"{len(df):,} rows ({time.time() - t0:.0f}s)", flush=True)
    folds = pd.period_range(a.first[:7], pd.Timestamp(a.last).strftime("%Y-%m"), freq="2M")
    out = []
    for f in folds:
        lo, hi = f.start_time, min(f.end_time, last + pd.Timedelta(days=1))
        # a training row's TARGET must be settled before the fold starts (a day-7 target of an as-of day just before the fold would leak)
        train = df[(df["date"] < lo) & df["y"].notna()]
        test = df[(df["asof_date"] >= lo) & (df["asof_date"] <= hi) & df["y"].notna() & df["b_A"].notna()].copy()
        if len(train) < 50_000 or test.empty:
            continue
        test["b_simple"] = GM.b_simple(test)
        test["b_mult"] = GM.b_mult(test)
        rb = GM.fit_ridges(train, GF.design_b)
        test["b_ridge"] = GM.predict_ridges(rb, test, GF.design_b)
        rc = GM.fit_ridges(train, GF.design)
        test["c_ridge"] = GM.predict_ridges(rc, test, GF.design)
        if not a.no_lgb:
            tr = train[train["date"] > train["date"].max() - pd.Timedelta(days=a.lgb_days)] if a.lgb_days else train
            test["c_lgb"] = GM.predict_lgb(GM.fit_lgb(tr, 0.5, a.jobs), test)
            test["q10"] = GM.predict_lgb(GM.fit_lgb(tr, 0.1, a.jobs), test)
            test["q90"] = GM.predict_lgb(GM.fit_lgb(tr, 0.9, a.jobs), test)
            test["c_ens"] = (test["c_ridge"] + test["c_lgb"]) / 2
        out.append(test)
        print(f"  fold {f}: train {len(train):,} test {len(test):,} ({time.time() - t0:.0f}s)", flush=True)
    res = pd.concat(out, ignore_index=True)
    res = res.drop(columns=[c for c in res.columns if c.startswith("wd") and c != "wd"], errors="ignore")
    res.to_parquet(os.path.join(DATA, "backtest_gb.parquet"), index=False)
    print(f"BACKTEST DONE {len(res):,} rows ({time.time() - t0:.0f}s)", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--first", default="2025-04-01")
    ap.add_argument("--last", default="2026-11-03")
    ap.add_argument("--no-lgb", action="store_true")
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--lgb-days", type=int, default=0, help="train the LightGBM on the last N days only (0 = everything before the fold)")
    run(ap.parse_args())
