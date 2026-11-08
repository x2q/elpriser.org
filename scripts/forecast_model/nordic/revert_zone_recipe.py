#!/usr/bin/env python3
"""Put zones back on the POOLED model in the three checked-in files, without the research frame: the fallback entries (gate, accuracy cells, bands) that every ensemble
zone except NO1-NO5 carries ARE the pooled model's own numbers, built by the same code and rule, so promoting them makes the zone exactly what it was before the switch.

    python3 revert_zone_recipe.py dk1 nl [--dir ~/nordic] [--dry-run]

Rewrites publish_gate_nordic.json, accuracy_nordic.json, calibration_nordic_v2.json in --dir (default: the directory of this file). Zones without a fallback (NO1-NO5) are refused:
the pooled model fails the gate there. Afterwards test_nordic_recipe.py's pinned recipe table (test_the_recipe_table_is_the_decision_of_the_declared_rule) must be changed
by hand to the owner's choice; the next quarterly rebuild (docs/forecast-nordic-ens.md) goes back to the declared rule unless decision_ens.json is edited too.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import publish_nordic as PUB      # noqa: E402


def revert(gate, acc, cal, zones):
    """In-place on the loaded JSON objects (version-2 files). Raises ValueError for a zone that has no fallback."""
    for z in zones:
        if not PUB.has_fallback(gate["zones"], acc, z):
            raise ValueError(f"{z}: no pooled fallback in the files (already pooled, or the pooled model fails the gate there)")
        g, a = gate["zones"][z], acc["zones"][z]
        gate["zones"][z] = {"recipe": "pooled", "horizons": list(g["fallback"]["horizons"])}
        acc["zones"][z] = {"recipe": "pooled", "showEur": bool(a["fallback"].get("showEur")), "cells": a["fallback"]["cells"]}
        fb = (cal.get("residualFallback") or {}).pop(z, None)
        if fb is None:
            raise ValueError(f"{z}: no pooled bands in residualFallback")
        cal["residual"][z] = fb
    return gate, acc, cal


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zones", nargs="+")
    ap.add_argument("--dir", default=HERE)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    d = os.path.expanduser(a.dir)
    paths = [os.path.join(d, f) for f in ("publish_gate_nordic.json", "accuracy_nordic.json", "calibration_nordic_v2.json")]
    gate, acc, cal = (json.load(open(p, encoding="utf-8")) for p in paths)
    try:
        revert(gate, acc, cal, a.zones)
    except ValueError as e:
        print(f"refused: {e}")
        return 2
    if a.dry_run:
        print("dry run: would put " + ", ".join(a.zones) + " back on the pooled model in " + d)
        return 0
    for p, obj in zip(paths, (gate, acc, cal)):
        with open(p, "w", encoding="utf-8") as f:
            f.write(json.dumps(obj, separators=(",", ":")) + "\n")
    print("pooled again: " + ", ".join(a.zones) + " (files rewritten compactly in " + d + ")")
    return 0


if __name__ == "__main__":
    sys.exit(main())
