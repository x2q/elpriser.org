"""What the Nordic job publishes, decided by files and applied by pure functions (the Nordic twin of eu/gate.py + eu/forecast.py; no model, no network).

publish_gate_nordic.json   zone -> {"recipe": "ens" | "pooled", "horizons": [h ...]}   the horizons whose out-of-sample MAE is at least 5 % below level+shape
                           on the whole backtest AND the hold-out (research_no/build_gate_nordic.py; the EU gate's rule, unchanged)
accuracy_nordic.json       zone -> {"recipe", "showEur", "cells": {h: {mae, baseMae, gain, gainHold, gainRecent, bias, baseBias, regret, baseRegret, rankGain,
                           rankOk, coverage, coverageRecent, low, days}}}   what a forecast of that zone and horizon is worth (same cell as accuracy_eu.json)
calibration_nordic_v2.json {"residual": {zone: {h: {lo, hi}}}}   the P10 / P90 offsets added to the central estimate (180 days x 1.2, eu/calibrate.py's recipe)

Absent or of another `version` means ABSENT, and absent never means "publish anyway": without gate and accuracy nothing is published; without calibration the days
carry no band (the Worker's contract: a band on all 24 hours or none).
"""
import json
import os

import numpy as np
import pandas as pd

VERSION = 2


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            v = json.load(f)
    except (OSError, ValueError):
        return None
    return v if isinstance(v, dict) and v.get("version") == VERSION else None


def load_gate(path):
    g = _load(path)
    z = g.get("zones") if g else None
    return z if isinstance(z, dict) and z else None


def load_accuracy(path):
    return _load(path)


def load_calibration(path):
    c = _load(path)
    return (c.get("residual") or {}) if c else None


def recipe_of(gate, zone):
    e = (gate or {}).get(zone)
    return e.get("recipe") if isinstance(e, dict) else None


def published_horizons(gate, acc, zone):
    """The horizons to publish: the gate's AND those the accuracy file has numbers for (an unmeasured horizon is not published)."""
    e = (gate or {}).get(zone)
    cells = ((((acc or {}).get("zones") or {}).get(zone) or {}).get("cells")) or {}
    return {int(h) for h in (e or {}).get("horizons", []) if str(h) in cells}


def accuracy_block(acc, zone, hs):
    """The `accuracy` object of the payload for the horizons actually published (the EU shape: version, period, baseline, recent, byHorizon), or None."""
    z = ((acc or {}).get("zones") or {}).get(zone) or {}
    cells = z.get("cells") or {}
    by = {str(h): cells[str(h)] for h in sorted(hs) if str(h) in cells}
    if not by:
        return None
    return {"version": VERSION, "period": acc.get("period"), "baseline": acc.get("baseline"), "recent": acc.get("recent"),
            "recipe": z.get("recipe"), "showEur": bool(z.get("showEur")), "byHorizon": by}


def band(cal, zone, h):
    """{'lo', 'hi'} offsets of a zone and horizon, or None; a horizon without its own entry borrows the nearest one of the same zone."""
    z = ((cal or {}).get(zone)) or {}
    if str(h) in z:
        return z[str(h)]
    if not z:
        return None
    return z[min(z, key=lambda k: abs(int(k) - h))]


def horizon_of(date, last_actual):
    """Model horizon of a forecast day: days from the last settled day to it, plus one."""
    return (date - last_actual).days + 1


def forecast_days(zone, rows_point, last_actual, allowed, cal, today_max_days=8):
    """Forecast days of one zone from `rows_point` = DataFrame(date, hour, h, point) (24 hours per day), the zone's last settled date and the allowed horizons.

    Only days whose horizon is allowed, and only a run of consecutive days that starts the day after the last settled day (the apps and the Worker stop at the first
    missing day, so a day behind a gap would be invisible: the run is cut there). A day with a non-finite hour is dropped (never patched), and so is everything after
    it. The band: point + lo / point + hi from `cal`, widened to contain the point, on all 24 hours or on none."""
    out = []
    nxt = pd.Timestamp(last_actual) + pd.Timedelta(days=1)
    for (date, h), g in rows_point.groupby(["date", "h"], sort=True):
        if pd.Timestamp(date) != nxt or int(h) not in allowed or len(g) != 24 or len(out) >= today_max_days:
            break
        g = g.sort_values("hour")
        y = g["point"].to_numpy(dtype=float)
        if not np.isfinite(y).all():
            break
        b = band(cal, zone, int(h))
        rows = []
        for hr in range(24):
            r = {"hour": hr, "eur_mwh": round(float(y[hr]), 2)}
            if b is not None:
                r["min_eur_mwh"] = round(float(min(y[hr] + b["lo"], y[hr])), 2)
                r["max_eur_mwh"] = round(float(max(y[hr] + b["hi"], y[hr])), 2)
            rows.append(r)
        out.append({"date": pd.Timestamp(date).date().isoformat(), "type": "forecast", "horizon": int(h), "prices": rows})
        nxt += pd.Timedelta(days=1)
    return out


def payload(zone, actual_days, fdays, today, trained_through, generated_at, model, recipe, accuracy=None):
    """The KV value `nordic-forecast-<zone>`: the settled days of the old feed, then the forecast days (each with `horizon` and a band), plus `model`, `recipe` and
    the accuracy block of exactly the horizons published. Keys of the old feed (zone, generated, trainedThrough, unit, days) are unchanged."""
    v = {"zone": zone, "generated": today.isoformat(), "generatedAt": generated_at,
         "trainedThrough": trained_through.isoformat() if trained_through else None,
         "unit": "EUR/MWh", "model": model, "recipe": recipe, "days": list(actual_days) + list(fdays)}
    if accuracy:
        v["accuracy"] = accuracy
    return v
