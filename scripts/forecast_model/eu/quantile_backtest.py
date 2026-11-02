#!/usr/bin/env python3
"""P10 / P50 / P90 from quantile LightGBM (the EU model with the fuel features, target = price - level_7d), over the same folds as the
other backtests, and the comparison with the CURRENT band recipe (calibrate.py: empirical residual quantiles of the last 180 days
x 1.2, rolling out of sample).

Three intervals are scored for every zone and horizon on the same hours:
  recipe     the current recipe on the median forecast
  raw        the P10 / P90 models as they come
  qr+recipe  the quantile models, widened / narrowed by the same rolling residual recipe applied to THEIR errors (conformalised quantile
             regression in spirit: the band follows the model's own recent miss rate)
Metrics: coverage of the nominal 80 % band, mean width (EUR/MWh) and the interval score (width + 10 x the miss distance; lower = better).

    python3 quantile_backtest.py --jobs 8        -> backtest_q_fuel.parquet
    python3 quantile_backtest.py --score         -> quantile_scores.csv
"""
import argparse
import os
import sys
import time

import lightgbm as lgb
import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import backtest as BT              # noqa: E402
import family_models as FM         # noqa: E402

ALPHAS = {"q10": 0.1, "q50": 0.5, "q90": 0.9}


def run(a):
    df = pd.read_parquet(os.path.join(DIR, "dataset_eu_fuel.parquet"))
    df["t"] = pd.to_datetime(df["t"])
    df["date"] = df["t"].dt.normalize()
    df = df[df["h"] <= 7].sort_values("t")
    feats = BT.feats_for("rel+fuel")
    req = BT.required(feats)
    folds = pd.period_range("2025-04", "2026-11", freq="M")
    out = []
    for i in range(0, len(folds), 2):
        lo, hi = folds[i].start_time, folds[min(i + 1, len(folds) - 1)].end_time
        train = df[df["date"] < lo].dropna(subset=req + ["y"])
        test = df[(df["date"] >= lo) & (df["date"] <= hi)].copy()
        if len(train) < 100_000 or test.empty:
            continue
        t0 = time.time()
        y = train["y"] - train["level_7d"]
        for name, alpha in ALPHAS.items():
            m = lgb.LGBMRegressor(n_jobs=a.jobs, **{**BT.PARAMS, "alpha": alpha})
            m.fit(train[feats], y, categorical_feature=["zone"])
            test[name] = m.predict(test[feats]) + test["level_7d"].to_numpy()
        out.append(test[["zone", "t", "h", "date", "y"] + list(ALPHAS)])
        print(f"  fold {lo:%Y-%m}..{hi:%Y-%m}: train {len(train):,} in {time.time() - t0:.0f}s", flush=True)
    pd.concat(out, ignore_index=True).to_parquet(os.path.join(DIR, "backtest_q_fuel.parquet"), index=False)
    print("QUANTILE BACKTEST DONE", flush=True)


def score():
    q = pd.read_parquet(os.path.join(DIR, "backtest_q_fuel.parquet"))
    q["zone"] = q["zone"].astype(str)
    q["date"] = pd.to_datetime(q["date"])
    q = q.sort_values(["zone", "h", "t"]).reset_index(drop=True)
    # the recipe on the median, and on each quantile model's own error
    q["r_lo"], q["r_hi"] = FM.rolling_residual_band(q, "q50")
    # the recipe applied to each quantile edge's own miss: the lower edge moves by the (scaled) 10th percentile of y - q10, so that about 10 %
    # of hours fall below it, the upper edge by the 90th percentile of y - q90
    q["qr_lo"], _ = FM.rolling_residual_band(q, "q10")
    _, q["qr_hi"] = FM.rolling_residual_band(q, "q90")
    start = q["date"].min() + pd.Timedelta(days=180 + 8)
    q = q[q["date"] >= start]
    rows = []
    q["period"] = np.where(q["date"] >= pd.Timestamp("2026-09-01"), "after", "before")
    for period, qp in list(q.groupby("period")) + [("full", q)]:
        for h, qh in qp.groupby("h"):
            for name, lo, hi in (("recipe", "r_lo", "r_hi"), ("raw", "q10", "q90"), ("qr_recipe", "qr_lo", "qr_hi")):
                s = qh.dropna(subset=[lo, hi])
                rows.append({"period": period, "h": int(h), "method": name, "n": len(s),
                             "coverage": FM.coverage(s["y"], s[lo], s[hi]),
                             "width": float((s[hi] - s[lo]).mean()),
                             "interval_score": float(FM.interval_score(s["y"], s[lo], s[hi]).mean()),
                             "below": float((s["y"] < s[lo]).mean()), "above": float((s["y"] > s[hi]).mean())})
    pd.DataFrame(rows).to_csv(os.path.join(DIR, "quantile_scores.csv"), index=False)
    print(pd.DataFrame(rows).round(3).to_string())


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--score", action="store_true")
    args = ap.parse_args()
    score() if args.score else run(args)
