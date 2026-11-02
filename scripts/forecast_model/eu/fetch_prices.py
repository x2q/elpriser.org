#!/usr/bin/env python3
"""Day-ahead price HISTORY for the EU zones from the ENTSO-E Transparency Platform (A44), cached as one parquet per
zone: hourly means by the zone's own wall clock (naive local timestamps, like the Nordic dataset's).

Why ENTSO-E for all 25 zones, also those the site shows from Energy-Charts: one source and one definition of an hour for
the whole training set. Nothing is published from this data - the forecast is.

The first run pulls history from START in 90-day requests (one zone, one request at a time, a pause between); later runs
re-pull only the last REFRESH_DAYS and merge, so a price that is revised is picked up. The token is read from the
environment (~/.config/elpriser.env) when a request is made, never logged and never part of a printed URL.
"""
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
sys.path.insert(0, os.path.join(DIR, "..", "..", "eu_prices"))     # in the repo; flat next to this file on Spark
import entsoe_parse as E                                           # noqa: E402
from zones import ZONES                                            # noqa: E402

SOURCE = "https://web-api.tp.entsoe.eu/api"
START = date(2024, 1, 1)
CHUNK_DAYS = 90
REFRESH_DAYS = 10
PAUSE = 1.5
UA = "elpriser.org/1.0 (+https://elpriser.org; hello@elpriser.org)"


def token():
    t = os.environ.get("ENTSOE_TOKEN")
    if not t:
        raise RuntimeError("ENTSOE_TOKEN is not set - source ~/.config/elpriser.env")
    return t


def fetch_a44(eic, start, end, tries=4):
    """The A44 XML for [start, end) UTC midnights. Errors never carry the URL (it holds the token)."""
    url = SOURCE + "?" + urllib.parse.urlencode({
        "securityToken": token(), "documentType": "A44", "in_Domain": eic, "out_Domain": eic,
        "periodStart": start.strftime("%Y%m%d0000"), "periodEnd": end.strftime("%Y%m%d0000")})
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/xml"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code == 429:
                time.sleep(min(int(e.headers.get("Retry-After", "30") or 30), 120) + 1)
            elif e.code in (400, 401, 403):
                raise RuntimeError(f"ENTSO-E {last}")
            else:
                time.sleep(10 * (attempt + 1))
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = type(e).__name__
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"ENTSO-E failed after {tries} tries ({last})")


def hourly_local(slots, tzname):
    """[(start_utc, minutes, price)] -> Series of hourly means on a naive LOCAL clock (duplicate autumn hour averaged,
    the missing spring hour absent). 15-minute prices are averaged into their hour."""
    if not slots:
        return pd.Series(dtype=float)
    rows = []
    for start, minutes, price in slots:
        for i in range(max(minutes // 15, 1)):
            rows.append((start + timedelta(minutes=15 * i), price))
    df = pd.DataFrame(rows, columns=["t", "p"])
    df["t"] = pd.to_datetime(df.t, utc=True).dt.tz_convert(tzname).dt.tz_localize(None).dt.floor("h")
    return df.groupby("t").p.mean().sort_index()


def pull_zone(zone, since, until):
    eic, tzname, _ = ZONES[zone]
    slots, cur = [], since
    while cur < until:
        nxt = min(cur + timedelta(days=CHUNK_DAYS), until)
        slots += E.parse_a44(fetch_a44(eic, cur, nxt))
        cur = nxt
        time.sleep(PAUSE)
    return hourly_local(slots, tzname)


def update(zone, out_dir=DIR, today=None):
    """Create or top up price_<zone>.parquet; returns the Series."""
    today = today or datetime.now(timezone.utc).date()
    until = today + timedelta(days=2)             # tomorrow's auction is published ~13:00 CET
    path = os.path.join(out_dir, f"price_{zone}.parquet")
    if os.path.exists(path):
        old = pd.read_parquet(path)
        old = old.set_index(pd.to_datetime(old["t"]))["eur_mwh"]
        since = max(old.index.max().date() - timedelta(days=REFRESH_DAYS), START)
        new = pull_zone(zone, since, until)
        merged = pd.concat([old[old.index < pd.Timestamp(since)], new]).sort_index()
        merged = merged[~merged.index.duplicated(keep="last")]
    else:
        merged = pull_zone(zone, START, until)
    merged.rename("eur_mwh").rename_axis("t").reset_index().to_parquet(path, index=False)
    return merged


def main(argv=None):
    zones = (argv or sys.argv[1:]) or list(ZONES)
    for z in zones:
        try:
            s = update(z)
            print(f"{z}: {len(s):,} hours, {s.index.min():%Y-%m-%d} -> {s.index.max():%Y-%m-%d}, "
                  f"mean {s.mean():.1f} EUR/MWh", flush=True)
        except Exception as e:               # one zone must not stop the others
            print(f"{z}: FAILED {e}", flush=True)


if __name__ == "__main__":
    main()
