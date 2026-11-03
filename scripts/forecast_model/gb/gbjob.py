"""The pure part of the hourly Great Britain job: live rows -> predictions -> the two KV payloads. No network, no files (the callers load the models and the
caches), so it is unit-tested without LightGBM or the Spark (test_gb.py).

What is published, from the gate (gb_gate.json):
  eu-estimate-gb   the hours of today that have no price yet (a .. 23 at London clock hour a), type 'forecast' hours with a P10 / P90 band and the accuracy of the
                   as-of hour's class; replaced hour by hour as the settled prices arrive (functions/_estimate.js drops every hour that has a settled price)
  eu-forecast-gb   the forecast DAYS D+1 .. D+7 whose class the gate passed, in the shape of every EU zone's eu-forecast-<zone>, the horizon being the number of days
                   from today; joined by /api/nordic after the settled days exactly like the EU zones' (withEuForecast)
Nothing else is written. A class with a non-finite hour in it is not published (a day with a hole is dropped, an estimate with a hole is cut at the hole's hour).
"""
import os
import sys
from datetime import timedelta

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import gbfeat as GF                                      # noqa: E402
import gbmodels as GM                                    # noqa: E402

MODEL_NAME = "gb-est-v1"
PRICE_SANITY = (-500.0, 4000.0)         # GBP/MWh
MAX_MODEL_AGE_DAYS = 3
ACC_KEYS = ("mae", "baseMae", "persistMae", "gain", "gainHold", "gainRecent", "bias", "baseBias", "biasRecent", "regret", "baseRegret", "rankGain", "rankOk",
            "coverage", "coverageRecent", "width", "low", "days")


def rest_cell(gate, a):
    """The gate's cell for the as-of hour: the largest tested hour at or below `a` (the backtest samples some hours; the job runs at every one)."""
    tested = sorted(int(k) for k in (gate.get("rest") or {}))
    use = max([t for t in tested if t <= a], default=None)
    return use, (gate["rest"][str(use)] if use is not None else None)


def published_days(gate):
    return sorted(int(k) for k, c in (gate.get("days") or {}).items() if c.get("publish"))


def live_hist(price, wx_live, today, a):
    """Hist for the live job: hours of today at or after the as-of hour are masked (an hour is only usable once it has finished)."""
    h = GF.Hist(price, wx_live=wx_live)
    di = h.di(today)
    h.P[di, a:] = np.nan
    return h


def live_rows(h, today, a):
    """The feature rows of as-of hour `a` of day `today`: k = 0 the rest of today, k = 1 .. 7 the next days. Empty when there is no level yet."""
    rows = GF.rows_for_day(h, today, [a])
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame({c: np.concatenate([r[c] for r in rows]) for c in rows[0]})
    df["date"] = h.days[df["D"].to_numpy()] + pd.to_timedelta(df["k"], unit="D")
    df["asof_date"] = h.days[df["D"].to_numpy()]
    return df


def predict(models, rows, cal):
    """Add `point`, `lo`, `hi` to the rows: the mean of the ridge and the LightGBM, the band from the quantile models and the calibration offsets."""
    df = rows.copy()
    ridge = GM.predict_ridges(models["ridges"], df, GF.design)
    lgbm = GM.predict_lgb(models["lgb50"], df)
    df["ridge"], df["lgb"] = ridge, lgbm
    # the ensemble needs both models; the LightGBM alone stands in for a ridge that has no model for the (a, k) cell
    # a row without its weather forecast is not predicted (the ridge would fill the hole with a training mean): no number, and so no hour published
    df["point"] = np.where(np.isfinite(ridge) & df[["wind", "rad", "temp"]].notna().all(axis=1), (ridge + lgbm) / 2, np.nan)
    q10, q90 = GM.predict_lgb(models["lgb10"], df), GM.predict_lgb(models["lgb90"], df)
    off = (cal or {}).get("offsets") or {}
    lo, hi = GM.apply_band(df, df["point"], q10, q90, off)
    df["lo"], df["hi"] = lo, hi
    return df


def acc_cell(c):
    return {k: c[k] for k in ACC_KEYS if k in c and c[k] is not None}


def build_estimate(pred, gate, h, today, a, generated_at):
    """The `eu-estimate-gb` payload, or None when the gate lets the as-of hour's class through nowhere or no hour has a finite estimate."""
    use, cell = rest_cell(gate, a)
    if cell is None or not cell.get("publish"):
        return None
    di = h.di(today)
    r = pred[pred["k"] == 0].sort_values("hr")
    hours = []
    for _, x in r.iterrows():
        hr = int(x["hr"])
        if np.isfinite(h.P[di, hr]):                     # settled: nothing to estimate
            continue
        if not (np.isfinite(x["point"]) and PRICE_SANITY[0] <= x["point"] <= PRICE_SANITY[1]):
            break                                         # cut at the first hole: the estimate is a run of consecutive hours
        row = {"hour": hr, "eur_mwh": round(float(x["point"]), 2)}
        if np.isfinite(x["lo"]) and np.isfinite(x["hi"]):
            row["min_eur_mwh"], row["max_eur_mwh"] = round(float(min(x["lo"], x["point"])), 2), round(float(max(x["hi"], x["point"])), 2)
        hours.append(row)
    if not hours:
        return None
    if any("min_eur_mwh" not in r_ for r_ in hours):
        hours = [{k: v for k, v in r_.items() if k in ("hour", "eur_mwh")} for r_ in hours]
    acc = {"asOf": use, "unit": "GBP/MWh", "baseline": gate.get("baseline"), "period": gate.get("period"), "recent": gate.get("recent"), **acc_cell(cell)}
    return {"zone": "gb", "date": today.isoformat(), "generatedAt": generated_at, "model": MODEL_NAME, "unit": "GBP/MWh",
            "method": "gb-intraday-ensemble", "hours": hours, "accuracy": acc}


def build_forecast(pred, gate, today, generated_at, trained_through):
    """The `eu-forecast-gb` payload (forecast days D+1 .. D+7 that pass the gate, each with all 24 finite hours), or None."""
    days, hs = [], published_days(gate)
    for k in hs:
        g = pred[pred["k"] == k].sort_values("hr")
        if len(g) != 24 or not (np.isfinite(g["point"]).all() and g["point"].between(*PRICE_SANITY).all()):
            continue
        rows = []
        banded = bool(np.isfinite(g["lo"]).all() and np.isfinite(g["hi"]).all())
        for _, x in g.iterrows():
            r = {"hour": int(x["hr"]), "eur_mwh": round(float(x["point"]), 2)}
            if banded:
                r["min_eur_mwh"], r["max_eur_mwh"] = round(float(min(x["lo"], x["point"])), 2), round(float(max(x["hi"], x["point"])), 2)
            rows.append(r)
        days.append({"date": (today + timedelta(days=k)).isoformat(), "type": "forecast", "horizon": k, "prices": rows})
    if not days:
        return None
    by = {str(d["horizon"]): acc_cell(gate["days"][str(d["horizon"])]) for d in days}
    return {"zone": "gb", "generated": today.isoformat(), "generatedAt": generated_at, "trainedThrough": trained_through, "unit": "GBP/MWh", "model": MODEL_NAME,
            "recipe": "gb-intraday-ensemble", "fuel": False, "days": days,
            "accuracy": {"version": 2, "period": gate.get("period"), "baseline": gate.get("baseline"), "recent": gate.get("recent"), "fuel": False, "showEur": False,
                         "unit": "GBP/MWh", "byHorizon": by}}
