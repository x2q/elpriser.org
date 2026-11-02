#!/usr/bin/env python3
"""Residual-quantile band helpers (the first build's 180-day x 1.2 recipe), kept for the FALLBACK band of a run without fuel and for the
rolling coverage measurement. The files the daily job reads are no longer written here:
    publish_gate.json, accuracy_eu.json   build_gate.py       (what is published, what it is worth)
    calibration_eu.json                   calibrate_bands.py  (the P10 / P90 offsets, monthly)

residual_bands(res)   {zone: {h: {lo, hi}}}  additive P10 / P90 offsets: the 10th and 90th percentile of (actual - forecast) per zone and
                      horizon over the LAST WINDOW_DAYS of a backtest, times BAND_SCALE. Empirical residual quantiles, not scaled model
                      quantiles (the Nordic lesson: scaling needed 8x in flat zones and still missed 80 %). Error is not stationary (2026 was
                      more volatile than 2025), so a recent window and a scale; measured rolling out of sample 180 days x 1.2 covers 81 % over
                      the whole backtest but only 67-69 % since September 2026.
rolling_coverage(res) {(zone, h): share of hours inside P10-P90}, measured the way production works: for each block of days the band comes
                      only from residuals of targets settled at least SETTLE_LAG_DAYS before the block starts.
"""
import os
import sys

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)

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
