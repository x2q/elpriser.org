#!/usr/bin/env python3
"""Install the level-corrected cells of a few zones (docs/forecast-balkan-level.md) into the files production uses now, touching nothing else.

    python3 merge_level_zones.py --from <dir with the candidate publish_gate.json accuracy_eu.json> --into <dir of the live files> [--dry-run]

The candidate files (build_gate.py with the level correction in level_correction.PUBLISH_ZONES) come from a full rebuild of the 26-zone research, which also moves the cells of zones whose recipe
did not change (re-running the research moved no published cell by more than ~2 points, but it dropped three no-fuel horizons of IT-N and IE, see docs/forecast-xk.md): the live files are the
owner's reviewed ones, so ONLY the zones named in the candidate gate's `levelCorrection.zones` are replaced, in the gate and the accuracy file; every other zone is byte for byte what it was.
The gate also gets the `levelCorrection` field (lambda, days, zones: what the corrected cells mean). calibration_eu.json is NOT touched: its band offsets are measured on the model's own edges and
refreshed weekly (refresh_calibration.sh); the band moves with the corrected point and stays honest (docs/forecast-balkan-level.md section 5). `version` and `period` must agree. All files are written
to temporaries first and renamed together; nothing is written when anything does not fit.
"""
import argparse
import json
import os
import sys

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import gate as G                  # noqa: E402
from zones import ZONES           # noqa: E402

FILES = ("publish_gate.json", "accuracy_eu.json")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def merge(new, live):
    """(gate, accuracy) to install and the list of zones replaced; raises ValueError when something does not fit."""
    ng, na = new["publish_gate.json"], new["accuracy_eu.json"]
    lg, la = live["publish_gate.json"], live["accuracy_eu.json"]
    for name, d in (("new gate", ng), ("new accuracy", na), ("live gate", lg), ("live accuracy", la)):
        if d.get("version") != G.VERSION:
            raise ValueError(f"{name}: version is not {G.VERSION}")
    if not (ng.get("period") == na.get("period") == lg.get("period") == la.get("period")):
        raise ValueError(f"period differs: new {ng.get('period')} / {na.get('period')}, live {lg.get('period')} / {la.get('period')}")
    lc = ng.get("levelCorrection") or {}
    zones = [z for z in lc.get("zones", [])]
    if not zones or not lc.get("lambda"):
        raise ValueError("the new gate has no levelCorrection zones")
    for z in zones:
        if z not in ZONES or z not in lg["zones"] or z not in la["zones"]:
            raise ValueError(f"{z}: not in zones.py or not in the live gate / accuracy file")
        if z not in ng["zones"] or z not in na["zones"]:
            raise ValueError(f"{z}: missing in the new gate or accuracy file")
        for mode in ("fuel", "nofuel"):
            gone = [h for h in ng["zones"][z][mode] if str(h) not in na["zones"][z][mode]]
            if gone:
                raise ValueError(f"{z} {mode}: horizons {gone} are in the gate but have no accuracy cell")
    g2 = {**lg, "levelCorrection": lc, "zones": {z: (ng["zones"][z] if z in zones else e) for z, e in lg["zones"].items()}}
    a2 = {**la, "zones": {z: (na["zones"][z] if z in zones else e) for z, e in la["zones"].items()}}
    return g2, a2, zones


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", required=True)
    ap.add_argument("--into", required=True)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    new = {f: load(os.path.join(a.src, f)) for f in FILES}
    live = {f: load(os.path.join(a.into, f)) for f in FILES}
    g2, a2, zones = merge(new, live)
    for z in zones:
        for mode in ("fuel", "nofuel"):
            was, now = live["publish_gate.json"]["zones"][z][mode], g2["zones"][z][mode]
            print(f"{z} {mode}: horizons {was} -> {now}" + ("" if was == now else "   <- changes"))
    if a.dry_run:
        print("dry run: nothing written")
        return
    out = {"publish_gate.json": g2, "accuracy_eu.json": a2}
    for f in FILES:
        with open(os.path.join(a.into, f + ".new"), "w", encoding="utf-8") as fh:
            fh.write(G.dumps_compact(out[f]) + "\n")
    for f in FILES:
        os.replace(os.path.join(a.into, f + ".new"), os.path.join(a.into, f))
    print("written:", ", ".join(FILES), "(calibration_eu.json untouched)")


if __name__ == "__main__":
    main()
