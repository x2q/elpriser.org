#!/usr/bin/env python3
"""The Nordic gate and accuracy files, built exactly like the EU ones (eu/build_gate.py: same scorer, same 5 % rule on the whole backtest AND the hold-out,
same accuracy cell with MAE, bias, regret, coverage, low flag), for the 13 zones of the Nordic job and horizons D+2 .. D+8.

    python3 build_gate_nordic.py --frame nfr_all.parquet --recipe p0_hyb [--out-dir .] [--per-zone-recipe no1=colA,no2=colB]

`--recipe` is the forecast column that production would publish (a column of the research frame); `--per-zone-recipe` lets a zone group use another column
(chosen on the select period, see docs/forecast-nordic-no.md). Output: publish_gate_nordic.json and accuracy_nordic.json (version 2, same cell shape as
accuracy_eu.json, one recipe per zone, no fuel / nofuel split: the Nordic job has one mode). Run it in a directory that has the EU research modules
(region_scores.py, build_gate.py, gate.py, family_models.py, metrics.py, region_models.py).
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
import build_gate as BG          # noqa: E402  (eu/build_gate.py: cell(), coverage_table())
import gate as G                 # noqa: E402
import region_scores as RS       # noqa: E402

ZONES = ["dk1", "dk2", "no1", "no2", "no3", "no4", "no5", "se1", "se2", "se3", "se4", "fi", "nl"]
H_MIN, H_MAX = 2, 8
MIN_GAIN = 0.05


def build(df, recipe_of):
    """df: research frame with y, b_lvlshape, b_lag7, b_seasonal, b_persist and the recipe columns. recipe_of: zone -> column name.
    Returns (gate, accuracy, notes)."""
    df = df[df["zone"].isin(ZONES) & df["h"].between(H_MIN, H_MAX)].copy()
    df["pub"] = np.nan
    for z in ZONES:
        m = df["zone"] == z
        df.loc[m, "pub"] = df.loc[m, recipe_of[z]]
    s = RS.score(df, cols=RS.NAIVE + ["pub"])
    cov = BG.coverage_table(df, "pub")
    gz, az, notes = {}, {}, []
    for z in ZONES:
        gz[z] = {"recipe": recipe_of[z], "horizons": []}
        az[z] = {"recipe": recipe_of[z], "showEur": False, "cells": {}}
        for h in range(H_MIN, H_MAX + 1):
            r = BG.cell(s, z, h, "pub", cov, "fuel")
            if r is None:
                continue
            c, ok = r
            if ok:
                gz[z]["horizons"].append(h)
                az[z]["cells"][str(h)] = c
            else:
                notes.append(f"{z} D+{h}: not published (gain {c['gain']:.1%}, hold-out {c['gainHold']})")
    period = f"{df['date'].min():%Y-%m-%d}..{df['date'].max():%Y-%m-%d}"
    meta = {"version": G.VERSION, "built": date.today().isoformat(), "period": period}
    gate = {**meta, "rule": "a zone-horizon is published only if the recipe's MAE is at least 5 % below the naive level+shape method on the hold-out (2026-07-01..) and on the whole backtest",
            "zones": gz}
    acc = {**meta, "baseline": "level+shape", "recent": RS.T_SHIFT.strftime("%Y-%m-%d"), "zones": az}
    return gate, acc, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frame", default="nfr_all.parquet")
    ap.add_argument("--recipe", default="p0_hyb")
    ap.add_argument("--per-zone-recipe", default="")
    ap.add_argument("--out-dir", default=".")
    a = ap.parse_args()
    recipe_of = {z: a.recipe for z in ZONES}
    for kv in filter(None, a.per_zone_recipe.split(",")):
        z, c = kv.split("=")
        recipe_of[z] = c
    import score_nfr as SN                      # materialises 'a+b' (mean) and 'hyb:...' (the Nordic shape blend) columns of nfr_all.parquet
    df = SN.load(sorted(set(recipe_of.values())), None)
    gate, acc, notes = build(df, recipe_of)
    with open(os.path.join(a.out_dir, "publish_gate_nordic.json"), "w", encoding="utf-8") as f:
        f.write(G.dumps_compact(gate) + "\n")
    with open(os.path.join(a.out_dir, "accuracy_nordic.json"), "w", encoding="utf-8") as f:
        f.write(G.dumps_compact(acc) + "\n")
    n = sum(len(v["horizons"]) for v in gate["zones"].values())
    print(f"publish_gate_nordic.json / accuracy_nordic.json: {len(ZONES)} zones, period {gate['period']}; horizons published {n} of {len(ZONES) * (H_MAX - H_MIN + 1)}")
    for z in ZONES:
        print(f"  {z}: D+{gate['zones'][z]['horizons']}")
    for line in notes:
        print("  " + line)


if __name__ == "__main__":
    main()
