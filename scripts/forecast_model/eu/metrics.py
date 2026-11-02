"""Forecast-accuracy metrics for the EU model, pure numpy/pandas (no model, no network), so they are unit-tested.

The Nordic lesson (memory: nordic-multizone-model) applies unchanged: percentage MAE punishes cheap zones and min-hour
hit-rate measures a zone's daily spread rather than skill, so the metric that compares zones is REGRET - what following a
forecast's cheapest hours costs against perfect timing - next to MAE in EUR/MWh, and the error of the DAILY MEAN, which
is what a customer planning "which day is cheap" actually uses.
"""
import numpy as np
import pandas as pd


def day_matrix(df, col, keys=("zone", "date", "h")):
    """DataFrame with columns zone/date/h/hour/<col> -> (group keys, [n_groups x 24] array, NaN where an hour is absent)."""
    g = df.pivot_table(index=list(keys), columns="hour", values=col, aggfunc="mean", observed=True)
    g = g.reindex(columns=range(24))
    return g.index, g.to_numpy(dtype=float)


def regret(actual, forecast, k=3):
    """Per day: mean actual price of the k hours the forecast ranks cheapest, minus the k-hour best possible (the mean of
    the k cheapest actual hours). Rows with a NaN anywhere are NaN. 0 is perfect timing.

    Regret against the single cheapest hour (the Nordic backtest's definition) is `regret_vs_min` below; the k-hour
    optimum is used here because it is the quantity a 3-hour appliance cycle can actually reach."""
    a = np.asarray(actual, dtype=float)
    f = np.asarray(forecast, dtype=float)
    ok = ~(np.isnan(a).any(axis=1) | np.isnan(f).any(axis=1))
    out = np.full(len(a), np.nan)
    if ok.any():
        fa, aa = f[ok], a[ok]
        pick = np.argsort(fa, axis=1, kind="stable")[:, :k]
        got = np.take_along_axis(aa, pick, axis=1).mean(axis=1)
        best = np.sort(aa, axis=1)[:, :k].mean(axis=1)
        out[ok] = got - best
    return out


def regret_vs_min(actual, forecast, k=3):
    """The Nordic backtest's regret: the forecast's k cheapest hours against the single cheapest actual hour."""
    a = np.asarray(actual, dtype=float)
    f = np.asarray(forecast, dtype=float)
    ok = ~(np.isnan(a).any(axis=1) | np.isnan(f).any(axis=1))
    out = np.full(len(a), np.nan)
    if ok.any():
        fa, aa = f[ok], a[ok]
        pick = np.argsort(fa, axis=1, kind="stable")[:, :k]
        out[ok] = np.take_along_axis(aa, pick, axis=1).mean(axis=1) - aa.min(axis=1)
    return out


def blend(frame, col, w=0.5):
    """The Nordic/Danish hybrid: the model's daily LEVEL with an intraday SHAPE that is `w` seasonal profile and
    (1 - w) the model's own. Falls back to the model where no seasonal profile exists."""
    g = frame.groupby(["zone", "date", "h"], observed=True, sort=False)
    pm = g[col].transform("mean")
    sm = g["seasonal4w"].transform("mean")
    out = pm + (1 - w) * (frame[col] - pm) + w * (frame["seasonal4w"] - sm)
    return out.where(sm.notna(), frame[col])


def level_shape(frame):
    """Naive baseline 'level + shape': the seasonal (same weekday, last 4 weeks) hourly PROFILE shifted so its daily mean
    equals the mean of the last 7 known days. The strongest simple thing that uses both level and shape information."""
    g = frame.groupby(["zone", "date", "h"], observed=True, sort=False)
    sm = g["seasonal4w"].transform("mean")
    return frame["seasonal4w"] - sm + frame["level_7d"]


def scorecard(df, cols, actual="y"):
    """Per (zone, h) accuracy of each forecast column in `cols` ({name: column}).

    Returns a long DataFrame: zone, h, n_days, mean_price, then per name: mae, day_mae (error of the daily mean), bias,
    regret (k=3 hours vs the best 3), regret_min (vs the single cheapest hour)."""
    rows = []
    d = df.copy()
    d["date"] = pd.to_datetime(d["date"])
    for (z, h), s in d.groupby(["zone", "h"], observed=True):
        row = {"zone": z, "h": int(h), "n_days": s["date"].nunique(), "mean_price": s[actual].mean()}
        keys, A = day_matrix(s, actual)
        for name, col in cols.items():
            err = s[col] - s[actual]
            row[f"{name}_mae"] = err.abs().mean()
            row[f"{name}_bias"] = err.mean()
            _, F = day_matrix(s, col)
            both = ~(np.isnan(A).any(axis=1) | np.isnan(F).any(axis=1))
            row[f"{name}_day_mae"] = np.abs(F[both].mean(axis=1) - A[both].mean(axis=1)).mean() if both.any() else np.nan
            row[f"{name}_regret"] = np.nanmean(regret(A, F)) if both.any() else np.nan
            row[f"{name}_regret_min"] = np.nanmean(regret_vs_min(A, F)) if both.any() else np.nan
        # no forecast at all: run at an average hour. What a forecast has to beat to be worth anything for timing.
        okA = ~np.isnan(A).any(axis=1)
        row["regret_avg_hour"] = (A[okA].mean(axis=1) - np.sort(A[okA], axis=1)[:, :3].mean(axis=1)).mean() if okA.any() else np.nan
        rows.append(row)
    return pd.DataFrame(rows)
