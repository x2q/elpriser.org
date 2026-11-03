"""Feature rows of the Great Britain estimate: one row per (as-of day D, as-of hour a, target day offset k, target hour).

The information state of a row is exactly what the page's job knows at London clock hour `a` (minute :12) of day D:
  * every complete hour of days <= D-1 and the complete hours 0..a-1 of day D (the Elexon Market Index Price is published hour by hour);
  * the weather forecast: the previous-runs forecast issued `lead` days before the target (lead = max(1, k), at most 7) in the backtest, the
    current forecast live (never staler than the backtest's).
k = 0 is the rest of today (hours a..23); k = 1 is tomorrow ... k = 7.
Leakage rule: a price lag of l days exists for a target day T only when T - l <= D - 1 (a complete day); every day-level statistic ends at D - 1;
today's hours enter only through the intraday residuals rho (hours < a).

Baselines carried in the rows (all functions of the same information): b_persist (the last complete day's same hour), b_lag7 (the same hour a week
earlier, else two), b_sea (mean of the same hour 7/14/21/28 days earlier that are complete), b_A = level + shape (the EU model's naive method:
the seasonal profile minus its own daily mean, plus the mean of the last 7 complete days).
"""
import math
import os
import sys
import warnings
from datetime import date, timedelta

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore", message="Mean of empty slice")      # a day or an hour with no price at all is a NaN here, by design
DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import gbcal                                                    # noqa: E402

LAGS = (7, 14, 21, 28)
KS = tuple(range(0, 8))
WX = ["wind", "rad", "temp", "precip"]
RAW_VARS = {"wind": "wind_speed_100m", "rad": "direct_radiation", "temp": "temperature_2m", "precip": "precipitation"}
TAUS = (3.0, 12.0, 48.0)
MIN_HOURS_DAY = 20            # a day with fewer priced hours has no daily mean (a missing hour on a clock-change day does not break the level)


def to_local(df):
    """A frame on a UTC (naive) hourly index -> the same on the London naive wall clock (the repeated autumn hour averaged, the skipped spring hour absent)."""
    out = df.copy()
    out.index = pd.DatetimeIndex(out.index).tz_localize("UTC").tz_convert("Europe/London").tz_localize(None)
    return out.groupby(level=0).mean()


def weather_local(prev, lead):
    """previous-runs frame (UTC, columns <raw var>_previous_day<lead>) -> local frame with columns WX."""
    return to_local(prev[[f"{RAW_VARS[k]}_previous_day{lead}" for k in WX]].set_axis(WX, axis=1))


def live_local(live):
    """The live forecast frame (UTC, raw names) -> local frame with columns WX."""
    return to_local(live.rename(columns={v: k for k, v in RAW_VARS.items()})[WX])


class Hist:
    """Day x hour matrices of prices and weather on the London wall clock. `p` is the hourly price Series (naive local index)."""

    def __init__(self, p, wx_by_lead=None, wx_live=None, extra_days=10):
        self.day0 = p.index.min().normalize()
        last = p.index.max().normalize() + pd.Timedelta(days=extra_days)
        self.days = pd.date_range(self.day0, last, freq="D")
        self.nd = len(self.days)
        self.P = self._mat(p)
        dm_n = np.isfinite(self.P).sum(axis=1)
        self.dm = np.where(dm_n >= MIN_HOURS_DAY, np.nansum(np.where(np.isfinite(self.P), self.P, 0.0), axis=1) / np.maximum(dm_n, 1), np.nan)
        s = pd.Series(self.dm)
        self.l7 = s.rolling(7, min_periods=3).mean().to_numpy()         # indexed by the last day included
        self.l30 = s.rolling(30, min_periods=10).mean().to_numpy()
        self.wx = {}
        self.live = None
        if wx_by_lead:
            for lead, f in wx_by_lead.items():
                self.wx[lead] = {k: self._mat(f[k]) for k in WX}
        if wx_live is not None:
            self.live = {k: self._mat(wx_live[k]) for k in WX}

    def _mat(self, s):
        full = pd.date_range(self.days[0], self.days[-1] + pd.Timedelta(hours=23), freq="h")
        return np.array(s.reindex(full).to_numpy(dtype=float).reshape(self.nd, 24))     # a writable copy (the live job masks today's unfinished hours)

    def di(self, d):
        return (pd.Timestamp(d) - self.day0).days

    def weather(self, ti, lead):
        """{var: 24-array} for day index ti: live forecast when present, else the previous-runs forecast of that lead (NaN where there is none)."""
        if self.live is not None:
            return {k: self.live[k][ti] for k in WX}
        w = self.wx.get(lead)
        return {k: (w[k][ti] if w else np.full(24, np.nan)) for k in WX}


def day_block(h, di, k):
    """Baselines and statistics for the target day di+k as known on the morning of day index di: dict of 24-arrays/scalars, or None when there is no level."""
    ti = di + k
    lvl = h.l7[di - 1]
    if not np.isfinite(lvl):
        return None
    sea_stack = [h.P[ti - lag] for lag in LAGS if ti - lag <= di - 1 and ti - lag >= 0]
    if not sea_stack:
        return None
    with np.errstate(all="ignore"):
        sea = np.nanmean(np.vstack(sea_stack), axis=0)
        shape = sea - np.nanmean(sea)
    lag7 = h.P[ti - 7] if ti - 7 <= di - 1 else (h.P[ti - 14] if ti - 14 >= 0 else np.full(24, np.nan))
    return {"A": shape + lvl, "sea": sea, "shape": shape, "lag7": lag7, "lvl": lvl, "l30": h.l30[di - 1], "persist": h.P[di - 1],
            "last_mean": h.dm[di - 1]}


def rows_for_day(h, D, asofs, ks=KS):
    """List of column dicts (one per (a, k)) for as-of day D; hours of day D at or after `a` are treated as unknown."""
    di = h.di(D)
    blocks = {k: day_block(h, di, k) for k in ks}
    if blocks.get(0) is None:
        return []
    r_full = h.P[di] - blocks[0]["A"]                                    # today's residuals against the baseline, valid for hours < a
    out = []
    for a in asofs:
        known = r_full[:a]
        known = known[np.isfinite(known)]
        rho_all = float(known.mean()) if len(known) else 0.0
        rho1 = float(r_full[a - 1]) if a > 0 and np.isfinite(r_full[a - 1]) else (float(known[-1]) if len(known) else 0.0)
        rho3 = float(known[-3:].mean()) if len(known) else 0.0
        pk, ak = h.P[di][:a], blocks[0]["A"][:a]
        ok = np.isfinite(pk) & np.isfinite(ak)
        known_mean = float(pk[ok].mean()) if ok.any() else np.nan
        a_known_mean = float(ak[ok].mean()) if ok.any() else np.nan
        last_dev = (float(h.P[di, a - 1] - blocks[0]["lvl"]) if a > 0 and np.isfinite(h.P[di, a - 1]) else 0.0)
        for k in ks:
            b = blocks[k]
            if b is None:
                continue
            ti = di + k
            hrs = np.arange(a, 24) if k == 0 else np.arange(24)
            if not len(hrs):
                continue
            wd = (pd.Timestamp(D) + pd.Timedelta(days=k))
            dd = wd.date()
            wlead = max(1, min(k, 7))
            w = h.weather(ti, wlead)
            ahead = (k * 24 + hrs) - a + 1
            n = len(hrs)
            c = {"D": np.full(n, di), "a": np.full(n, a), "k": np.full(n, k), "hr": hrs, "ahead": ahead,
                 "wd": np.full(n, wd.weekday()), "is_hol": np.full(n, int(gbcal.is_holiday(dd))), "xmas": np.full(n, int(gbcal.xmas_week(dd))),
                 "doy_sin": np.full(n, math.sin(2 * math.pi * wd.dayofyear / 365.25)), "doy_cos": np.full(n, math.cos(2 * math.pi * wd.dayofyear / 365.25)),
                 "month": np.full(n, wd.month),
                 "b_A": b["A"][hrs], "b_sea": b["sea"][hrs], "b_lag7": b["lag7"][hrs], "b_persist": b["persist"][hrs],
                 "shape": b["shape"][hrs], "level_7d": np.full(n, b["lvl"]), "level_30d": np.full(n, b["l30"]),
                 "last_vs_lvl": np.full(n, b["last_mean"] - b["lvl"]), "trend": np.full(n, b["lvl"] - b["l30"]),
                 "sh_persist": b["persist"][hrs] - b["last_mean"], "lag7_dev": b["lag7"][hrs] - b["sea"][hrs],
                 "rho1": np.full(n, rho1), "rho3": np.full(n, rho3), "rho_all": np.full(n, rho_all), "last_dev": np.full(n, last_dev),
                 "n_known": np.full(n, len(known)), "known_mean": np.full(n, known_mean), "a_known_mean": np.full(n, a_known_mean),
                 "y": h.P[ti][hrs]}
            for v in WX:
                c[v] = w[v][hrs]
            c["wind_day"] = np.full(n, np.nanmean(w["wind"])) if np.isfinite(w["wind"]).any() else np.full(n, np.nan)
            c["rad_day"] = np.full(n, np.nanmean(w["rad"])) if np.isfinite(w["rad"]).any() else np.full(n, np.nan)
            out.append(c)
    return out


def build(h, dates, asofs, ks=KS):
    """DataFrame of rows for the as-of days `dates` (an iterable of dates)."""
    parts = []
    for D in dates:
        parts += rows_for_day(h, D, asofs, ks)
    if not parts:
        return pd.DataFrame()
    cols = parts[0].keys()
    df = pd.DataFrame({c: np.concatenate([p[c] for p in parts]) for c in cols})
    df["date"] = h.days[df["D"].to_numpy()] + pd.to_timedelta(df["k"], unit="D")          # the TARGET day
    df["asof_date"] = h.days[df["D"].to_numpy()]
    return df


# ------------------------------------------------------------------ the linear model's design
def design(df):
    """Float matrix and column names of the ridge: everything is relative to the baseline (the target is y - b_A), weather by hour of day."""
    X = {}
    for tau in TAUS:
        e = np.exp(-df["ahead"].to_numpy() / tau)
        X[f"rho1_{int(tau)}"] = df["rho1"].to_numpy() * e
        X[f"rho3_{int(tau)}"] = df["rho3"].to_numpy() * e
        X[f"rhoall_{int(tau)}"] = df["rho_all"].to_numpy() * e
    X["last_dev_e"] = df["last_dev"].to_numpy() * np.exp(-df["ahead"].to_numpy() / 3.0)
    X["trend"] = (df["level_7d"] - df["level_30d"]).fillna(0).to_numpy()
    X["last_vs_lvl"] = df["last_vs_lvl"].fillna(0).to_numpy()
    X["sh_persist"] = df["sh_persist"].fillna(0).to_numpy()
    X["lag7_dev"] = df["lag7_dev"].fillna(0).to_numpy()
    X["is_wkend"] = (df["wd"] >= 5).astype(float).to_numpy()
    X["is_hol"] = df["is_hol"].astype(float).to_numpy()
    X["xmas"] = df["xmas"].astype(float).to_numpy()
    for d in range(1, 7):
        X[f"wd{d}"] = (df["wd"] == d).astype(float).to_numpy()
    for hr in range(1, 24):
        X[f"hr{hr}"] = (df["hr"] == hr).astype(float).to_numpy()
    for v in ("wind", "rad", "temp"):
        X[v] = df[v].fillna(df[v].mean() if df[v].notna().any() else 0).to_numpy()
    wind = df["wind"].fillna(0).to_numpy()
    rad = df["rad"].fillna(0).to_numpy()
    for hr in range(24):
        m = (df["hr"] == hr).to_numpy()
        X[f"wind_x_h{hr}"] = wind * m
        X[f"rad_x_h{hr}"] = rad * m
    X["wind_day"] = df["wind_day"].fillna(0).to_numpy()
    return pd.DataFrame(X, index=df.index)


def design_b(df):
    """Candidate B's ridge: the intraday residuals and the hour of day only - no weather, no lags."""
    X = {}
    for tau in TAUS:
        e = np.exp(-df["ahead"].to_numpy() / tau)
        X[f"rho1_{int(tau)}"] = df["rho1"].to_numpy() * e
        X[f"rho3_{int(tau)}"] = df["rho3"].to_numpy() * e
        X[f"rhoall_{int(tau)}"] = df["rho_all"].to_numpy() * e
    X["last_dev_e"] = df["last_dev"].to_numpy() * np.exp(-df["ahead"].to_numpy() / 3.0)
    return pd.DataFrame(X, index=df.index)


# No absolute price level among the tree features (b_A, level_7d, level_30d): a tree cannot extrapolate beyond the levels it has seen, and after the September
# 2026 shift (60-100 GBP/MWh before, 130-210 after) the version with them was 17-25 GBP/MWh too low on average (exp_lgb.py). The target is y - b_A, so the
# level still enters through b_A; the trees see only relative features.
LGB_FEATS = ["a", "k", "hr", "ahead", "wd", "is_hol", "xmas", "doy_sin", "doy_cos", "shape", "trend", "last_vs_lvl", "sh_persist",
             "lag7_dev", "rho1", "rho3", "rho_all", "last_dev", "n_known", "wind", "rad", "temp", "precip", "wind_day", "rad_day"]
