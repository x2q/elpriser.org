#!/usr/bin/env python3
"""Which recipe does each non-Norwegian Nordic zone publish: the pooled model (production) or the ensemble? A DECLARED, MECHANICAL rule (docs/forecast-nordic-ens.md).
Written and committed BEFORE the new candidates were scored; nothing here reads the hold-out to choose (the hold-out only enters through the gate's own 5 % veto).

    python3 decide_recipe.py [--frame nfr_all.parquet] [--zones dk1,dk2,se1,se2,se3,se4,nl,fi] [--out decision_ens.json]

CANDIDATES (declared up front; every one is a column of the research frame or computed from two; all scored on the SAME rows of a zone and horizon)
    pooled    p0_hyb                       the production model (pooled LightGBM, raw price target, 50/50 shape blend)
    ens       hyb:r730lf+lrel13lf          the staged Norway recipe: 730-day ridge + pooled LightGBM on price - level_7d, gas / carbon, leak-free reservoir, 50/50 shape
    ens_nr    hyb:r730nr+lrel13nr          ens without ANY reservoir feature (DK1, DK2 and NL have no reservoir series of their own)
    ens365    hyb:r365lf+lrel13lf          ens with a 365-day ridge window instead of 730
    ens_b25   hyb25:r730lf+lrel13lf        ens with 25 % seasonal profile in the intraday shape instead of 50 %
    ens_b75   hyb75:r730lf+lrel13lf        ens with 75 %

THE RULE (per zone, one recipe for all horizons D+2..D+8; thresholds fixed here):
  0. P = the cells (horizons) the pooled model publishes: MAE gain over level+shape >= 5 % on the whole backtest AND the hold-out (the gate, unchanged).
  1. A non-pooled candidate is ADMISSIBLE iff
       (a) it passes the same gate at EVERY horizon in P (it must not unpublish anything the pooled model publishes), and
       (b) REGRET guard (the owner judges by the 3 cheapest hours): its mean regret gain over D+2..D+8 on the select period and on the whole backtest is not more than
           1.0 percentage point below the pooled model's.
  2. S(c) = mean over D+2..D+8 of the select-period MAE gain over level+shape (2025-04-01..2026-06-30).
  3. The recipe is `pooled` unless some admissible candidate has S >= S(pooled) + 1.0 (a point is the size of the seed noise, docs/forecast-nordic-no.md section 4).
     Among those, `ens` wins unless another admissible candidate has S >= S(ens) + 1.0 (and ens is itself admissible; if ens is not admissible the highest S among the
     admissible ones wins). Ties go to the simpler recipe: pooled > ens > ens365 / ens_b25 / ens_b75 / ens_nr.
Reported next to the decision, never used by it: the hold-out, the gain since 2026-09-01, the bias since 2026-09-01, the hold-out regret, the cells that improve / get worse / would lose the gate.
"""
import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import score_nfr as SN       # noqa: E402

HS = list(range(2, 9))
BASE = SN.BASE
CANDS = {"pooled": "p0_hyb", "ens": "hyb:r730lf+lrel13lf", "ens_nr": "hyb:r730nr+lrel13nr", "ens365": "hyb:r365lf+lrel13lf",
         "ens_b25": "hyb25:r730lf+lrel13lf", "ens_b75": "hyb75:r730lf+lrel13lf"}
PRIORITY = ["pooled", "ens", "ens365", "ens_b25", "ens_b75", "ens_nr"]
MARGIN, REGRET_TOL, MIN_GAIN = 1.0, 1.0, 5.0
ZONES = ["dk1", "dk2", "se1", "se2", "se3", "se4", "nl", "fi"]


def cell(sc, z, h, col, period, metric):
    s = sc[(sc["zone"] == z) & (sc["h"] == h) & (sc["period"] == period)].set_index("col")[metric]
    if col not in s or BASE not in s or not s[BASE]:
        return np.nan
    return 100 * (1 - s[col] / s[BASE])


def table(sc, zones):
    """{(zone, name, h): {gain_full, gain_hold, gain_select, gain_after, rg_full, rg_hold, rg_select, rg_after, bias_after}}"""
    out = {}
    for z in zones:
        for n, col in CANDS.items():
            for h in HS:
                d = {}
                for p in ("full", "hold", "select", "after"):
                    d[f"gain_{p}"] = cell(sc, z, h, col, p, "mae")
                    d[f"rg_{p}"] = cell(sc, z, h, col, p, "regret")
                s = sc[(sc["zone"] == z) & (sc["h"] == h) & (sc["period"] == "after") & (sc["col"] == col)]
                d["bias_after"] = float(s["bias"].iloc[0]) if len(s) else np.nan
                out[(z, n, h)] = d
    return out


def passes(t, z, n, h):
    c = t[(z, n, h)]
    return bool(np.isfinite(c["gain_full"]) and np.isfinite(c["gain_hold"]) and min(c["gain_full"], c["gain_hold"]) >= MIN_GAIN)


def mean(t, z, n, key, hs=HS):
    return float(np.nanmean([t[(z, n, h)][key] for h in hs]))


def decide(t, z):
    P = [h for h in HS if passes(t, z, "pooled", h)]
    info = {}
    for n in CANDS:
        if n == "pooled":
            continue
        a = all(passes(t, z, n, h) for h in P)
        lost = [h for h in HS if passes(t, z, "pooled", h) and not passes(t, z, n, h)]
        rg_sel = mean(t, z, n, "rg_select") - mean(t, z, "pooled", "rg_select")
        rg_full = mean(t, z, n, "rg_full") - mean(t, z, "pooled", "rg_full")
        b = rg_sel >= -REGRET_TOL and rg_full >= -REGRET_TOL
        info[n] = {"gate_ok": a, "lost_cells": lost, "regret_ok": bool(b), "regret_dsel": rg_sel, "regret_dfull": rg_full,
                   "admissible": bool(a and b), "S": mean(t, z, n, "gain_select")}
    Sp = mean(t, z, "pooled", "gain_select")
    adm = {n: v for n, v in info.items() if v["admissible"] and v["S"] >= Sp + MARGIN}
    if not adm:
        return "pooled", Sp, info
    if "ens" in adm:
        best = "ens"
        for n in PRIORITY[2:]:
            if n in adm and adm[n]["S"] >= adm["ens"]["S"] + MARGIN and adm[n]["S"] > adm[best]["S"]:
                best = n
    else:
        best = max(adm, key=lambda n: (adm[n]["S"], -PRIORITY.index(n)))
    return best, Sp, info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frame", default="nfr_all.parquet")
    ap.add_argument("--zones", default=",".join(ZONES))
    ap.add_argument("--out", default="decision_ens.json")
    a = ap.parse_args()
    zones = a.zones.split(",")
    df = SN.load(list(CANDS.values()), zones)
    sc = SN.long_scores(df, list(CANDS.values()))
    t = table(sc, zones)
    res = {}
    for z in zones:
        best, Sp, info = decide(t, z)
        res[z] = {"recipe": best, "S_pooled": Sp, "candidates": info}
        print(f"\n=== {z}: DECISION {best}   S(pooled) {Sp:.1f}")
        for n, v in info.items():
            print(f"  {n:8s} S {v['S']:5.1f} ({v['S'] - Sp:+.1f})  gate {'ok' if v['gate_ok'] else 'LOSES D+' + ','.join(map(str, v['lost_cells']))}  "
                  f"regret select {v['regret_dsel']:+.1f} whole {v['regret_dfull']:+.1f} {'ok' if v['regret_ok'] else 'WORSE'}  -> {'admissible' if v['admissible'] else 'not admissible'}")
    cells = {f"{z}|{n}|{h}": v for (z, n, h), v in t.items()}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"rule": __doc__.split("THE RULE")[1].split("Reported next")[0].strip(), "zones": res, "cells": cells}, f, indent=1, default=float)
    print(f"\nwrote {a.out}")


if __name__ == "__main__":
    main()
