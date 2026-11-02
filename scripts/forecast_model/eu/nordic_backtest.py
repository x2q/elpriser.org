#!/usr/bin/env python3
"""Rolling-origin backtest of the EXISTING Nordic model (scripts/forecast_model/nordic: pooled LightGBM, 13 zones DK1 DK2 NO1-5
SE1-4 FI NL), re-run on the CURRENT Nordic dataset so it covers 2025-04 .. 2026-10 (the stored backtest_nordic.parquet stops at
2026-07-30, before the price-level shift of September) and with the same folds as the EU backtest (expanding window, retrained
every STEP months), so the Nordic zones can be compared with the EU candidates on the same days.

Only the MEDIAN model is fitted (the bands are not what is compared); features and hyper-parameters are the Nordic job's own.
`--variant fuel` adds the leak-free gas / carbon columns of fuel_dataset.py to the Nordic features: the same ablation the EU
backtest has, so "does gas help the hydro zones" is measured, not assumed.

    python3 nordic_backtest.py --dataset dataset_nordic_fuel.parquet --variant base|fuel [--step 2] [--jobs 10]
Output: backtest_nordic_<variant>.parquet with p_md (the model) and hyb (the model's level + the 50/50 seasonal shape, which is
what the Nordic job publishes).
"""
import argparse
import os
import time

import lightgbm as lgb
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))

# copied from nordic/backtest.py (the Nordic job's own list)
FEATS = ["zone", "h", "hour", "weekday", "month", "is_weekend", "doy_sin", "doy_cos",
         "lag1", "lag2", "lag3", "lag7", "lag14", "lag21", "lag28",
         "seasonal4w", "last_day_mean", "level_30d",
         "wind", "rad", "temp", "precip", "precip_24h",
         "reg_wind", "reg_temp", "hydro_precip", "hydro_precip_7d",
         "reservoir_pct", "reservoir_anom", "nordic_reservoir_anom"]
FUEL = ["gas", "gas_d7", "gas_d28", "gas_m1_spread", "eua", "eua_d7", "eua_d28", "ccgt_mc", "ccgt_mc_d7", "ccgt_mc_d28", "mc_gap"]
RES = {"reservoir_pct", "reservoir_anom"}          # legitimately empty for DK1/DK2/NL: never in the dropna subset
BLEND = 0.5


def blend(frame, col):
    g = frame.groupby(["zone", "date", "h"], observed=True, sort=False)
    pm = g[col].transform("mean")
    sm = g["seasonal4w"].transform("mean")
    out = pm + (1 - BLEND) * (frame[col] - pm) + BLEND * (frame["seasonal4w"] - sm)
    return out.where(sm.notna(), frame[col])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default="dataset_nordic_fuel.parquet")
    ap.add_argument("--variant", default="base", choices=["base", "fuel"])
    ap.add_argument("--first", default="2025-04")
    ap.add_argument("--last", default="2026-10")
    ap.add_argument("--step", type=int, default=2)
    ap.add_argument("--jobs", type=int, default=10)
    a = ap.parse_args()
    feats = FEATS + (FUEL if a.variant == "fuel" else [])
    req = [c for c in feats if not c.startswith("lag") and c != "zone" and c not in RES]
    df = pd.read_parquet(os.path.join(DIR, a.dataset))
    df["t"] = pd.to_datetime(df["t"])
    df["date"] = df["t"].dt.normalize()
    df = df[df["h"] <= 7].sort_values("t")
    folds = pd.period_range(a.first, a.last, freq="M")
    out = []
    for i in range(0, len(folds), a.step):
        lo, hi = folds[i].start_time, folds[min(i + a.step - 1, len(folds) - 1)].end_time
        train, test = df[df["date"] < lo], df[(df["date"] >= lo) & (df["date"] <= hi)].copy()
        if len(train) < 50_000 or not len(test):
            continue
        t0 = time.time()
        tr = train.dropna(subset=req)
        m = lgb.LGBMRegressor(objective="quantile", alpha=0.5, n_estimators=500, num_leaves=127, min_child_samples=40,
                              learning_rate=0.05, verbosity=-1, n_jobs=a.jobs)
        m.fit(tr[feats], tr["y"], categorical_feature=["zone"])
        test["p_md"] = m.predict(test[feats])
        out.append(test)
        print(f"  fold {lo:%Y-%m}..{hi:%Y-%m}: train {len(tr):,} test {len(test):,} in {time.time() - t0:.0f}s", flush=True)
    res = pd.concat(out, ignore_index=True)
    res["hyb"] = blend(res, "p_md")
    res.to_parquet(os.path.join(DIR, f"backtest_nordic_{a.variant}.parquet"), index=False)
    print("NORDIC BACKTEST DONE", flush=True)


if __name__ == "__main__":
    main()
