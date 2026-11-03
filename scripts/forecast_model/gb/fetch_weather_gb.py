#!/usr/bin/env python3
"""Weather for Great Britain, as the forecast was ISSUED (Open-Meteo previous-runs), three points averaged: Scotland / North Sea wind, the English
midlands (demand and solar) and the southern North Sea. Same API, variables and cache layout as scripts/forecast_model/eu/fetch_weather.py (this module
reuses its request helpers); only the points differ, and it fetches leads 1..7 because Great Britain is forecast from today (lead 1 is the forecast
issued the day before).

    w_prev_gb_<i>.parquet     one per point, hours in UTC, columns <var>_previous_day<lead>

live() returns the current forecast (hourly, UTC) averaged over the points, for the next 10 days and the day before.
"""
import os
import sys
import time
from datetime import date, timedelta

import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
for p in (DIR, os.path.join(DIR, "..", "eu")):
    sys.path.insert(0, p)
import fetch_weather as W                     # noqa: E402  (the EU module: get, months, _frame, BASE, LIVE, VARS)

POINTS = [(56.2, -3.8), (52.8, -1.5), (53.6, 1.4)]          # lat, lon
VARS = W.VARS
LEADS = range(1, 8)
PREV_VARS = [f"{v}_previous_day{d}" for v in VARS for d in LEADS]
DATA = os.environ.get("GB_DATA_DIR", DIR)


def path(i, out_dir=None):
    return os.path.join(out_dir or DATA, f"w_prev_gb_{i}.parquet")


def _request(s, e):
    lats = ",".join(str(p[0]) for p in POINTS)
    lons = ",".join(str(p[1]) for p in POINTS)
    res = W.get(f"{W.BASE}?latitude={lats}&longitude={lons}&hourly={','.join(PREV_VARS)}&start_date={s}&end_date={e}&timezone=GMT")
    return res if isinstance(res, list) else [res]


def fetch_history(out_dir=None, today=None, pause=20):
    today = today or date.today()
    yesterday = today - timedelta(days=1)
    have = all(os.path.exists(path(i, out_dir)) for i in range(len(POINTS)))
    if have:
        last = min(pd.read_parquet(path(i, out_dir), columns=["time"]).time.max() for i in range(len(POINTS))).date()
        lo = last - timedelta(days=2)
        if lo >= yesterday:
            return
        ranges, old = [(lo, yesterday)], [pd.read_parquet(path(i, out_dir)) for i in range(len(POINTS))]
    else:
        ranges, old = list(W.months(W.PREV_START, yesterday)), None
    frames = [[] for _ in POINTS]
    for s, e in ranges:
        print(f"weather gb {s}..{e}", flush=True)
        for i, loc in enumerate(_request(s, e)):
            frames[i].append(W._frame(loc))
        time.sleep(3 if old else pause)
    for i in range(len(POINTS)):
        parts = ([old[i]] if old else []) + [f for f in frames[i] if len(f)]
        df = pd.concat(parts).drop_duplicates("time", keep="last").sort_values("time")
        df.to_parquet(path(i, out_dir), index=False)
        print(f"  saved gb_{i}: {len(df)} h to {df.time.max():%Y-%m-%d}", flush=True)


def load_prev(out_dir=None):
    """The mean over the points: a frame on a UTC hourly index, columns PREV_VARS."""
    fr = [pd.read_parquet(path(i, out_dir)).set_index("time")[PREV_VARS] for i in range(len(POINTS))]
    return sum(fr) / len(fr)


def live(horizon_days=10):
    """The current forecast averaged over the points: UTC hourly index, columns VARS (raw Open-Meteo names)."""
    lats = ",".join(str(p[0]) for p in POINTS)
    lons = ",".join(str(p[1]) for p in POINTS)
    res = W.get(f"{W.LIVE}?latitude={lats}&longitude={lons}&hourly={','.join(VARS)}&forecast_days={horizon_days}&past_days=1&timezone=GMT")
    res = res if isinstance(res, list) else [res]
    fr = [W._frame(loc).set_index("time")[VARS] for loc in res]
    return sum(fr) / len(fr)


if __name__ == "__main__":
    fetch_history()
    print("WEATHER DONE", flush=True)
