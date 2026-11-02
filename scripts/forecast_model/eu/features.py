"""The feature rows of the EU model - ONE function used both to build the training set and to score the live forecast, so
the two cannot drift apart (the Nordic model has the same logic written twice, in dataset.py and train_daily.score()).

Leakage rule (the same as the Nordic and Danish models): a row is (zone, target hour, horizon h). `h` is the number of
days from the LAST KNOWN price day to the target day, plus one - h = 2 is "the day after the last day whose prices are
published". A price lag of k days exists only when k >= h - 1 (anything younger is not known at issue time), and every
day-level statistic (`last_day_*`, `level_*`) ends at the last known day, target - (h - 1) days. Weather is the forecast as
issued at lead min(h, 7), never the actual.

All clocks are the zone's own wall clock (naive timestamps), because that is how the site shows a zone's day.
"""
import numpy as np
import pandas as pd

import calendar_features as cal
from zones import COUNTRY, ZONES

HORIZONS = range(2, 9)
LAGS = (1, 2, 3, 7, 14, 21, 28)
WX = ["wind", "rad", "temp", "precip"]
FEATS = ["zone", "h", "hour", "weekday", "month", "is_weekend", "is_holiday", "xmas_week", "doy_sin", "doy_cos",
         "lag_last", "lag1", "lag2", "lag3", "lag7", "lag14", "lag21", "lag28", "seasonal4w",
         "last_day_mean", "last_day_std", "level_7d", "level_30d",
         "eu_last_day_mean", "eu_level_7d", "eu_level_30d", "level_30d_vs_eu",
         "wind", "rad", "temp", "precip", "precip_24h", "reg_wind", "reg_rad", "reg_temp"]
RAW_VARS = {"wind": "wind_speed_100m", "rad": "direct_radiation", "temp": "temperature_2m", "precip": "precipitation"}


def to_local(df, tzname):
    """A frame on a UTC (naive) hourly index -> the same on the zone's naive local clock. The repeated autumn hour is
    averaged; the skipped spring hour is simply absent (NaN once reindexed)."""
    out = df.copy()
    out.index = (pd.DatetimeIndex(out.index).tz_localize("UTC").tz_convert(tzname).tz_localize(None))
    return out.groupby(level=0).mean()


def lead_columns(prev, lead):
    """previous-runs columns -> wind, rad, temp, precip for one lead."""
    return prev[[f"{RAW_VARS[k]}_previous_day{lead}" for k in WX]].set_axis(WX, axis=1)


def regional(zone_wx):
    """{zone: DataFrame(UTC index; wind, rad, temp, precip)} -> the EU-wide mean as reg_wind, reg_rad, reg_temp (UTC)."""
    stack = pd.concat([f[["wind", "rad", "temp"]] for f in zone_wx.values()], keys=range(len(zone_wx)))
    m = stack.groupby(level=1).mean()
    return m.rename(columns={"wind": "reg_wind", "rad": "reg_rad", "temp": "reg_temp"})


def day_table(prices):
    """{zone: hourly Series} -> (per-zone daily table, EU table), both indexed by calendar date.

    per zone: day_mean, day_std, level_7d, level_30d (trailing means of daily means, indexed by the last day included).
    EU: eu_day_mean, eu_level_7d, eu_level_30d from the zones' daily means (mean over the zones present that day)."""
    zones, means = {}, {}
    for z, p in prices.items():
        g = p.groupby(p.index.normalize())
        dm = g.mean()
        full = pd.date_range(dm.index.min(), dm.index.max(), freq="D")
        dm = dm.reindex(full)
        zones[z] = pd.DataFrame({"day_mean": dm, "day_std": g.std().reindex(full),
                                 "level_7d": dm.rolling(7, min_periods=3).mean(),
                                 "level_30d": dm.rolling(30, min_periods=10).mean()})
        means[z] = dm
    eu_dm = pd.concat(means, axis=1).mean(axis=1)
    eu = pd.DataFrame({"eu_day_mean": eu_dm, "eu_level_7d": eu_dm.rolling(7, min_periods=3).mean(),
                       "eu_level_30d": eu_dm.rolling(30, min_periods=10).mean()})
    return zones, eu


def make_features(zone, idx, h, p, wx, reg, days, eu):
    """Feature rows for the target hours `idx` (naive local DatetimeIndex) at horizon h.

    p     hourly prices of the zone (local clock); anything later than the last known day is ignored by construction
    wx    DataFrame (local clock): wind, rad, temp, precip - the weather AS ISSUED at lead min(h, 7)
    reg   DataFrame (local clock): reg_wind, reg_rad, reg_temp for the same lead
    days  the zone's daily table from day_table; eu the EU table
    """
    country = COUNTRY[zone]
    df = pd.DataFrame(index=idx)
    df["zone"] = zone
    df["h"] = h
    df["hour"] = idx.hour
    df["weekday"] = idx.weekday
    df["month"] = idx.month
    df["is_weekend"] = (idx.weekday >= 5).astype(int)
    hol, xm = cal.flags([t.date() for t in idx], country)
    df["is_holiday"], df["xmas_week"] = hol, xm
    df["doy_sin"] = np.sin(2 * np.pi * idx.dayofyear / 365.25)
    df["doy_cos"] = np.cos(2 * np.pi * idx.dayofyear / 365.25)
    for k in LAGS:
        df[f"lag{k}"] = p.reindex(idx - pd.Timedelta(days=k)).values if k >= h - 1 else np.nan
    # the same hour on the last KNOWN day: the "persistence" baseline, and populated at every horizon
    df["lag_last"] = p.reindex(idx - pd.Timedelta(days=h - 1)).values
    df["seasonal4w"] = df[[f"lag{k}" for k in (7, 14, 21, 28)]].mean(axis=1)
    last_known = idx.normalize() - pd.Timedelta(days=h - 1)
    for col in ("day_mean", "day_std", "level_7d", "level_30d"):
        df[{"day_mean": "last_day_mean", "day_std": "last_day_std"}.get(col, col)] = days[col].reindex(last_known).values
    df["eu_last_day_mean"] = eu["eu_day_mean"].reindex(last_known).values
    df["eu_level_7d"] = eu["eu_level_7d"].reindex(last_known).values
    df["eu_level_30d"] = eu["eu_level_30d"].reindex(last_known).values
    df["level_30d_vs_eu"] = df["level_30d"] - df["eu_level_30d"]
    w = wx.reindex(idx)
    for k in WX:
        df[k] = w[k].values
    df["precip_24h"] = wx["precip"].rolling(24, min_periods=6).sum().reindex(idx).values
    r = reg.reindex(idx)
    for k in ("reg_wind", "reg_rad", "reg_temp"):
        df[k] = r[k].values
    return df
