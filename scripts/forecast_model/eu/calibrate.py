#!/usr/bin/env python3
"""From the backtest to the two files the daily job publishes with each forecast.

    python3 calibrate.py [--variant raw]      reads backtest_eu_<variant>.parquet, writes calibration_eu.json, accuracy_eu.json

calibration_eu.json   {zone: {h: {lo, hi}}}  additive P10 / P90 offsets: the 10th and 90th percentile of (actual - forecast)
                      per zone and horizon over the LAST WINDOW_DAYS of the backtest, times BAND_SCALE. Empirical residual
                      quantiles, not scaled model quantiles (the Nordic lesson: scaling needed 8x in flat zones and still
                      missed 80 %). Why a recent window and a scale: error is not stationary (2026 was more volatile than 2025),
                      and a band fitted on the whole backtest covered only ~69 % when scored on the following months. Measured
                      rolling out of sample (bands from residuals settled 8+ days before each month), 180 days x 1.2 covers
                      80 % at D+2, D+5 and D+7. The file ages: re-run backtest + calibrate monthly.
accuracy_eu.json      {zone: {backtest: {...}}} what the forecast is WORTH in this zone, per horizon, for the page to state.
                      Besides MAE and regret it carries the HONEST comparison: the same error of the best naive baseline,
                      the skill (how much smaller the model's error is) and `coverageP10P90`, the share of hours inside the
                      P10-P90 band measured ROLLING OUT OF SAMPLE with the very recipe that makes the published band, so the
                      band is not graded on the data that set it.
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
WINDOW_DAYS = 180
BAND_SCALE = 1.2
SETTLE_LAG_DAYS = 8       # a forecast's error is known once its target day has settled: at most 8 days after issue


def residual_bands(res, col="p_md", window_days=WINDOW_DAYS, scale=BAND_SCALE, until=None):
    """{zone: {h: {lo, hi}}} from the 10th/90th percentile of actual - forecast over the last `window_days` before `until`
    (default: the newest date in `res`), multiplied by `scale`. window_days=None uses everything."""
    d = res.assign(resid=res["y"] - res[col]).dropna(subset=["resid"])
    d["date"] = pd.to_datetime(d["date"])
    end = pd.Timestamp(until) if until is not None else d["date"].max() + pd.Timedelta(days=1)
    d = d[d["date"] < end]
    if window_days:
        d = d[d["date"] >= end - pd.Timedelta(days=window_days)]
    out = {}
    for (z, h), s in d.groupby(["zone", "h"], observed=True):
        if len(s) < MIN_N:
            continue
        lo, hi = np.percentile(s["resid"], [10, 90])
        out.setdefault(str(z), {})[str(int(h))] = {"lo": round(float(lo) * scale, 2), "hi": round(float(hi) * scale, 2)}
    return out


def rolling_coverage(res, col="p_md", window_days=WINDOW_DAYS, scale=BAND_SCALE, block_days=30, warmup_days=None):
    """{(zone, h): share of hours inside P10-P90}, measured the way production works: for each block of `block_days`, the band
    comes only from residuals of targets settled at least SETTLE_LAG_DAYS before the block starts. Blocks start after
    `warmup_days` of history (default: window_days)."""
    d = res.copy()
    d["date"] = pd.to_datetime(d["date"])
    warm = window_days if warmup_days is None else warmup_days
    t0 = d["date"].min() + pd.Timedelta(days=warm)
    hits, n = {}, {}
    start = t0
    while start <= d["date"].max():
        stop = start + pd.Timedelta(days=block_days)
        test = d[(d["date"] >= start) & (d["date"] < stop)]
        bands = residual_bands(d, col, window_days, scale, until=start - pd.Timedelta(days=SETTLE_LAG_DAYS))
        for (z, h), s in test.groupby(["zone", "h"], observed=True):
            b = bands.get(str(z), {}).get(str(int(h)))
            if b is None or s.empty:
                continue
            ok = (s["y"] >= s[col] + b["lo"]) & (s["y"] <= s[col] + b["hi"])
            k = (str(z), int(h))
            hits[k] = hits.get(k, 0) + int(ok.sum())
            n[k] = n.get(k, 0) + len(s)
        start = stop
    return {k: hits[k] / n[k] for k in hits if n[k] > 0}


def accuracy(res, first, last, col="p_md"):
    """{zone: {backtest: {period, byHorizon: {h: {...}}}}} from the backtest frame."""
    keep = res.dropna(subset=[col] + list(NAIVE.values()))
    cols = {"model": col, **{k: v for k, v in NAIVE.items()}}
    sc = M.scorecard(keep, cols)
    cov = rolling_coverage(keep, col)
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
