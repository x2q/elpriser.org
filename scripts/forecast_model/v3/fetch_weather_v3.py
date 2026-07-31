#!/usr/bin/env python3
"""v3 weather fetch: multi-point spatial coverage + neighbouring bidding zones.

Fixes two v2 limitations at once:
  - "single representative coordinate per area": DK1/DK2/DE now use several
    points each, chosen to sit near where the generation actually is (offshore
    wind farms, southern German solar belt), later combined with fixed weights.
  - "interconnector congestion not modelled": congestion is driven by price
    spreads to neighbours, and those spreads are driven by *their* weather.
    NO2/SE3/SE4/NL are fetched at the same forecast leads as DK, so the model
    sees the pressure building days ahead — unlike JAO/ENTSO-E congestion
    figures which only exist ~1 day out.

Open-Meteo accepts comma-separated coordinates and returns a list, so all
points for a variable set come back in one request.
"""
import json, os, time, urllib.request
from datetime import date, timedelta

import pandas as pd

OUT = os.path.dirname(os.path.abspath(__file__))
PREV_START, ARCH_START, END = "2024-03-15", "2022-01-01", "2026-07-30"

# name -> (lat, lon). Grouped so each group is one API call.
POINTS = {
    # DK1 (West): inland Jutland + the two big offshore clusters + south Jutland
    "dk1_inland":   (56.0, 9.5),
    "dk1_hornsrev": (55.5, 7.8),
    "dk1_anholt":   (56.6, 11.2),
    "dk1_south":    (55.3, 9.2),
    # DK2 (East): Zealand + Rødsand offshore + north Zealand
    "dk2_zealand":  (55.5, 12.0),
    "dk2_rodsand":  (54.55, 11.7),
    "dk2_north":    (56.0, 12.3),
    # DE-LU: wind is northern, solar is southern — one point cannot represent both
    "de_north":     (54.0, 9.5),
    "de_central":   (51.5, 10.0),
    "de_south":     (48.5, 11.0),
    # Neighbouring bidding zones (congestion drivers)
    "no2":          (58.5, 7.0),
    "se3":          (59.3, 17.0),
    "se4":          (56.0, 14.0),
    "nl":           (52.5, 5.0),
}

GROUPS = [
    ["dk1_inland", "dk1_hornsrev", "dk1_anholt", "dk1_south"],
    ["dk2_zealand", "dk2_rodsand", "dk2_north"],
    ["de_north", "de_central", "de_south"],
    ["no2", "se3", "se4", "nl"],
]

PREV_VARS = [f"{v}_previous_day{d}"
             for v in ("wind_speed_100m", "direct_radiation", "temperature_2m")
             for d in range(1, 8)]
ARCH_VARS = ["wind_speed_100m", "direct_radiation", "temperature_2m"]


def get(url, tries=6):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
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


def fetch(kind):
    base = ("https://previous-runs-api.open-meteo.com/v1/forecast" if kind == "prev"
            else "https://archive-api.open-meteo.com/v1/archive")
    hourly = ",".join(PREV_VARS if kind == "prev" else ARCH_VARS)
    start = PREV_START if kind == "prev" else ARCH_START

    for group in GROUPS:
        missing = [n for n in group if not os.path.exists(f"{OUT}/w_{kind}_{n}.parquet")]
        if not missing:
            print(f"{kind} {group}: cached", flush=True)
            continue
        lats = ",".join(str(POINTS[n][0]) for n in group)
        lons = ",".join(str(POINTS[n][1]) for n in group)
        frames = {n: [] for n in group}
        for s, e in chunks(start, END):
            print(f"{kind} {group[0]}..{group[-1]} {s}..{e}", flush=True)
            u = (f"{base}?latitude={lats}&longitude={lons}&hourly={hourly}"
                 f"&start_date={s}&end_date={e}&timezone=Europe/Copenhagen")
            res = get(u)
            if not isinstance(res, list):
                res = [res]
            for name, loc in zip(group, res):
                frames[name].append(pd.DataFrame(loc.get("hourly", {})))
            time.sleep(10)
        for name in group:
            df = pd.concat(frames[name]).drop_duplicates("time")
            df.to_parquet(f"{OUT}/w_{kind}_{name}.parquet", index=False)
            print(f"  saved w_{kind}_{name}.parquet ({len(df)} hours)", flush=True)


if __name__ == "__main__":
    fetch("prev")
    fetch("actual")
    print("WEATHER DONE", flush=True)
