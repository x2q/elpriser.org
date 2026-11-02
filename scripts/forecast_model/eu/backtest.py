#!/usr/bin/env python3
"""Rolling-origin backtest of the pooled EU model, horizons D+2 .. D+8, against four naive baselines.

Expanding window: every fold trains on all rows whose TARGET day is before the fold's first day (so no row of the test
period, and no row whose features could see it, is in training) and predicts the next STEP months. Only the median model
is fitted per fold; the P10/P90 bands are empirical residual quantiles (see calibrate.py), not model quantiles - the
Nordic model's lesson.

Variants (--variant, combinable with +, e.g. rel+nowx): raw     target = price
                      rel     target = price - level_7d (the model predicts the deviation from the zone's last-week level)
                      nolvl   raw, without the EU-level features (ablation of the cross-zone level features)
                      nowx    raw, without any weather feature (ablation of what weather adds)
                      fuel    adds the leak-free gas / carbon features of fuel_features.py (needs --dataset dataset_eu_fuel.parquet,
                              built by fuel_dataset.py): gas level and 7/28-day change, month-ahead spread, EUA level and changes,
                              CCGT marginal cost and its gap to the zone's recent level
                      gasonly like fuel, but gas only (no carbon): separates what each input contributes

Baselines (all use only what is known at issue time for the same horizon):
  lag7       the same hour one week before the target
  seasonal4w the mean of the same hour on the last four same weekdays
  persist    the same hour on the last KNOWN day (D+1 for the first forecast day)
  lvlshape   the seasonal4w profile shifted to the mean of the last 7 known days

    python3 backtest.py [--variant raw] [--first 2025-04] [--step 2] [--last 2026-10] [--jobs 8]
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
import features as F      # noqa: E402
import level_correction as LC   # noqa: E402
import metrics as M       # noqa: E402

PARAMS = dict(objective="quantile", alpha=0.5, n_estimators=400, num_leaves=63, min_child_samples=60,
              learning_rate=0.06, subsample=0.6, subsample_freq=1, colsample_bytree=0.8, max_bin=127, verbosity=-1)
NULLABLE = {"lag_last", "lag1", "lag2", "lag3"}          # empty by design at some horizons
FUEL_FEATS = ["gas", "gas_d7", "gas_d28", "gas_m1_spread", "eua", "eua_d7", "eua_d28", "ccgt_mc", "ccgt_mc_d7", "ccgt_mc_d28", "mc_gap"]
GAS_FEATS = ["gas", "gas_d7", "gas_d28", "gas_m1_spread"]


def flags(variant):
    """'rel+nowx' -> {'rel', 'nowx'}: variants combine."""
    return set(variant.split("+"))


def feats_for(variant):
    f = list(F.FEATS)
    if "nolvl" in flags(variant):
        f = [c for c in f if not c.startswith("eu_") and c != "level_30d_vs_eu"]
    if "nowx" in flags(variant):
        f = [c for c in f if c not in F.WX and c not in ("precip_24h", "reg_wind", "reg_rad", "reg_temp")]
    if "fuel" in flags(variant):
        f += FUEL_FEATS
    elif "gasonly" in flags(variant):
        f += GAS_FEATS
    return f


def required(feats):
    """Columns that must be non-null for a training row. Lags are nullable by design (k < h - 1); the weather and the
    level statistics are not."""
    return [c for c in feats if not c.startswith("lag") and c != "zone" and c != "seasonal4w"]


def fit(train, feats, variant, jobs):
    tr = train.dropna(subset=required(feats) + ["y"])
    y = tr["y"] - tr["level_7d"] if "rel" in flags(variant) else tr["y"]
    m = lgb.LGBMRegressor(n_jobs=jobs, **PARAMS)
    m.fit(tr[feats], y, categorical_feature=["zone"])
    return m, len(tr)


def predict(m, test, feats, variant):
    p = m.predict(test[feats])
    return p + test["level_7d"].to_numpy() if "rel" in flags(variant) else p


def run(args):
    df = pd.read_parquet(os.path.join(DIR, args.dataset))
    df["t"] = pd.to_datetime(df["t"])
    df["date"] = df["t"].dt.normalize()
    df = df.sort_values("t")
    feats = feats_for(args.variant)
    folds = pd.period_range(args.first, args.last, freq="M")
    out = []
    for i in range(0, len(folds), args.step):
        lo = folds[i].start_time
        hi = folds[min(i + args.step - 1, len(folds) - 1)].end_time
        train = df[df["date"] < lo]
        test = df[(df["date"] >= lo) & (df["date"] <= hi)].copy()
        if len(train) < 100_000 or not len(test):
            continue
        t0 = time.time()
        m, n = fit(train, feats, args.variant, args.jobs)
        test["p_md"] = predict(m, test, feats, args.variant)
        out.append(test)
        print(f"  fold {lo:%Y-%m}..{hi:%Y-%m}: train {n:,} test {len(test):,} in {time.time() - t0:.0f}s", flush=True)
    res = pd.concat(out, ignore_index=True)
    res["p_raw"] = res["p_md"]
    # the trailing level correction (level_correction.py; only error days settled at issue time are used) is always computed
    # and kept as p_corr for the evidence; p_md - what is scored, calibrated and published - is the uncorrected model unless
    # --lam > 0, because the correction is a SHADOW until the live archive has confirmed it (see level_correction.py)
    res["p_corr"] = res["p_raw"] + LC.apply_to_backtest(res, LC.LAMBDA)
    if args.lam > 0:
        res["p_md"] = res["p_raw"] + LC.apply_to_backtest(res, args.lam)
    res["hyb"] = M.blend(res, "p_md")
    res["b_lag7"] = res["lag7"]
    res["b_seasonal"] = res["seasonal4w"]
    res["b_persist"] = res["lag_last"]
    res["b_lvlshape"] = M.level_shape(res)
    res.to_parquet(os.path.join(DIR, f"backtest_eu_{args.variant.replace('+', '_')}{args.tag}.parquet"), index=False)
    return res


COLS = {"model": "p_md", "hybrid": "hyb", "lag7": "b_lag7", "seasonal": "b_seasonal",
        "persist": "b_persist", "lvlshape": "b_lvlshape"}


def report(res, tag=""):
    keep = res.dropna(subset=["b_lag7", "b_seasonal", "b_persist", "b_lvlshape", "p_md"])
    sc = M.scorecard(keep, COLS)
    sc.to_csv(os.path.join(DIR, f"backtest_eu_scorecard{tag}.csv"), index=False)
    pd.set_option("display.width", 250)
    by_h = sc.groupby("h").apply(lambda g: pd.Series({
        **{f"{k}_mae": np.average(g[f"{k}_mae"], weights=g.n_days) for k in COLS},
        **{f"{k}_regret": np.average(g[f"{k}_regret"], weights=g.n_days) for k in COLS},
        "regret_avg_hour": np.average(g.regret_avg_hour, weights=g.n_days)}), include_groups=False)
    print("\n=== all zones, day-weighted, by horizon (MAE EUR/MWh; regret EUR/MWh) ===")
    print(by_h.round(1).to_string())
    return sc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", default="rel", type=str)
    ap.add_argument("--dataset", default="dataset_eu.parquet")
    ap.add_argument("--tag", default="", help="suffix of the output files")
    ap.add_argument("--first", default="2025-04")
    ap.add_argument("--last", default=None)
    ap.add_argument("--step", type=int, default=2)
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--lam", type=float, default=0.0, help="level correction strength applied to p_md (default 0 = off: shadow only); p_raw/p_corr are always stored")
    a = ap.parse_args()
    if a.last is None:
        a.last = str(pd.Timestamp.today().to_period("M"))
    report(run(a), a.tag)
    print("BACKTEST DONE", flush=True)


if __name__ == "__main__":
    main()
