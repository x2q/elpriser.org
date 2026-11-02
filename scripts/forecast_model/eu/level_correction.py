"""Trailing level correction: shift a forecast by a fraction of the recent error of the SAME zone and horizon.

Why. The backtest showed that when the price level moves a lot (September to November 2026: 100 -> 240 EUR/MWh) the model lags
it: a negative bias of -21 (D+2) to -31 (D+7) EUR/MWh and, in those months, no better than a naive forecast. The Danish v3 model
showed the same in October (see memory: price-forecasting-analysis) and a shrunk trailing correction removed half the bias there.

The rule (the Danish shadow's, per zone): for a forecast of target day t at horizon h, take the mean DAY-level error (actual -
forecast) of the same zone and horizon over the target days t' in [t-h+1-K+1, t-h+1] - the days whose actual prices are known when
t is issued - and add LAMBDA x that mean to every hour of t. K = 14 days, LAMBDA = 0.5, at least MIN_DAYS days of evidence;
otherwise no correction (0.0). Measured on the backtest: -8 % MAE and half the bias in the Sept-Nov regime, -2 % before it.

STATUS: SHADOW. The numbers above come from the backtest, whose model is retrained every two months and so lags a level shift
more than the live model, which is retrained daily with level_7d as an anchor. Bootstrapping a live correction from backtest
errors was tried and over-corrected (+20 % on 2 November). So the live job computes the correction from its OWN archive only
(archive/<zone>-<date>.json: what it really published, `uncorrected` model numbers vs the settled prices), stores the corrected
numbers next to the published ones as `shadow`, and publishes the uncorrected forecast. After 4+ weeks, monitor.py --shadow shows
which one was closer; adopting it is one environment variable (EU_FORECAST_LAMBDA=0.5), rolling back is unsetting it.
(The backtest bootstrap remains available as EU_FORECAST_BOOTSTRAP=1 for experiments.)
"""
import json
import os

import numpy as np
import pandas as pd

LAMBDA = 0.5
K_DAYS = 14
MIN_DAYS = 3


def day_errors_from_backtest(res, col="p_raw"):
    """DataFrame zone, h, date, res (= mean over the day of actual - forecast) from a backtest frame."""
    d = res.assign(res=res["y"] - res[col])
    d["date"] = pd.to_datetime(d["date"])
    d["zone"] = d["zone"].astype(str)
    return d.groupby(["zone", "h", "date"], as_index=False)["res"].mean()


def day_errors_from_archive(archive_dir, prices):
    """The same table from the archived live forecasts: every archived forecast day whose 24 actual prices are known."""
    rows = []
    if not os.path.isdir(archive_dir):
        return pd.DataFrame(columns=["zone", "h", "date", "res"])
    for name in sorted(os.listdir(archive_dir)):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(archive_dir, name), encoding="utf-8") as f:
            pl = json.load(f)
        a = prices.get(pl.get("zone"))
        if a is None:
            continue
        for d in pl.get("days", []):
            if d.get("type") != "forecast" or "uncorrected" not in d:
                continue                    # `uncorrected`: the model's own number - an error must not be measured on a corrected one
            idx = pd.date_range(pd.Timestamp(d["date"]), periods=24, freq="h")
            y = a.reindex(idx).to_numpy(dtype=float)
            f = np.array([p for p in d["uncorrected"]], dtype=float)
            if len(f) == 24 and not np.isnan(y).any() and not np.isnan(f).any():
                rows.append({"zone": pl["zone"], "h": int(d["horizon"]), "date": pd.Timestamp(d["date"]), "res": float((y - f).mean())})
    return pd.DataFrame(rows, columns=["zone", "h", "date", "res"])


def merge_errors(*tables):
    """Concatenate; where the same (zone, h, date) is in several, the FIRST table wins (pass the archive before the backtest)."""
    t = pd.concat([x for x in tables if len(x)], ignore_index=True) if any(len(x) for x in tables) else pd.DataFrame(columns=["zone", "h", "date", "res"])
    return t.drop_duplicates(["zone", "h", "date"], keep="first")


def correction(errors, zone, h, target, lam=LAMBDA, k=K_DAYS, min_days=MIN_DAYS):
    """The shift (EUR/MWh) for a forecast of `target` (a date) at horizon h; 0.0 without at least `min_days` days of evidence."""
    if lam == 0 or errors is None or not len(errors):
        return 0.0
    last_known = pd.Timestamp(target) - pd.Timedelta(days=h - 1)
    e = errors[(errors["zone"] == zone) & (errors["h"] == h)
               & (errors["date"] <= last_known) & (errors["date"] > last_known - pd.Timedelta(days=k))]
    return float(lam * e["res"].mean()) if len(e) >= min_days else 0.0


def apply_to_backtest(res, lam=LAMBDA, k=K_DAYS, min_days=MIN_DAYS, col="p_raw"):
    """The corrected prediction for every row of a backtest frame, vectorised: per (zone, h) a daily series, rolling mean of the
    errors, shifted by h-1 days so a target only sees days that were settled when it was issued."""
    errs = day_errors_from_backtest(res, col)
    parts = []
    for (z, h), g in errs.groupby(["zone", "h"]):
        s = g.set_index("date")["res"].asfreq("D")
        known = s.rolling(k, min_periods=min_days).mean().shift(int(h) - 1)
        parts.append(pd.DataFrame({"zone": z, "h": h, "date": known.index, "corr": lam * known.to_numpy()}))
    c = pd.concat(parts, ignore_index=True)
    out = res.copy()
    out["date"] = pd.to_datetime(out["date"])
    out["zone"] = out["zone"].astype(str)
    out = out.merge(c, on=["zone", "h", "date"], how="left")
    out["corr"] = out["corr"].fillna(0.0)
    return out["corr"].to_numpy()
