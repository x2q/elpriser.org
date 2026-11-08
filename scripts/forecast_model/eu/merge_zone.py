#!/usr/bin/env python3
"""Add ONE zone's entries from a freshly built gate / accuracy / calibration set (build_gate.py + calibrate_bands.py run with that zone in zones.py)
to the files production uses now - and touch nothing else in them.

    python3 merge_zone.py --zone xk --from <dir with the new publish_gate.json accuracy_eu.json calibration_eu.json> --into <dir of the live files> [--dry-run]

Why not simply copy the new files over: the new research run retrains the pooled model on every zone, so the OTHER zones' cells move a little (adding
Kosovo moved no published cell of the fuel mode by more than 0.7 percentage points, but it dropped three no-fuel horizons of IT-N and IE). The live
files are the owner's reviewed ones; a zone that is added gets its own measured cells and the rest stays as it was reviewed. The zone must be new
in the live files (it is never overwritten) and must have entries in all three new files; the live files are only rewritten when all three
merge. `version` and `period` of the new set must equal the live ones (the cells are comparable only over one period).
"""
import argparse
import json
import os
import sys

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import gate as G                  # noqa: E402
from zones import ZONES           # noqa: E402

FILES = ("publish_gate.json", "accuracy_eu.json", "calibration_eu.json")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def merge(zone, new, live):
    """(gate, accuracy, calibration) of `live` with `zone` added from `new`; raises ValueError when something does not fit."""
    if zone not in ZONES:
        raise ValueError(f"{zone} is not in zones.py")
    g, a, c = (live[f] for f in FILES)
    ng, na, nc = (new[f] for f in FILES)
    for f, o, n in zip(FILES, (g, a, c), (ng, na, nc)):
        if o.get("version") != G.VERSION or n.get("version") != G.VERSION:
            raise ValueError(f"{f}: version is not {G.VERSION}")
    if g.get("period") != ng.get("period") or a.get("period") != na.get("period") or g.get("period") != a.get("period"):
        raise ValueError(f"period differs: live {g.get('period')} / {a.get('period')}, new {ng.get('period')} / {na.get('period')}")
    if zone in g["zones"] or zone in a["zones"]:
        raise ValueError(f"{zone} is already in the live gate or accuracy file: not overwritten")
    if zone not in ng["zones"] or zone not in na["zones"]:
        raise ValueError(f"{zone} is missing in the new gate or accuracy file")
    if not nc.get("quantile", {}).get(zone) or not nc.get("residual", {}).get(zone):
        raise ValueError(f"{zone} has no quantile and residual band offsets in the new calibration")
    # every published horizon must have its accuracy cell (gate.published_horizons would drop it otherwise), in both modes
    for mode in ("fuel", "nofuel"):
        missing = [h for h in ng["zones"][zone][mode] if str(h) not in na["zones"][zone][mode]]
        if missing:
            raise ValueError(f"{zone} {mode}: horizons {missing} are in the gate but have no accuracy cell")
    g2 = {**g, "zones": {**g["zones"], zone: ng["zones"][zone]}}
    a2 = {**a, "zones": {**a["zones"], zone: na["zones"][zone]}}
    c2 = {**c, "quantile": {**c.get("quantile", {}), zone: nc["quantile"][zone]},
          "residual": {**c.get("residual", {}), zone: nc["residual"][zone]}}
    # the zone order of the gate follows zones.py (a test pins it)
    for d in (g2, a2):
        d["zones"] = {z: d["zones"][z] for z in ZONES if z in d["zones"]}
    return g2, a2, c2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zone", required=True)
    ap.add_argument("--from", dest="src", required=True)
    ap.add_argument("--into", required=True)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    new = {f: load(os.path.join(a.src, f)) for f in FILES}
    live = {f: load(os.path.join(a.into, f)) for f in FILES}
    out = dict(zip(FILES, merge(a.zone, new, live)))
    gz = out["publish_gate.json"]["zones"][a.zone]
    print(f"{a.zone}: fuel horizons {gz['fuel']}, no-fuel horizons {gz['nofuel']}")
    if a.dry_run:
        print("dry run: nothing written")
        return
    for f in FILES:
        tmp = os.path.join(a.into, f + ".new")
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(G.dumps_compact(out[f]) + "\n")
    for f in FILES:                                   # all three written to temporaries first, then renamed
        os.replace(os.path.join(a.into, f + ".new"), os.path.join(a.into, f))
    print("written:", ", ".join(FILES))


if __name__ == "__main__":
    main()
