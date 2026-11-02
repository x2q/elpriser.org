#!/usr/bin/env python3
"""From the backtest to the two files the daily job publishes with each forecast.

    python3 calibrate.py [--variant raw]      reads backtest_eu_<variant>.parquet, writes calibration_eu.json, accuracy_eu.json

calibration_eu.json   {zone: {h: {lo, hi}}}  additive P10 / P90 offsets: the 10th and 90th percentile of (actual - forecast)
                      per zone and horizon over the whole backtest. Empirical residual quantiles, not scaled model quantiles
                      (the Nordic lesson: scaling needed 8x in flat zones and still missed 80 %).
accuracy_eu.json      {zone: {backtest: {...}}} what the forecast is WORTH in this zone, per horizon, for the page to state.
                      Besides MAE and regret it carries the HONEST comparison: the same error of the best naive baseline,
                      the skill (how much smaller the model's error is) and `coverage`, the share of hours inside the P10-P90
                      band measured OUT OF SAMPLE (the band from the older part of the backtest, scored on its newest third),
                      so the band is not graded on the data that set it.
"""
import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import metrics as M      # noqa: E402

NAIVE = {"lag7": "b_lag7", "seasonal4w": "b_seasonal", "persist": "b_persist", "lvlshape": "b_lvlshape"}
MIN_N = 200               # rows needed for a (zone, h) quantile


def residual_bands(res, col="p_md"):
    """{zone: {h: {lo, hi}}} from the 10th/90th percentile of actual - forecast."""
    out = {}
    d = res.assign(resid=res["y"] - res[col]).dropna(subset=["resid"])
    for (z, h), s in d.groupby(["zone", "h"], observed=True):
        if len(s) < MIN_N:
            continue
        lo, hi = np.percentile(s["resid"], [10, 90])
        out.setdefault(str(z), {})[str(int(h))] = {"lo": round(float(lo), 2), "hi": round(float(hi), 2)}
    return out


def out_of_sample_coverage(res, col="p_md", frac=2 / 3):
    """{(zone, h): share of hours inside P10-P90} with the band fitted on the first `frac` of the dates and scored on the rest."""
    d = res.copy()
    d["date"] = pd.to_datetime(d["date"])
    cut = d["date"].quantile(frac)
    fit, test = d[d["date"] <= cut], d[d["date"] > cut]
    bands = residual_bands(fit, col)
    cov = {}
    for (z, h), s in test.groupby(["zone", "h"], observed=True):
        b = bands.get(str(z), {}).get(str(int(h)))
        if b is None or s.empty:
            continue
        ok = (s["y"] >= s[col] + b["lo"]) & (s["y"] <= s[col] + b["hi"])
        cov[(str(z), int(h))] = float(ok.mean())
    return cov


def accuracy(res, first, last, col="p_md"):
    """{zone: {backtest: {period, byHorizon: {h: {...}}}}} from the backtest frame."""
    keep = res.dropna(subset=[col] + list(NAIVE.values()))
    cols = {"model": col, **{k: v for k, v in NAIVE.items()}}
    sc = M.scorecard(keep, cols)
    cov = out_of_sample_coverage(keep, col)
    out = {}
    for _, r in sc.iterrows():
        z, h = str(r["zone"]), int(r["h"])
        naive = {k: r[f"{k}_mae"] for k in NAIVE}
        best_name = min(naive, key=naive.get)
        entry = {
            "days": int(r["n_days"]),
            "meanPrice": round(float(r["mean_price"]), 1),
            "mae": round(float(r["model_mae"]), 1),
            "dayMae": round(float(r["model_day_mae"]), 1),
            "bias": round(float(r["model_bias"]), 1),
            "bestNaive": best_name,
            "bestNaiveMae": round(float(naive[best_name]), 1),
            "skill": round(float(1 - r["model_mae"] / naive[best_name]), 3),
            "regret": round(float(r["model_regret"]), 1),
            "regretSeasonal": round(float(r["seasonal4w_regret"]), 1),
            "regretAvgHour": round(float(r["regret_avg_hour"]), 1),
        }
        if (z, h) in cov:
            entry["coverageP10P90"] = round(cov[(z, h)], 3)
        out.setdefault(z, {"backtest": {"period": f"{first}..{last}", "method": "rolling origin, expanding window, retrained every 2 months",
                                        "byHorizon": {}}})["backtest"]["byHorizon"][str(h)] = entry
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", default="raw")
    a = ap.parse_args()
    res = pd.read_parquet(os.path.join(DIR, f"backtest_eu_{a.variant}.parquet"))
    res["date"] = pd.to_datetime(res["date"])
    first, last = f"{res['date'].min():%Y-%m-%d}", f"{res['date'].max():%Y-%m-%d}"
    cal = residual_bands(res)
    acc = accuracy(res, first, last)
    with open(os.path.join(DIR, "calibration_eu.json"), "w", encoding="utf-8") as f:
        json.dump(cal, f, indent=1)
    with open(os.path.join(DIR, "accuracy_eu.json"), "w", encoding="utf-8") as f:
        json.dump(acc, f, indent=1)
    print(f"calibration_eu.json: {len(cal)} zones; accuracy_eu.json: {len(acc)} zones ({first}..{last})")


if __name__ == "__main__":
    main()
