#!/usr/bin/env python3
"""Score the candidate columns of nfr_all.parquet with the EU gate's own scorer (region_scores.score: MAE and regret, periods full / select / hold / after),
always against level+shape, on the rows where every compared column has a value.

    python3 score_nfr.py gains  col1,col2,...  [--zones no1,no2] [--hs 2,3,4,5,6,7,8] [--metric mae|regret]
    python3 score_nfr.py pooled col1,col2,...  [--zones ...]       one line per column: mean gain over the zones and horizons, by period (the selection table)
"""
import argparse
import os
import re
import sys

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import region_scores as RS      # noqa: E402

NORDIC = ["dk1", "dk2", "no1", "no2", "no3", "no4", "no5", "se1", "se2", "se3", "se4", "fi", "nl"]
NO = ["no1", "no2", "no3", "no4", "no5"]
BASE = "b_lvlshape"


def load(cols, zones=None):
    df = pd.read_parquet(os.path.join(DIR, "nfr_all.parquet"))
    df["date"] = pd.to_datetime(df["date"])
    if zones:
        df = df[df["zone"].isin(zones)]
    import metrics as M
    for c in cols:                                   # "a+b" = the mean of the two columns (an equal-weight ensemble, nothing fitted)
        m = re.match(r"hyb(\d+)?:(.*)$", c)         # "hyb:x" = the Nordic job's post-processing: daily level of x, intraday shape 50/50 own and the seasonal profile;
        expr = m.group(2) if m else c                 # "hyb25:x" / "hyb75:x" = the same with 25 / 75 % seasonal profile
        if "+" in expr:
            df[expr] = df[expr.split("+")].mean(axis=1, skipna=False)
        if m:
            df[c] = M.blend(df, expr, int(m.group(1)) / 100 if m.group(1) else 0.5)
    return df


def long_scores(df, cols):
    """Long score table for `cols` + baseline; the rows of every (zone, h) are the ones where all columns that exist for it have a value."""
    return RS.score(df, cols=[BASE] + list(cols))


def gain(sc, zone, h, col, period, metric="mae"):
    s = sc[(sc["zone"] == zone) & (sc["h"] == h) & (sc["period"] == period)].set_index("col")[metric]
    if col not in s or BASE not in s or not s[BASE]:
        return np.nan
    return 100 * (1 - s[col] / s[BASE])


def gains_table(df, cols, zones, hs, metric="mae"):
    sc = long_scores(df, cols)
    for c in cols:
        print(f"== {c}  gain % vs level+shape ({metric}), whole backtest / hold-out (select in brackets)   [the gate: both >= 5]")
        print("zone  " + "  ".join(f"      D+{h}      " for h in hs))
        for z in zones:
            cells = []
            for h in hs:
                f, o, s = (gain(sc, z, h, c, p, metric) for p in ("full", "hold", "select"))
                ok = "*" if (np.isfinite(f) and np.isfinite(o) and min(f, o) >= 5) else " "
                cells.append(f"{f:5.1f}/{o:5.1f}{ok}({s:5.1f})")
            print(f"{z:4s}  " + "  ".join(cells))
    return sc


def pooled_table(df, cols, zones, hs, metric="mae"):
    sc = long_scores(df, cols)
    print(f"pooled over zones {','.join(zones)} and horizons {hs[0]}..{hs[-1]}: mean gain % vs level+shape ({metric})")
    print(f"{'column':14s} " + " ".join(f"{p:>9s}" for p in ("select", "hold", "full", "after")) + "   cells passing the gate (full and hold >= 5)")
    for c in cols:
        vals = {p: np.nanmean([gain(sc, z, h, c, p, metric) for z in zones for h in hs]) for p in ("select", "hold", "full", "after")}
        npass = sum(1 for z in zones for h in hs if min(gain(sc, z, h, c, "full", metric), gain(sc, z, h, c, "hold", metric)) >= 5)
        print(f"{c:14s} " + " ".join(f"{vals[p]:9.1f}" for p in ("select", "hold", "full", "after")) + f"   {npass}/{len(zones) * len(hs)}")
    return sc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["gains", "pooled"])
    ap.add_argument("cols")
    ap.add_argument("--zones", default=",".join(NO))
    ap.add_argument("--hs", default="2,3,4,5,6,7,8")
    ap.add_argument("--metric", default="mae")
    a = ap.parse_args()
    zones, hs, cols = a.zones.split(","), [int(h) for h in a.hs.split(",")], a.cols.split(",")
    df = load(cols, zones)
    (gains_table if a.cmd == "gains" else pooled_table)(df, cols, zones, hs, a.metric)


if __name__ == "__main__":
    main()
