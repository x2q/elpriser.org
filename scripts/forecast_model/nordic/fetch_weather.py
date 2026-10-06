#!/usr/bin/env python3
"""Weather for 13 bidding-zone points: forecast-as-issued plus actuals.

One representative point per zone — deliberately simpler than the Danish v3
model's 14-point setup, because this model has to cover 13 zones and stay
maintainable. The Nordic zones are also mostly hydro-driven, where the
day-to-day price signal comes less from siting wind precisely than from
temperature (demand) and precipitation (inflow).

PRECIPITATION is the addition that matters here and does not exist in the
Danish pipeline: NO and SE prices are set by reservoir hydrology, so rainfall
is a genuine price driver in a way it simply is not in Denmark.

previous_day1..7 gives the forecast AS IT WAS ISSUED N days before delivery,
so training rows carry the same quality of information the live model gets.
"""
import json, os, time, urllib.request
from datetime import date, timedelta

import pandas as pd

OUT = os.path.dirname(os.path.abspath(__file__))
PREV_START, ARCH_START = "2024-03-15", "2022-01-01"


def _yesterday():
    """The last day either API has complete data for.

    This used to be a literal, END = "2026-07-30", and the files were cached
    forever once they existed. Every daily run then reported "cached", the
    training dataset (which keeps only rows that have weather) stopped at that
    date, and the model trained on the identical 2,154,024 rows for ten weeks
    without a single error to say so."""
    return (date.today() - timedelta(days=1)).isoformat()

POINTS = {
    "dk1": (56.0, 9.5),    "dk2": (55.5, 12.0),
    "no1": (60.0, 10.5),   "no2": (58.5, 7.0),    "no3": (63.4, 10.9),
    "no4": (69.0, 19.0),   "no5": (60.4, 6.0),
    "se1": (65.8, 21.7),   "se2": (62.4, 17.3),   "se3": (59.3, 17.0),
    "se4": (56.0, 14.0),   "fi": (60.5, 25.0),    "nl": (52.5, 5.0),
}
GROUPS = [["dk1", "dk2", "no1", "no2"], ["no3", "no4", "no5", "se1"],
          ["se2", "se3", "se4", "fi"], ["nl"]]

VARS = ["wind_speed_100m", "direct_radiation", "temperature_2m", "precipitation"]
PREV_VARS = [f"{v}_previous_day{d}" for v in VARS for d in range(1, 8)]


def get(url, tries=6):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=240) as r:
                return json.load(r)
        except Exception as e:
            if i == tries - 1:
                raise
            w = 20 * (i + 1)
            print(f"    retry in {w}s: {e}", flush=True)
            time.sleep(w)


def chunks(start, end, months=3):
    s = date.fromisoformat(start); e = date.fromisoformat(end); cur = s
    while cur <= e:
        nxt = (cur.replace(day=1) + timedelta(days=31 * months)).replace(day=1)
        yield cur.isoformat(), min(nxt - timedelta(days=1), e).isoformat()
        cur = nxt


def topup(kind, names):
    """Extend each cached file to yesterday. Re-fetches the last two days of
    what is already there and lets the new rows win, because the most recent
    previous-runs values are still being filled in when they are first read."""
    base = ("https://previous-runs-api.open-meteo.com/v1/forecast" if kind == "prev"
            else "https://archive-api.open-meteo.com/v1/archive")
    hourly = ",".join(PREV_VARS if kind == "prev" else VARS)
    for n in names:
        path = f"{OUT}/w_{kind}_{n}.parquet"
        old = pd.read_parquet(path)
        last = pd.to_datetime(old["time"]).max().date()
        lo, hi = last - timedelta(days=2), date.today() - timedelta(days=1)
        if lo >= hi:
            continue
        lat, lon = POINTS[n]
        res = get(f"{base}?latitude={lat}&longitude={lon}&hourly={hourly}"
                  f"&start_date={lo}&end_date={hi}&timezone=Europe/Copenhagen")
        new = pd.DataFrame((res[0] if isinstance(res, list) else res).get("hourly", {}))
        if not len(new):
            print(f"  {kind} {n}: nothing new for {lo}..{hi}", flush=True)
            continue
        merged = pd.concat([old, new]).drop_duplicates("time", keep="last")
        merged.to_parquet(path, index=False)
        print(f"  {kind} {n}: {last} -> {pd.to_datetime(merged['time']).max().date()} (+{len(merged) - len(old)} h)", flush=True)
        time.sleep(3)


def fetch(kind):
    base = ("https://previous-runs-api.open-meteo.com/v1/forecast" if kind == "prev"
            else "https://archive-api.open-meteo.com/v1/archive")
    hourly = ",".join(PREV_VARS if kind == "prev" else VARS)
    start = PREV_START if kind == "prev" else ARCH_START
    for group in GROUPS:
        if all(os.path.exists(f"{OUT}/w_{kind}_{n}.parquet") for n in group):
            topup(kind, group)
            continue
        lats = ",".join(str(POINTS[n][0]) for n in group)
        lons = ",".join(str(POINTS[n][1]) for n in group)
        frames = {n: [] for n in group}
        for s, e in chunks(start, _yesterday()):
            print(f"{kind} {group[0]}..{group[-1]} {s}..{e}", flush=True)
            res = get(f"{base}?latitude={lats}&longitude={lons}&hourly={hourly}"
                      f"&start_date={s}&end_date={e}&timezone=Europe/Copenhagen")
            if not isinstance(res, list):
                res = [res]
            for name, loc in zip(group, res):
                frames[name].append(pd.DataFrame(loc.get("hourly", {})))
            time.sleep(10)
        for n in group:
            df = pd.concat(frames[n]).drop_duplicates("time")
            df.to_parquet(f"{OUT}/w_{kind}_{n}.parquet", index=False)
            print(f"  saved w_{kind}_{n}.parquet ({len(df)} hours)", flush=True)


if __name__ == "__main__":
    fetch("prev")
    fetch("actual")
    print("WEATHER DONE", flush=True)
