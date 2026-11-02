"""Leak-free fuel features for the (zone, target hour, horizon h) rows of the EU model, from the daily cache of fetch_fuel.py.

Leakage rule. A forecast of target day T at horizon h is issued on day T - h (h = 2: the day before the day-after-tomorrow's
price auction results are known; the last known PRICE day is T - h + 1). The fuel value used is the one of the CLOSE of the
day BEFORE issue, f = T - h - 1: a full day more cautious than necessary (the MIBGAS index of the issue day and the 11:00
EUA auction of the issue day are public before the day-ahead auction results at 13:00), so no feature can contain a number
that was not settled when the forecast was made. Weekends and holidays carry the last published value forward (the EUA is
auctioned on weekdays only).

Features (per row; the same value for every zone - the fuel is a EUROPE-wide level, the zone decides what it does with it):
  gas, gas_d7, gas_d28       gas day-ahead level (EUR/MWh) and its 7-/28-day change
  gas_m1_spread              month-ahead minus day-ahead gas: where the market expects the level to go
  eua, eua_d7, eua_d28       carbon level (EUR/tCO2) and its changes
  ccgt_mc, ccgt_mc_d7, _d28  marginal cost of a combined-cycle gas plant, gas / 0.55 + 0.202 / 0.55 * eua (EUR/MWh_e):
                             the number a gas-priced hour clears near, with the two inputs already combined
  full, full_d28             storage fill (per cent) and its 28-day change, only when the cache has the AGSI+ column
  fuel_age                   days between f and the newest value actually published at or before f (a stale feed is visible)
"""
import numpy as np
import pandas as pd

CCGT_EFF = 0.55
EF_T_PER_MWH_TH = 0.202          # tCO2 per MWh of gas burnt
BASE = ["gas", "gas_d7", "gas_d28", "gas_m1_spread", "eua", "eua_d7", "eua_d28", "ccgt_mc", "ccgt_mc_d7", "ccgt_mc_d28", "fuel_age"]
STORAGE = ["full", "full_d28"]


def calendar_frame(fuel):
    """The cache on a gapless daily index, filled forward, plus `age` = days since the value was actually published."""
    idx = pd.date_range(fuel.index.min().normalize(), fuel.index.max().normalize(), freq="D")
    f = fuel.reindex(idx)
    published = pd.Series(np.where(f["gas_da"].notna(), idx.to_numpy(), np.datetime64("NaT")), index=idx)
    age = (pd.Series(idx, index=idx) - published.ffill()).dt.days
    out = f.ffill()
    out["age"] = age
    return out


def daily_table(fuel):
    """Per fuel day f: the level and change columns, as a frame indexed by f."""
    c = calendar_frame(fuel)
    t = pd.DataFrame(index=c.index)
    t["gas"] = c["gas_da"]
    t["gas_d7"] = c["gas_da"] - c["gas_da"].shift(7)
    t["gas_d28"] = c["gas_da"] - c["gas_da"].shift(28)
    t["gas_m1_spread"] = c["gas_m1"] - c["gas_da"]
    t["eua"] = c["eua"]
    t["eua_d7"] = c["eua"] - c["eua"].shift(7)
    t["eua_d28"] = c["eua"] - c["eua"].shift(28)
    mc = c["gas_da"] / CCGT_EFF + EF_T_PER_MWH_TH / CCGT_EFF * c["eua"]
    t["ccgt_mc"] = mc
    t["ccgt_mc_d7"] = mc - mc.shift(7)
    t["ccgt_mc_d28"] = mc - mc.shift(28)
    if "full" in c and c["full"].notna().any():
        t["full"] = c["full"]
        t["full_d28"] = c["full"] - c["full"].shift(28)
    t["fuel_age"] = c["age"]
    return t


def for_rows(table, target_dates, h):
    """Fuel features for target DAYS (any date-like array) at horizon h: the table row of f = T - h - 1.
    Days before the table starts (or after it ends: the newest value is carried) give NaN / the last row."""
    f = pd.DatetimeIndex(target_dates).normalize() - pd.Timedelta(days=int(h) + 1)
    rows = table.reindex(f)
    last = table.index.max()
    late = f > last                      # a feed that stopped: carry the newest row, its age grows (visible in fuel_age)
    if late.any():
        rows = rows.copy()
        rows.loc[late, :] = table.iloc[-1].to_numpy()
        rows.loc[late, "fuel_age"] = table.iloc[-1]["fuel_age"] + (f[late] - last).days
    return rows.reset_index(drop=True)


def add_to_frame(df, table, date_col="date", h_col="h"):
    """Append the fuel columns to a rows frame that has a date and an h column, one call per distinct h."""
    parts = []
    for h, g in df.groupby(h_col, sort=False):
        feats = for_rows(table, g[date_col].to_numpy(), h)
        feats.index = g.index
        parts.append(feats)
    out = pd.concat(parts).reindex(df.index)
    return pd.concat([df, out], axis=1)
