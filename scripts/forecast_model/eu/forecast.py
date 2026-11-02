"""Scoring: from price history + the live weather forecast to the KV value of one zone. Pure pandas/numpy - the model is
passed in as a function, so everything here is unit-tested without LightGBM, the network or the Spark.

What is published (KV `eu-forecast-<zone>`), and what is not:
* ONLY forecast days. The settled prices stay in `eu-prices-<zone>` (each zone's licensed source); /api/nordic puts the two
  together, so this key never carries a price that a data licence might attribute to somebody else.
* every day from the first unpublished day to at most h = MAX_H days after the last known day, `type: 'forecast'`, with
  `horizon` (= h) and P10/P90 in `min_eur_mwh` / `max_eur_mwh`, the Nordic feed's own field names.
* `trainedThrough`, `model`, and `accuracy` - the backtest's per-horizon error for THIS zone, so a page can state what the
  forecast is worth instead of a general claim.

Horizon. h = days from the last known price day to the target day, plus one: with tomorrow's auction published, the day
after tomorrow is h = 2; before it is published, tomorrow is h = 2 (the information state is the same: one unknown day).
"""
from datetime import date, timedelta

import numpy as np
import pandas as pd

import features as F
from zones import ZONES

MAX_H = 8
MIN_HOURS = 12                 # a day counts as published with at least this many priced hours (like the price jobs)
MODEL_NAME = "eu-pooled-v1"
MIN_SKILL = -0.05              # a horizon whose backtest MAE is more than 5 % WORSE than the best naive baseline is not published


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


def band_for(cal, zone, h):
    """{'lo','hi'} additive P10/P90 offsets. A (zone, h) without a calibration falls back to the nearest horizon of the
    zone, then to the widest band of the zone; a zone with none returns None (the day is then published without a band)."""
    z = (cal or {}).get(zone) or {}
    if str(h) in z:
        return z[str(h)]
    if not z:
        return None
    near = min(z, key=lambda k: abs(int(k) - h))
    return z[near]


def horizon_ok(accuracy, h, min_skill=MIN_SKILL):
    """False when this zone's own backtest says the forecast at horizon h is clearly worse than a naive baseline. A zone or a
    horizon without an accuracy entry is not blocked (no evidence is not evidence against)."""
    e = (((accuracy or {}).get("backtest") or {}).get("byHorizon") or {}).get(str(h))
    return e is None or e.get("skill") is None or e["skill"] >= min_skill


def forecast_zone(zone, predict, prices, wx, reg, days, eu, today, cal=None, days_ahead=7, accuracy=None, level_corr=None, shadow_corr=None):
    """The `days` list of one zone's forecast. `prices` is {zone: hourly Series} (day_table's input), `wx`/`reg` the
    LIVE weather on the zone's clock, `days`/`eu` the day_table output. `predict(X)` -> prices for the feature rows.
    Returns [] when the zone has no usable price history (never a guess). `accuracy` is the zone's accuracy_eu.json entry: horizons
    whose skill is below MIN_SKILL are left out. `level_corr(zone, h, date) -> EUR/MWh` (level_correction.correction) shifts the
    day; each day then also carries `uncorrected`, the model's own 24 numbers, for the archive (payload() strips it).
    `shadow_corr` has the same signature; when given, each day also carries `shadow`, the numbers WITH that correction, which are
    archived but never published."""
    p = prices[zone]
    lk = last_known_day(p)
    if lk is None or lk < today - timedelta(days=1):
        return []                          # stale prices: a forecast built on them would be a week old
    out = []
    for d, h in target_days(lk, today, days_ahead):
        if not horizon_ok(accuracy, h):
            continue                       # the zone's own backtest says: not better than a naive forecast here
        idx = pd.date_range(pd.Timestamp(d), periods=24, freq="h")
        X = F.make_features(zone, idx, h, p, wx, reg, days[zone], eu)
        X["zone"] = pd.Categorical([zone] * len(X), categories=list(ZONES))
        y = np.asarray(predict(X), dtype=float)
        if not np.isfinite(y).all():
            continue                       # a day with a NaN anywhere is dropped, not patched
        raw = y.copy()
        if level_corr is not None:
            y = y + float(level_corr(zone, h, d))
        band = band_for(cal, zone, h)
        rows = []
        for hr in range(24):
            r = {"hour": hr, "eur_mwh": round(float(y[hr]), 2)}
            if band:
                r["min_eur_mwh"] = round(float(y[hr] + band["lo"]), 2)
                r["max_eur_mwh"] = round(float(y[hr] + band["hi"]), 2)
            rows.append(r)
        day = {"date": d.isoformat(), "type": "forecast", "horizon": h, "prices": rows,
               "uncorrected": [round(float(v), 2) for v in raw]}
        if shadow_corr is not None:
            day["shadow"] = [round(float(v) + float(shadow_corr(zone, h, d)), 2) for v in raw]
        out.append(day)
    return out


def payload(zone, days, today, trained_through, generated_at, accuracy=None):
    """The KV value. `generated` is the zone-independent run date; `accuracy` is the backtest block for this zone."""
    v = {"zone": zone, "generated": today.isoformat(), "generatedAt": generated_at,
         "trainedThrough": trained_through.isoformat() if trained_through else None,
         "unit": "EUR/MWh", "model": MODEL_NAME,
         "days": [{k: x for k, x in d.items() if k not in ("uncorrected", "shadow")} for d in days]}
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
