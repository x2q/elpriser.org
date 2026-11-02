#!/usr/bin/env python3
"""CatBoost as a drop-in replacement for the LightGBM model, over the SAME rolling folds (expanding window, retrained every 2 months,
2025-04 .. 2026-11), the same features, the same target and the same missing-row rule.

    --set eu       the EU model: dataset_eu_fuel.parquet, target = price - level_7d (the 'rel' variant), features of backtest.feats_for
    --set nordic   the Nordic model: dataset_nordic_fuel.parquet, raw price target, the Nordic job's features
    --variant base | fuel      without / with the leak-free gas and carbon features

zone is a categorical feature (CatBoost's ordered target statistics instead of LightGBM's native categorical splits). Loss = MAE, the
median, like the LightGBM quantile(0.5). Output: backtest_cb_<set>_<variant>.parquet with p_cb.

    ~/eu-forecast/venv-cb/bin/python catboost_backtest.py --set eu --variant fuel [--jobs 8]
"""
import argparse
import os
import sys
import time

import numpy as np
import pandas as pd
from catboost import CatBoostRegressor

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import backtest as BT              # noqa: E402
import nordic_backtest as NB       # noqa: E402

PARAMS = dict(loss_function="MAE", iterations=500, depth=8, learning_rate=0.1, border_count=64, l2_leaf_reg=3.0,
              subsample=0.7, bootstrap_type="Bernoulli", random_seed=1, verbose=0, allow_writing_files=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", choices=["eu", "nordic"], default="eu")
    ap.add_argument("--variant", choices=["base", "fuel"], default="fuel")
    ap.add_argument("--first", default="2025-04")
    ap.add_argument("--last", default=None)
    ap.add_argument("--step", type=int, default=2)
    ap.add_argument("--jobs", type=int, default=8)
    a = ap.parse_args()
    if a.set == "eu":
        df = pd.read_parquet(os.path.join(DIR, "dataset_eu_fuel.parquet"))
        feats = BT.feats_for("rel+fuel" if a.variant == "fuel" else "rel")
        req = BT.required(feats)
        last = a.last or "2026-11"
    else:
        df = pd.read_parquet(os.path.join(DIR, "dataset_nordic_fuel.parquet"))
        feats = NB.FEATS + (NB.FUEL if a.variant == "fuel" else [])
        req = [c for c in feats if not c.startswith("lag") and c != "zone" and c not in NB.RES]
        last = a.last or "2026-10"
        df = df[df["h"] <= 7]
    df["t"] = pd.to_datetime(df["t"])
    df["date"] = df["t"].dt.normalize()
    df["zone"] = df["zone"].astype(str)
    df = df.sort_values("t")
    rel = a.set == "eu"
    folds = pd.period_range(a.first, last, freq="M")
    out = []
    for i in range(0, len(folds), a.step):
        lo, hi = folds[i].start_time, folds[min(i + a.step - 1, len(folds) - 1)].end_time
        train = df[df["date"] < lo].dropna(subset=req + ["y"])
        test = df[(df["date"] >= lo) & (df["date"] <= hi)].copy()
        if len(train) < 100_000 or test.empty:
            continue
        t0 = time.time()
        y = train["y"] - train["level_7d"] if rel else train["y"]
        m = CatBoostRegressor(thread_count=a.jobs, cat_features=["zone"], **PARAMS)
        m.fit(train[feats], y)
        p = m.predict(test[feats])
        test["p_cb"] = p + test["level_7d"].to_numpy() if rel else p
        out.append(test[["zone", "t", "h", "date", "y", "p_cb"]])
        print(f"  fold {lo:%Y-%m}..{hi:%Y-%m}: train {len(train):,} test {len(test):,} in {time.time() - t0:.0f}s", flush=True)
    res = pd.concat(out, ignore_index=True)
    res.to_parquet(os.path.join(DIR, f"backtest_cb_{a.set}_{a.variant}.parquet"), index=False)
    print("CATBOOST DONE", flush=True)


if __name__ == "__main__":
    main()
