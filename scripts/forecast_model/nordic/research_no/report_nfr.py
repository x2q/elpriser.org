#!/usr/bin/env python3
"""How solid is a gate pass? For one recipe column (or an 'a+b' mean) against level+shape, per zone and horizon: the gain on the whole backtest, the hold-out and
each calendar quarter, a day-block bootstrap (2000 resamples of whole days) of the hold-out gain and of the whole-backtest gain, and the regret gains.
    python3 report_nfr.py r730+lrel13 [--zones no1,no2,...] [--hs 2,5,7] [--boot 2000]
"""
import argparse
import os
import sys

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import score_nfr as SN      # noqa: E402
import metrics as M         # noqa: E402

T_HOLD = pd.Timestamp("2026-07-01")
T_SHIFT = pd.Timestamp("2026-09-01")


def day_table(sub, col):
    s = sub.dropna(subset=[col, "b_lvlshape", "y"])
    g = s.assign(em=(s[col] - s["y"]).abs(), eb=(s["b_lvlshape"] - s["y"]).abs()).groupby("date")[["em", "eb"]].sum()
    return g


def regret_gain(sub, col, lo=None):
    s = sub.dropna(subset=[col, "b_lvlshape", "y"])
    if lo is not None:
        s = s[s["date"] >= lo]
    cnt = s.groupby("date")["y"].transform("size")
    s = s[cnt == 24].sort_values(["date", "hour"])
    n = len(s) // 24
    if not n:
        return np.nan
    Y = s["y"].to_numpy().reshape(n, 24)
    rm = np.nanmean(M.regret(Y, s[col].to_numpy().reshape(n, 24)))
    rb = np.nanmean(M.regret(Y, s["b_lvlshape"].to_numpy().reshape(n, 24)))
    return 100 * (1 - rm / rb)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("col")
    ap.add_argument("--zones", default=",".join(SN.NO))
    ap.add_argument("--hs", default="2,3,4,5,6,7,8")
    ap.add_argument("--boot", type=int, default=2000)
    a = ap.parse_args()
    zones, hs = a.zones.split(","), [int(h) for h in a.hs.split(",")]
    df = SN.load([a.col], zones)
    rng = np.random.default_rng(7)
    print(f"{a.col}: gain % vs level+shape; whole | hold-out [90 % day-block bootstrap interval of the hold-out gain] | quarters | regret gain whole / hold-out")
    for z in zones:
        for h in hs:
            sub = df[(df["zone"] == z) & (df["h"] == h)]
            d = day_table(sub, a.col)
            if d.empty:
                continue
            gw = 100 * (1 - d.em.sum() / d.eb.sum())
            dh = d[d.index >= T_HOLD]
            gh = 100 * (1 - dh.em.sum() / dh.eb.sum())
            idx = rng.integers(0, len(dh), size=(a.boot, len(dh)))
            em, eb = dh.em.to_numpy(), dh.eb.to_numpy()
            bs = 100 * (1 - em[idx].sum(axis=1) / eb[idx].sum(axis=1))
            q = d.groupby(d.index.to_period("Q")).sum()
            qs = " ".join(f"{100 * (1 - r.em / r.eb):5.1f}" for r in q.itertuples())
            rg, rh = regret_gain(sub, a.col), regret_gain(sub, a.col, T_HOLD)
            print(f"{z} D+{h}: {gw:5.1f} | {gh:5.1f} [{np.percentile(bs, 5):5.1f}, {np.percentile(bs, 95):5.1f}] | {qs} | {rg:5.1f} / {rh:5.1f}")
    print("quarters: " + " ".join(str(p) for p in pd.period_range("2025-04-01", "2026-11-02", freq="Q")))


if __name__ == "__main__":
    main()
