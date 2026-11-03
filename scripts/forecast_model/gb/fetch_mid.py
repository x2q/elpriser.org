#!/usr/bin/env python3
"""Great Britain's Elexon Market Index Price (MID) as an hourly history, cached in one parquet: price_gb.parquet (t = the hour on the London wall clock,
naive; eur_mwh = GBP/MWh - the column keeps the EU code's name, the unit is pounds).

The hours are exactly those the live job writes to KV `eu-prices-gb` (scripts/eu_prices/elexon_parse.py: the volume-weighted half-hour price, an
hour counts only when all its half hours are priced, hourly mean, London clock), so the model is trained on the number the page shows.

Elexon allows at most 7 days per request; this pulls 6 local days per request with a pause (a few hundred requests for four years, once). A later run
re-pulls only the last REFRESH_DAYS and merges. Licence: Contains BMRS data (c) Elexon Limited copyright and database right 2026 - the history is a
training input; nothing here is published except the model's own estimate.

    python3 fetch_mid.py [--since 2023-01-01]
"""
import argparse
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
for p in (DIR, os.path.join(DIR, "..", "..", "eu_prices"), os.path.join(DIR, "..", "eu")):    # repo layout; flat on the Spark
    sys.path.insert(0, p)
import elexon_parse as X                       # noqa: E402
import build_elexon_prices as BE               # noqa: E402

TZ = "Europe/London"
START = date(2023, 1, 1)
CHUNK_DAYS = 6
REFRESH_DAYS = 10
PAUSE = 1.0
DATA = os.environ.get("GB_DATA_DIR", DIR)               # where the caches live (the Spark: the job's own directory)
PATH = os.path.join(DATA, "price_gb.parquet")


def pull(since, until):
    """Hourly Series (naive London clock) for the local days since..until inclusive."""
    rows, cur = {}, since
    while cur <= until:
        end = min(cur + timedelta(days=CHUNK_DAYS - 1), until)
        dates = [(cur + timedelta(days=i)).isoformat() for i in range((end - cur).days + 1)]
        a, b = BE.interval(dates, TZ)
        slots = X.parse_mid(BE.fetch_mid(a, b))
        for d in X.build_days(slots, TZ, dates, min_hours=1):
            for p in d["prices"]:
                if p["eur_mwh"] is not None:
                    rows[pd.Timestamp(d["date"]) + pd.Timedelta(hours=p["hour"])] = p["eur_mwh"]
        cur = end + timedelta(days=1)
        time.sleep(PAUSE)
    return pd.Series(rows, dtype=float).sort_index()


def update(out=PATH, today=None, start=START, refresh=REFRESH_DAYS):
    """Create or top up the cache; returns the hourly Series."""
    today = today or datetime.now(timezone.utc).date()
    if os.path.exists(out):
        old = pd.read_parquet(out)
        old = old.set_index(pd.to_datetime(old["t"]))["eur_mwh"]
        since = max(old.index.max().date() - timedelta(days=refresh), start)
        new = pull(since, today)
        merged = pd.concat([old[old.index < pd.Timestamp(since)], new])
    else:
        merged = pull(start, today)
    merged = merged[~merged.index.duplicated(keep="last")].sort_index()
    merged.rename("eur_mwh").rename_axis("t").reset_index().to_parquet(out, index=False)
    return merged


def load(path=PATH):
    df = pd.read_parquet(path)
    s = df.set_index(pd.to_datetime(df["t"]))["eur_mwh"].sort_index()
    return s[~s.index.duplicated(keep="last")]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default=START.isoformat())
    a = ap.parse_args()
    s = update(start=date.fromisoformat(a.since))
    print(f"gb: {len(s):,} hours, {s.index.min():%Y-%m-%d} -> {s.index.max():%Y-%m-%d}, mean {s.mean():.1f} GBP/MWh", flush=True)
