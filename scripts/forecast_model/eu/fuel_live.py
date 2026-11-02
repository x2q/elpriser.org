"""Fuel inputs for the DAILY job: refresh the cache, decide whether it is good enough to use, and never let a failing fuel source stop a run.

The model uses the MIBGAS gas day-ahead index and the EEX EUA auction price as INPUTS only (fetch_fuel.py, fuel_features.py): nothing here
is published, displayed or redistributed. This module is the failure policy around them:

* The cache (`fuel_daily.csv`) is refreshed on every run. A source that fails keeps its cached values (fetch_fuel.update), so a blocked
  source shows up only as an old newest value.
* Gas is usable while its newest PRINT is at most MAX_GAS_AGE_DAYS old (the index is fixed every day, weekends included, so 3 days means
  the feed has been dead for two days). Carbon is usable while its newest auction is at most MAX_EUA_AGE_DAYS old: the EUA is auctioned on
  weekdays only, so a long weekend alone makes it 4 days old and a stricter limit would switch the fuel off for nothing.
* Both must be present and sane (a price outside a wide band is a parse accident, not a market). Otherwise `load` returns table None: the
  caller then runs every zone that would use fuel WITHOUT it (the no-fuel recipe of publish_gate.json, with its own gate) and logs why.
  The zones that never used fuel (EE, LV, LT) are not affected. A failure here never raises into the caller.
"""
import os
import sys
from datetime import date

import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import fetch_fuel as FF          # noqa: E402
import fuel_features as FUEL     # noqa: E402

MAX_GAS_AGE_DAYS = 3
MAX_EUA_AGE_DAYS = 6
GAS_RANGE = (1.0, 800.0)         # EUR/MWh; the highest print of the 2022 crisis was ~340
EUA_RANGE = (1.0, 400.0)         # EUR/tCO2


def newest(series):
    """(date, value) of the newest non-empty entry, or (None, None)."""
    s = series.dropna()
    return (s.index.max().date(), float(s.iloc[-1])) if len(s) else (None, None)


def assess(df, today):
    """(ok, status) for a cache frame. `status` is always a dict that can be logged: the dates of the newest prints, their ages in days and,
    when not ok, `reason`."""
    st = {"gas_date": None, "gas_age": None, "eua_date": None, "eua_age": None, "reason": None}
    if df is None or not len(df):
        st["reason"] = "no fuel cache"
        return False, st
    for col, key in (("gas_da", "gas"), ("eua", "eua")):
        if col not in df:
            st["reason"] = f"no {col} column"
            return False, st
        d, v = newest(df[col])
        st[f"{key}_date"] = d.isoformat() if d else None
        st[f"{key}_age"] = (today - d).days if d else None
        st[f"{key}_value"] = v
    reasons = []
    if st["gas_age"] is None or st["gas_age"] > MAX_GAS_AGE_DAYS:
        reasons.append(f"gas print is {st['gas_age']} days old (limit {MAX_GAS_AGE_DAYS})")
    elif not GAS_RANGE[0] <= st["gas_value"] <= GAS_RANGE[1]:
        reasons.append("gas value out of range")
    if st["eua_age"] is None or st["eua_age"] > MAX_EUA_AGE_DAYS:
        reasons.append(f"EUA print is {st['eua_age']} days old (limit {MAX_EUA_AGE_DAYS})")
    elif not EUA_RANGE[0] <= st["eua_value"] <= EUA_RANGE[1]:
        reasons.append("EUA value out of range")
    st.pop("gas_value", None)
    st.pop("eua_value", None)
    st["reason"] = "; ".join(reasons) or None
    return not reasons, st


def load(cache_path, today=None, start="2023-01-01", refresh=True, updater=None, log=print):
    """-> (table, status). `table` is the daily feature table (fuel_features.daily_table) or None when the fuel must not be used."""
    today = today or date.today()
    updater = updater or FF.update
    df = None
    if refresh:
        try:
            df = updater(cache_path, start)
        except Exception as e:                       # a failing fetch must not stop the run: fall back to what the cache holds
            log(f"  fuel: refresh failed ({type(e).__name__}): using the cache")
    if df is None and os.path.exists(cache_path):
        try:
            df = FF.load(cache_path)
        except Exception as e:
            log(f"  fuel: cache unreadable ({type(e).__name__})")
    ok, st = assess(df, today)
    if not ok:
        return None, st
    try:
        return FUEL.daily_table(df), st
    except Exception as e:                           # the features could not be built from this cache: same as no fuel
        st["reason"] = f"features failed ({type(e).__name__})"
        return None, st
