"""Scoring: from price history + the live weather forecast to the KV value of one zone. Pure pandas/numpy - the models are applied by
train_daily.py and arrive here as arrays, so everything in this file is unit-tested without LightGBM, the network or the Spark.

What is published (KV `eu-forecast-<zone>`), and what is not:
* ONLY forecast days. The settled prices stay in `eu-prices-<zone>` (each zone's licensed source); /api/nordic puts the two
  together, so this key never carries a price that a data licence might attribute to somebody else.
* every day from the first unpublished day to h = MAX_H, `type: 'forecast'`, with `horizon` (= h) and P10/P90 in `min_eur_mwh` /
  `max_eur_mwh`, the Nordic feed's own field names, on all 24 hours or on none - and ONLY the horizons the publish gate lets this zone
  publish (publish_gate.json: at least 5 % better than the naive level+shape method out of sample).
* `trainedThrough`, `model`, and `accuracy` - the backtest's error of THIS zone for exactly the horizons published, so a page can state
  what the forecast is worth instead of a general claim.

Horizon. h = days from the last known price day to the target day, plus one: with tomorrow's auction published, the day after
tomorrow is h = 2; before it is published, tomorrow is h = 2 (the information state is the same: one unknown day).
"""
from datetime import timedelta

import numpy as np
import pandas as pd

import features as F
import recipe
from zones import ZONES

MAX_H = recipe.H_MAX
MIN_HOURS = 12                 # a day counts as published with at least this many priced hours (like the price jobs)
MODEL_NAME = recipe.MODEL_NAME


def last_known_day(p):
    """The newest date with at least MIN_HOURS priced hours, or None."""
    n = p.dropna().groupby(p.dropna().index.normalize()).size()
    n = n[n >= MIN_HOURS]
    return n.index.max().date() if len(n) else None


def live_weather_local(live, zone):
    """live()'s frame (UTC, raw Open-Meteo names) -> the zone's local clock with the model's column names."""
    f = live[zone].rename(columns={v: k for k, v in F.RAW_VARS.items()})[F.WX]
    return F.to_local(f, ZONES[zone][1])


def live_regional_local(live, zone):
    reg = F.regional({z: f.rename(columns={v: k for k, v in F.RAW_VARS.items()})[F.WX] for z, f in live.items()})
    return F.to_local(reg, ZONES[zone][1])


def target_days(last_known, today, days_ahead=7, max_h=MAX_H):
    """[(date, h)] for every date after the last known day, up to `days_ahead` after today and at most max_h."""
    out = []
    d = last_known + timedelta(days=1)
    while d <= today + timedelta(days=days_ahead):
        h = (d - last_known).days + 1
        if 2 <= h <= max_h:
            out.append((d, h))
        d += timedelta(days=1)
    return out


def build_rows(zone, p, wx, reg, days, eu, today, days_ahead=7, max_h=MAX_H):
    """The feature rows of every forecast day of one zone (24 hours per day, h = 2 .. max_h), with `t` (the hour), `date` (its day) and
    `zone`; an empty frame when the zone's prices are stale (older than yesterday: a forecast built on them would be a week old)."""
    lk = last_known_day(p)
    if lk is None or lk < today - timedelta(days=1):
        return pd.DataFrame()
    parts = []
    for d, h in target_days(lk, today, days_ahead, max_h):
        idx = pd.date_range(pd.Timestamp(d), periods=24, freq="h")
        X = F.make_features(zone, idx, h, p, wx, reg, days, eu)
        X["t"] = idx
        X["date"] = pd.Timestamp(d)
        parts.append(X)
    if not parts:
        return pd.DataFrame()
    out = pd.concat(parts, ignore_index=True)
    out["zone"] = zone
    return out


def offset_arrays(cal, kind, zone, hs):
    """Per-row band offsets: (lo, hi) arrays for the horizons `hs` (one per row), NaN where the zone has no calibration of this kind."""
    import gate as G
    hs = np.asarray(hs)
    lo, hi = np.full(len(hs), np.nan), np.full(len(hs), np.nan)
    for h in np.unique(hs):
        o = G.offsets(cal, kind, zone, int(h))
        if o is not None:
            m = hs == h
            lo[m], hi[m] = o["lo"], o["hi"]
    return lo, hi


def band_edges(point, q_lo, q_hi, off_lo, off_hi):
    """P10 / P90 arrays for rows whose central estimate is `point`, or None when there is nothing to base a band on.

    `q_lo`, `q_hi`   the quantile models' own P10 / P90 predictions (EUR/MWh, absolute) - the report's section-7 recipe - or None
    `off_lo/off_hi`  per-row offsets from calibration_eu.json: the 1.2 x rolling 10th / 90th percentile of the edge's own miss, ADDED to the
                     quantile prediction (kind 'quantile'), or to the central estimate when q_lo / q_hi are None (kind 'residual')
    Both edges are widened, never narrowed, to contain the central estimate (a mean of two models can sit outside a quantile model's edges),
    so min <= price <= max always holds. An hour without an offset or with a non-finite edge has NaN edges: build_days then publishes the
    day without any band (a band on some hours only is not a band, and the API drops such a day)."""
    point = np.asarray(point, dtype=float)
    off_lo, off_hi = np.asarray(off_lo, dtype=float), np.asarray(off_hi, dtype=float)
    if not (np.isfinite(off_lo).any() and np.isfinite(off_hi).any()):
        return None
    if q_lo is not None and q_hi is not None:
        lo, hi = np.asarray(q_lo, dtype=float) + off_lo, np.asarray(q_hi, dtype=float) + off_hi
    else:
        lo, hi = point + off_lo, point + off_hi
    return np.minimum(lo, point), np.maximum(hi, point)


def build_days(rows, point, edges, allowed, level_corr=None, shadow_corr=None):
    """The `days` list from a zone's rows and the central estimate `point` (array aligned to rows).

    allowed      the horizons to publish (set); a day at another horizon is left out
    edges        (lo, hi) arrays aligned to rows, or None (no band)
    level_corr   (zone, h, date) -> EUR/MWh shifted onto the published numbers (0 unless EU_FORECAST_LAMBDA is set; shadow otherwise)
    A day whose estimate has a non-finite hour is dropped, not patched. Each day also carries `uncorrected` and, with shadow_corr, `shadow`
    (the archive's, stripped by payload())."""
    point = np.asarray(point, dtype=float)
    out = []
    if rows.empty:
        return out
    rows = rows.reset_index(drop=True)                 # positions in `rows` are positions in point / edges
    zone = rows["zone"].iloc[0]
    for (date, h), g in rows.groupby(["date", "h"], sort=True):
        h = int(h)
        if h not in allowed or len(g) != 24:
            continue
        pos = g.index.to_numpy()[np.argsort(g["hour"].to_numpy(), kind="stable")]
        y = point[pos]
        if not np.isfinite(y).all():
            continue
        raw = y.copy()
        d = date.date() if hasattr(date, "date") else date
        if level_corr is not None:
            y = y + float(level_corr(zone, h, d))
        lo = hi = None
        if edges is not None:
            lo, hi = np.asarray(edges[0], dtype=float)[pos], np.asarray(edges[1], dtype=float)[pos]
            if level_corr is not None:
                lo, hi = lo + (y - raw), hi + (y - raw)
            if not (np.isfinite(lo).all() and np.isfinite(hi).all()):
                lo = hi = None
        rows24 = []
        for hr in range(24):
            r = {"hour": hr, "eur_mwh": round(float(y[hr]), 2)}
            if lo is not None:
                r["min_eur_mwh"] = round(float(min(lo[hr], y[hr])), 2)
                r["max_eur_mwh"] = round(float(max(hi[hr], y[hr])), 2)
            rows24.append(r)
        day = {"date": d.isoformat(), "type": "forecast", "horizon": h, "prices": rows24,
               "uncorrected": [round(float(v), 2) for v in raw]}
        if shadow_corr is not None:
            day["shadow"] = [round(float(v) + float(shadow_corr(zone, h, d)), 2) for v in raw]
        out.append(day)
    return out


def payload(zone, days, today, trained_through, generated_at, accuracy=None, recipe_name=None, fuel=None):
    """The KV value. `generated` is the zone-independent run date; `accuracy` is the backtest block for this zone (gate.accuracy_block)."""
    v = {"zone": zone, "generated": today.isoformat(), "generatedAt": generated_at,
         "trainedThrough": trained_through.isoformat() if trained_through else None,
         "unit": "EUR/MWh", "model": MODEL_NAME,
         "days": [{k: x for k, x in d.items() if k not in ("uncorrected", "shadow")} for d in days]}
    if recipe_name:
        v["recipe"] = recipe_name
    if fuel is not None:
        v["fuel"] = bool(fuel)
    if accuracy:
        v["accuracy"] = accuracy
    return v


def archive_payload(pl, days=None):
    """What is kept for monitoring (forecast-v3-archive pattern): the run as published, without the accuracy block, and - when
    the unstripped `days` are passed - with each day's `uncorrected` model numbers and `shadow` numbers, so the error of the MODEL (not of the
    corrected forecast) can be measured from the archive later."""
    out = {k: v for k, v in pl.items() if k != "accuracy"}
    if days is not None:
        out["days"] = days
    return out
