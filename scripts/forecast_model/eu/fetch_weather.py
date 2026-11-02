#!/usr/bin/env python3
"""Weather for the EU zones' points, as the forecast was ISSUED, from Open-Meteo's previous-runs API.

previous_dayN is the forecast for an hour as it stood N days before, so a training row carries exactly the weather
quality the live model gets at the same horizon (the Nordic and Danish models do the same). Only leads 2..7 are
fetched: the model's horizon h = 2..7 uses lead h, and lead 1 would never be read.

History is cached as one parquet per weather point (w_prev_<zone>_<i>.parquet, hours in UTC); a later run re-fetches
the last three days and merges, because the newest previous-runs values are still filled in when first read. Open-Meteo
weights a call by points x variables x days, so the first run is paced (RAMP pause) to stay under the hourly limit of
the free tier; the daily top-up is a handful of calls.

live() returns the CURRENT 10-day forecast for every point, for scoring.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta

import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
from zones import all_points              # noqa: E402

VARS = ["wind_speed_100m", "direct_radiation", "temperature_2m", "precipitation"]
LEADS = range(2, 8)
PREV_VARS = [f"{v}_previous_day{d}" for v in VARS for d in LEADS]
PREV_START = date(2024, 3, 15)           # the previous-runs archive starts here
PER_CALL = 5                              # points per request
CHUNK_MONTHS = 3
RAMP_PAUSE = 55                           # seconds between history requests (hourly limit 5,000 weighted calls)
BASE = "https://previous-runs-api.open-meteo.com/v1/forecast"
LIVE = "https://api.open-meteo.com/v1/forecast"


def get(url, tries=14):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=240) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if i == tries - 1:
                raise
            wait = min(70 * (i + 1), 600) if e.code in (429, 503) else 20 * (i + 1)
            print(f"    HTTP {e.code}, retry in {wait}s", flush=True)
            time.sleep(wait)
        except Exception as e:
            if i == tries - 1:
                raise
            print(f"    {type(e).__name__}, retry in {min(60 * (i + 1), 300)}s", flush=True)
            time.sleep(min(60 * (i + 1), 300))


def months(start, end, n=CHUNK_MONTHS):
    cur = start
    while cur <= end:
        nxt = (cur.replace(day=1) + timedelta(days=31 * n)).replace(day=1)
        yield cur, min(nxt - timedelta(days=1), end)
        cur = nxt


def path(zone, i, out_dir=DIR):
    return os.path.join(out_dir, f"w_prev_{zone}_{i}.parquet")


def _frame(loc):
    df = pd.DataFrame(loc.get("hourly", {}))
    if len(df):
        df["time"] = pd.to_datetime(df["time"])
    return df


def _request(pts, s, e):
    lats = ",".join(str(p[2]) for p in pts)
    lons = ",".join(str(p[3]) for p in pts)
    res = get(f"{BASE}?latitude={lats}&longitude={lons}&hourly={','.join(PREV_VARS)}"
              f"&start_date={s}&end_date={e}&timezone=GMT")
    return res if isinstance(res, list) else [res]


def fetch_history(out_dir=DIR, today=None, pause=RAMP_PAUSE, only=None):
    """Create or top up every point's cache. Points are grouped PER_CALL to a request; `only` is an optional set of group
    indexes (so a first run can be split over several processes, each its own groups)."""
    today = today or date.today()
    yesterday = today - timedelta(days=1)
    points = all_points()
    for g in range(0, len(points), PER_CALL):
        if only is not None and g // PER_CALL not in only:
            continue
        group = points[g:g + PER_CALL]
        have = [os.path.exists(path(p[0], p[1], out_dir)) for p in group]
        if all(have):
            last = min(pd.to_datetime(pd.read_parquet(path(p[0], p[1], out_dir), columns=["time"]).time).max().date()
                       for p in group)
            lo = last - timedelta(days=2)
            if lo >= yesterday:
                continue
            ranges = [(lo, yesterday)]
            old = {(p[0], p[1]): pd.read_parquet(path(p[0], p[1], out_dir)) for p in group}
        else:
            ranges = list(months(PREV_START, yesterday))
            old = {}
        frames = {(p[0], p[1]): [] for p in group}
        for s, e in ranges:
            print(f"history {group[0][0]}.. {s}..{e}", flush=True)
            for p, loc in zip(group, _request(group, s, e)):
                frames[(p[0], p[1])].append(_frame(loc))
            time.sleep(3 if old else pause)
        for p in group:
            key = (p[0], p[1])
            parts = ([old[key]] if key in old else []) + [f for f in frames[key] if len(f)]
            df = pd.concat(parts).drop_duplicates("time", keep="last").sort_values("time")
            df.to_parquet(path(p[0], p[1], out_dir), index=False)
            print(f"  saved {p[0]}_{p[1]}: {len(df)} h to {df.time.max():%Y-%m-%d}", flush=True)


def load_zone(zone, n_points, out_dir=DIR):
    """The zone's weather as ONE frame (UTC hours): the mean over its points, columns as PREV_VARS."""
    frames = []
    for i in range(n_points):
        df = pd.read_parquet(path(zone, i, out_dir)).set_index("time")
        frames.append(df[PREV_VARS])
    return sum(frames) / len(frames) if len(frames) > 1 else frames[0]


def live(horizon_days=10):
    """{zone: DataFrame(UTC hourly index; columns VARS)} - the current forecast, point-averaged per zone."""
    points = all_points()
    per_zone = {}
    for g in range(0, len(points), 10):
        group = points[g:g + 10]
        lats = ",".join(str(p[2]) for p in group)
        lons = ",".join(str(p[3]) for p in group)
        res = get(f"{LIVE}?latitude={lats}&longitude={lons}&hourly={','.join(VARS)}"
                  f"&forecast_days={horizon_days}&past_days=1&timezone=GMT")
        res = res if isinstance(res, list) else [res]
        for p, loc in zip(group, res):
            df = _frame(loc).set_index("time")[VARS]
            per_zone.setdefault(p[0], []).append(df)
        time.sleep(2)
    return {z: (sum(v) / len(v)) for z, v in per_zone.items()}


if __name__ == "__main__":
    fetch_history(only={int(a) for a in sys.argv[1:]} or None)
    print("WEATHER DONE", flush=True)
