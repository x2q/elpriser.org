#!/usr/bin/env python3
"""The P10 / P90 band offsets of the Nordic job -> calibration_nordic_v2.json (the EU job's 'residual' recipe, eu/calibrate.py: the 10th / 90th percentile of
actual - forecast over the last 180 days of the out-of-sample backtest, times 1.2, added to the central estimate; per zone and horizon).

    python3 calibrate_nordic.py --recipe "hyb:r730lf+lrel13lf" --per-zone-recipe "dk1=p0_hyb,..." --out calibration_nordic_v2.json

Same recipe columns as build_gate_nordic.py, so the band that is published is the band whose coverage the accuracy block reports. Version 2 = gate.py's format
(`residual` section), so gate.offsets(cal, 'residual', zone, h) reads it."""
import argparse
import json
import os
import sys
from datetime import date

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import gate as G                  # noqa: E402
import score_nfr as SN            # noqa: E402

WINDOW_DAYS, SCALE, MIN_N = 180, 1.2, 200
ZONES = SN.NORDIC


def residual_bands(df, col):
    d = df.assign(resid=df["y"] - df[col]).dropna(subset=["resid"])
    end = d["date"].max() + pd.Timedelta(days=1)
    d = d[d["date"] >= end - pd.Timedelta(days=WINDOW_DAYS)]
    out = {}
    for (z, h), s in d.groupby(["zone", "h"]):
        if len(s) < MIN_N:
            continue
        lo, hi = np.percentile(s["resid"], [10, 90])
        out.setdefault(str(z), {})[str(int(h))] = {"lo": round(float(lo) * SCALE, 2), "hi": round(float(hi) * SCALE, 2)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--recipe", default="p0_hyb")
    ap.add_argument("--per-zone-recipe", default="")
    ap.add_argument("--out", default="calibration_nordic_v2.json")
    ap.add_argument("--decision", default="", help="decision_ens.json of decide_recipe.py (same as build_gate_nordic.py)")
    ap.add_argument("--gate", default="", help="the publish_gate_nordic.json just built: pooled-model bands (residualFallback) for the zones that carry a fallback")
    a = ap.parse_args()
    recipe_of = {z: a.recipe for z in ZONES}
    for kv in filter(None, a.per_zone_recipe.split(",")):
        z, c = kv.split("=")
        recipe_of[z] = c
    if a.decision:
        import decide_recipe as DR
        recipe_of = {z: c for z, (_, c) in DR.recipes_from_decision(a.decision).items()}
    df = SN.load(sorted(set(recipe_of.values()) | {"p0_hyb"}), None)
    df = df[df["h"].between(2, 8)]
    residual = {}
    for z in ZONES:
        sub = df[df["zone"] == z]
        residual.update(residual_bands(sub, recipe_of[z]))
    fallback = {}                                  # bands of the pooled model for the zones that carry a fallback in the gate file (build_gate_nordic.py)
    if a.gate:
        gz = json.load(open(a.gate))["zones"]
        for z in ZONES:
            if gz.get(z, {}).get("fallback"):
                fallback.update(residual_bands(df[df["zone"] == z], "p0_hyb"))
    cal = {"version": G.VERSION, "built": date.today().isoformat(), "through": f"{df['date'].max():%Y-%m-%d}", "windowDays": WINDOW_DAYS, "scale": SCALE,
           "quantile": {}, "residual": residual, "residualFallback": fallback}
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(G.dumps_compact(cal) + "\n")
    print(f"{a.out}: residual offsets for {len(residual)} zones ({sum(len(v) for v in residual.values())} zone-horizons) through {cal['through']}")


if __name__ == "__main__":
    main()
