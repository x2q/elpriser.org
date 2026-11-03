#!/usr/bin/env python3
"""From backtest_gb.parquet to the two files that decide what the Great Britain job publishes:

    gb_gate.json         what is published (rest of today per as-of hour, D+1 .. D+7) and what it is worth (the accuracy blocks, GBP/MWh)
    gb_calibration.json  the P10 / P90 band offsets per lead class

    GB_DATA_DIR=. python3 build_gate_gb.py [--out-dir .]

The published point forecast is `c_ens`, the EU recipe retrained on Great Britain (mean of a 365-day ridge and a LightGBM on the residual of level + shape) with the
intraday features. A class is published only if its mean absolute error is at least 5 % below level + shape on the whole backtest AND on the hold-out
(2026-07-01 ..), and not above persistence (the last complete day's same hour) - the EU model's publish rule plus a guard against a weak baseline in a
rising market. The band is the EU quantile-edge recipe (calibrate_bands.py): LightGBM P10 / P90 models of the residual, each edge moved by 1.2 x the 10th / 90th
percentile of its own miss over the last 180 days of out-of-sample targets; measured coverage is rolling (offsets from targets settled 8+ days before each month).
"""
import argparse
import json
import os
import sys
from datetime import date

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
sys.path.insert(1, os.path.join(DIR, "..", "eu"))
import gbmodels as GM                               # noqa: E402

DATA = os.environ.get("GB_DATA_DIR", DIR)
HOLD = pd.Timestamp("2026-07-01")
SINCE = pd.Timestamp("2026-09-01")
MIN_GAIN = 0.05
LOW_GAIN = 0.10
EMBARGO_DAYS = 8
TEST_ASOF = (2, 8, 14)
POINT = "c_ens"
VERSION = 1


def rolling_band(df, window=GM.BAND_WINDOW_DAYS, scale=GM.BAND_SCALE, block_days=30):
    """Rows of df with lo / hi columns, measured the way production works: for each block of `block_days`, the offsets come only from targets settled at least
    EMBARGO_DAYS before the block starts and not older than `window` days. Blocks start after window + embargo days of history."""
    df = df.dropna(subset=["y", "q10", "q90", POINT]).copy()
    df["cls"] = GM.lead_class(df)
    first = df["date"].min() + pd.Timedelta(days=window + EMBARGO_DAYS)
    out = []
    start = first
    while start <= df["asof_date"].max():
        end = start + pd.Timedelta(days=block_days)
        hist = df[(df["date"] < start - pd.Timedelta(days=EMBARGO_DAYS)) & (df["date"] >= start - pd.Timedelta(days=window + EMBARGO_DAYS))]
        off = GM.band_offsets(hist, window_days=window, scale=scale)
        blk = df[(df["asof_date"] >= start) & (df["asof_date"] < end)].copy()
        if off and len(blk):
            blk["lo"], blk["hi"] = GM.apply_band(blk, blk[POINT], blk["q10"], blk["q90"], off)
            out.append(blk.dropna(subset=["lo", "hi"]))
        start = end
    return pd.concat(out) if out else pd.DataFrame()


def day_matrix(s, col):
    """(date, a) -> 24 values for rows of full days (k >= 1)."""
    g = s.pivot_table(index=["asof_date", "a", "k"], columns="hr", values=col, aggfunc="mean").reindex(columns=range(24))
    return g


def regret_gain(s):
    """Cheapest-three-hours regret of the point forecast vs level + shape on full forecast days: (regret, baseRegret, rankGain)."""
    import metrics as M                      # the EU model's (scripts/forecast_model/eu/metrics.py; flat next to this file on the Spark)
    ok = s.dropna(subset=["y", POINT, "b_A"])
    A = day_matrix(ok, "y")
    F = day_matrix(ok, POINT)
    B = day_matrix(ok, "b_A")
    idx = A.index.intersection(F.index).intersection(B.index)
    if not len(idx):
        return None
    r = np.nanmean(M.regret(A.loc[idx].to_numpy(), F.loc[idx].to_numpy()))
    rb = np.nanmean(M.regret(A.loc[idx].to_numpy(), B.loc[idx].to_numpy()))
    return float(r), float(rb), float(1 - r / rb) if rb else None


def cell(s, band, full_days=False):
    """The accuracy cell of one class: s = backtest rows (with POINT), band = the rolling-band rows of the same class."""
    s = s.dropna(subset=["y", POINT, "b_A", "b_persist"])
    w = lambda x, a, b=None: x[(x["asof_date"] >= a) & ((x["asof_date"] < b) if b is not None else True)]
    mae = lambda x, c: float((x[c] - x["y"]).abs().mean())
    hold, since = w(s, HOLD), w(s, SINCE)
    out = {"mae": mae(s, POINT), "baseMae": mae(s, "b_A"), "persistMae": mae(s, "b_persist"),
           "gainHold": 1 - mae(hold, POINT) / mae(hold, "b_A"), "gainRecent": 1 - mae(since, POINT) / mae(since, "b_A"),
           "bias": float((s[POINT] - s["y"]).mean()), "baseBias": float((s["b_A"] - s["y"]).mean()),
           "biasRecent": float((since[POINT] - since["y"]).mean()), "maeRecent": mae(since, POINT), "baseMaeRecent": mae(since, "b_A")}
    out["gain"] = 1 - out["mae"] / out["baseMae"]
    cov = lambda b: float(((b["y"] >= b["lo"]) & (b["y"] <= b["hi"])).mean()) if len(b) else None
    out["coverage"], out["coverageRecent"] = cov(band), cov(band[band["asof_date"] >= SINCE]) if len(band) else None
    out["width"] = float((band["hi"] - band["lo"]).mean()) if len(band) else None
    out["n"] = int(len(s))
    out["days"] = int(s["asof_date"].nunique())
    out["publish"] = bool(out["gain"] >= MIN_GAIN and out["gainHold"] >= MIN_GAIN and out["mae"] <= out["persistMae"] and out["coverage"] is not None)
    out["low"] = bool(min(out["gain"], out["gainHold"], out["gainRecent"]) < LOW_GAIN)
    if full_days:
        rg = regret_gain(s)
        if rg:
            out["regret"], out["baseRegret"], out["rankGain"] = rg
            out["rankOk"] = bool(rg[2] is not None and rg[2] >= MIN_GAIN)
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in out.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=DATA)
    a = ap.parse_args()
    df = pd.read_parquet(os.path.join(DATA, "backtest_gb.parquet"))
    df["asof_date"], df["date"] = pd.to_datetime(df["asof_date"]), pd.to_datetime(df["date"])
    df = df.dropna(subset=[POINT, "q10", "q90", "y"])
    band = rolling_band(df)
    band["cls"] = GM.lead_class(band)
    rest, days = {}, {}
    for a_ in sorted(df["a"].unique()):
        s = df[(df["a"] == a_) & (df["k"] == 0)]
        b = band[(band["a"] == a_) & (band["k"] == 0)]
        rest[str(int(a_))] = cell(s, b)
    for k in range(1, 8):
        s = df[(df["k"] == k) & df["a"].isin(TEST_ASOF)]
        b = band[(band["k"] == k) & band["a"].isin(TEST_ASOF)]
        days[str(k)] = cell(s, b, full_days=True)
    end = df["date"].max()
    cal_rows = df[df["date"] > end - pd.Timedelta(days=GM.BAND_WINDOW_DAYS)].copy()
    cal_rows["cls"] = GM.lead_class(cal_rows)
    offsets = GM.band_offsets(cal_rows)
    gate = {"version": VERSION, "built": date.today().isoformat(), "period": f"{df['asof_date'].min():%Y-%m-%d}..{df['asof_date'].max():%Y-%m-%d}",
            "holdOut": f"{HOLD:%Y-%m-%d}..", "recent": f"{SINCE:%Y-%m-%d}", "model": "gb-est-v1", "unit": "GBP/MWh", "baseline": "level+shape",
            "recipe": "mean of a 365-day rolling ridge and LightGBM on the residual of level+shape, with the realised hours of today as features",
            "rule": "a class is published only if its MAE is at least 5 % below level+shape on the whole backtest and on the hold-out, and not above persistence",
            "rest": rest, "days": days}
    cal = {"version": VERSION, "built": date.today().isoformat(), "through": f"{end:%Y-%m-%d}", "windowDays": GM.BAND_WINDOW_DAYS, "scale": GM.BAND_SCALE, "offsets": offsets}
    os.makedirs(a.out_dir, exist_ok=True)
    with open(os.path.join(a.out_dir, "gb_gate.json"), "w", encoding="utf-8") as f:
        json.dump(gate, f, indent=1)
        f.write("\n")
    with open(os.path.join(a.out_dir, "gb_calibration.json"), "w", encoding="utf-8") as f:
        json.dump(cal, f, indent=1)
        f.write("\n")
    print(f"{'class':8s} {'n':>6s} {'mae':>6s} {'base':>6s} {'persist':>7s} {'gain':>6s} {'hold':>6s} {'since':>6s} {'biasR':>6s} {'cov':>5s} {'covR':>5s} publish low")
    for name, cells in (("rest@", rest), ("D+", days)):
        for k, c in cells.items():
            print(f"{name + k:8s} {c['n']:6d} {c['mae']:6.1f} {c['baseMae']:6.1f} {c['persistMae']:7.1f} {c['gain']:6.1%} {c['gainHold']:6.1%} {c['gainRecent']:6.1%} "
                  f"{c['biasRecent']:6.1f} {c['coverage'] or 0:5.2f} {c['coverageRecent'] or 0:5.2f} {c['publish']!s:7s} {c['low']}")
    print("offsets", json.dumps(offsets))


if __name__ == "__main__":
    main()
