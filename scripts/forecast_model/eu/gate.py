"""The three small JSON files that decide WHAT is published, and read them defensively.

publish_gate.json   (checked in; written by build_gate.py from the research backtest)   zone -> the horizons that may be published
accuracy_eu.json    (checked in; same script)                                           zone -> what the forecast is worth, per horizon
calibration_eu.json (written by calibrate_bands.py, refreshed monthly)                  zone -> the P10 / P90 band offsets

A file that is missing, unreadable or of another `version` is treated as ABSENT, and absent never means "publish anyway": without the gate
nothing is published, without the accuracy block nothing is published (a forecast without its honest numbers is not shown), without the
calibration the days are published without a band. A file in the first build's format (no `version`) is therefore harmless.
"""
import json
import os

VERSION = 2
LOW_GAIN = 0.10          # an improvement below this (in the whole backtest, the hold-out or since September 2026) is low confidence
MIN_GAIN_VS_BEST_NAIVE = 0.05


def dumps_compact(obj, level=0):
    """JSON for files people review in a diff: a dict or list that holds only scalars (or lists of scalars) is one line, anything else is
    indented. Same content as json.dumps(obj, indent=1), a tenth of the lines."""
    scalar = lambda v: not isinstance(v, (dict, list))
    flat = lambda v: all(scalar(x) or (isinstance(x, list) and all(scalar(y) for y in x)) for x in (v.values() if isinstance(v, dict) else v))
    if isinstance(obj, list) and all(scalar(x) for x in obj):
        return json.dumps(obj)
    if isinstance(obj, dict) and obj and flat(obj) and level >= 2:
        return json.dumps(obj)
    pad = " " * (level + 1)
    if isinstance(obj, dict):
        return "{\n" + ",\n".join(f"{pad}{json.dumps(k)}: {dumps_compact(v, level + 1)}" for k, v in obj.items()) + "\n" + " " * level + "}"
    if isinstance(obj, list):
        return "[\n" + ",\n".join(pad + dumps_compact(v, level + 1) for v in obj) + "\n" + " " * level + "]"
    return json.dumps(obj)


def _load(path, version=VERSION):
    try:
        with open(path, encoding="utf-8") as f:
            v = json.load(f)
    except (OSError, ValueError):
        return None
    return v if isinstance(v, dict) and v.get("version") == version else None


def load_gate(path):
    """{zone: {"recipe": 'ens'|'lgb', "fuel": [h...], "nofuel": [h...]}} or None."""
    g = _load(path)
    z = g.get("zones") if g else None
    return z if isinstance(z, dict) and z else None


def horizons(gate, zone, fuel_ok):
    """The set of horizons the gate lets this zone publish, in the fuel mode the run is in. A zone the gate does not list publishes nothing."""
    e = (gate or {}).get(zone)
    if not isinstance(e, dict):
        return set()
    return {int(h) for h in e.get("fuel" if fuel_ok else "nofuel", [])}


def load_accuracy(path):
    return _load(path)


def accuracy_block(acc, zone, fuel_ok, hs):
    """The `accuracy` object of the published payload for the horizons `hs` actually published, or None when the file has no numbers for
    one of them (the whole zone is then not published: see published_horizons)."""
    z = ((acc or {}).get("zones") or {}).get(zone)
    if not z:
        return None
    cells = z.get("fuel" if fuel_ok else "nofuel") or {}
    by = {str(h): cells[str(h)] for h in sorted(hs) if str(h) in cells}
    if not by:
        return None
    return {"version": VERSION, "period": acc.get("period"), "baseline": acc.get("baseline"), "recent": acc.get("recent"),
            "fuel": bool(fuel_ok) and z.get("recipe") != "lgb", "showEur": bool(z.get("showEur")), "byHorizon": by}


def published_horizons(gate, acc, zone, fuel_ok):
    """The horizons to publish: those the gate allows AND for which the accuracy file has numbers (an unmeasured horizon is not published)."""
    cells = (((acc or {}).get("zones") or {}).get(zone) or {}).get("fuel" if fuel_ok else "nofuel") or {}
    return {h for h in horizons(gate, zone, fuel_ok) if str(h) in cells}


def load_calibration(path):
    """{"quantile": {zone: {h: {lo, hi}}}, "residual": {...}} or None."""
    c = _load(path)
    if not c:
        return None
    return {k: (c.get(k) if isinstance(c.get(k), dict) else {}) for k in ("quantile", "residual")}


def offsets(cal, kind, zone, h):
    """{'lo','hi'} for a zone and horizon, or None. A horizon without its own entry borrows the nearest horizon of the same zone (the cells
    are thin only at the edges of the horizon range), a zone without any returns None."""
    z = ((cal or {}).get(kind) or {}).get(zone) or {}
    if str(h) in z:
        return z[str(h)]
    if not z:
        return None
    return z[min(z, key=lambda k: abs(int(k) - h))]
