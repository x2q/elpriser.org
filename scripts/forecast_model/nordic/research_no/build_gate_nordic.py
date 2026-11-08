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
POOLED_COL = "p0_hyb"                      # the production model's research column


def build(df, recipe_of, label_of=None):
    """df: research frame with y, b_lvlshape, b_lag7, b_seasonal, b_persist and the recipe columns. recipe_of: zone -> column name.
    Returns (gate, accuracy, notes)."""
    label_of = label_of or recipe_of
    df = df[df["zone"].isin(ZONES) & df["h"].between(H_MIN, H_MAX)].copy()
    df["pub"] = np.nan
    for z in ZONES:
        m = df["zone"] == z
        df.loc[m, "pub"] = df.loc[m, recipe_of[z]]
    s = RS.score(df, cols=RS.NAIVE + ["pub"])
    cov = BG.coverage_table(df, "pub")
    gz, az, notes = {}, {}, []
    for z in ZONES:
        gz[z] = {"recipe": label_of[z], "horizons": []}
        az[z] = {"recipe": label_of[z], "showEur": False, "cells": {}}
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
    ap.add_argument("--decision", default="", help="decision_ens.json of decide_recipe.py: recipe per zone by name (pooled, ens, ens365, ens_nr, ens_b25 ...); the file then says the NAME")
    a = ap.parse_args()
    recipe_of = {z: a.recipe for z in ZONES}
    for kv in filter(None, a.per_zone_recipe.split(",")):
        z, c = kv.split("=")
        recipe_of[z] = c
    label_of = dict(recipe_of)
    if a.decision:
        import decide_recipe as DR
        rec = DR.recipes_from_decision(a.decision)
        recipe_of, label_of = {z: rec[z][1] for z in ZONES}, {z: rec[z][0] for z in ZONES}
    import score_nfr as SN                      # materialises 'a+b' (mean) and 'hyb:...' (the Nordic shape blend) columns of nfr_all.parquet
    df = SN.load(sorted(set(recipe_of.values()) | {POOLED_COL}), None)
    gate, acc, notes = build(df, recipe_of, label_of)
    # FALLBACK: a zone whose recipe is not the pooled model (needs fuel) also carries the pooled model's own gate entry and accuracy cells, built by the same code and rule
    # (what the job publishes for that zone on a day the fuel inputs are unusable); a zone the pooled model does not pass anywhere (NO1-NO5) has none.
    if any(recipe_of[z] != POOLED_COL for z in ZONES):
        gate_p, acc_p, _ = build(df, {z: POOLED_COL for z in ZONES}, {z: "pooled" for z in ZONES})
        for z in ZONES:
            if recipe_of[z] != POOLED_COL and gate_p["zones"][z]["horizons"]:
                gate["zones"][z]["fallback"] = gate_p["zones"][z]
                acc["zones"][z]["fallback"] = {"recipe": "pooled", "showEur": False, "cells": acc_p["zones"][z]["cells"]}
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
