#!/usr/bin/env python3
"""Great Britain's electricity price from the Elexon BMRS Market Index Data (MID) into Workers KV `eu-prices-gb`, next to
build_eu_prices.py / build_entsoe_prices.py and in the same shape, but in GBP/MWh (payload `unit` "GBP/MWh").

THIS IS THE WITHIN-DAY MARKET INDEX PRICE, NOT THE DAY-AHEAD AUCTION PRICE (which is not free for Great Britain). It is
labelled that way everywhere on the site; see elexon_parse.py for exactly what it is. Actual prices only, no forecast, and no
tomorrow: a half hour's index exists only once that half hour has traded. Yesterday and today are kept, hours by the London
clock, only hours whose two half hours are both priced.

ONE request per run to https://data.elexon.co.uk/bmrs/api/v1/balancing/pricing/market-index (no API key). Elexon's terms ask
not to invoke the API more than once per half hour for the same data; this job runs once an hour.

Licence: BMRS data, Elexon Limited, free for any use with the attribution "Contains BMRS data (c) Elexon Limited copyright and
database right <year>." (https://www.elexon.co.uk/bsc/data/balancing-mechanism-reporting-agent/copyright-licence-bmrs-data/).
The hourly means are a change of the data, which every page that shows them says.

Cron (UTC; a half hour is in the index about when it starts, so :07 sees the hour that just ended):
    7 * * * *  cd ~/elpriser-eu && python3 build_elexon_prices.py >> elexon_prices.log 2>&1
Environment (or ~/.config/elpriser.env): CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN. Elexon needs no key.

Dry run (fetches and parses, prints what it would write, touches no KV and needs no credentials):
    python3 build_elexon_prices.py --dry-run [--date 2026-10-26]

A failing run is logged and the job still exits 0 (a missing configuration exits 2, before anything is fetched). A KV write is
skipped when the stored body is identical. KV keys live 3 days: if the job stops, the page goes empty rather than show old
prices. Stdlib only.
"""
import argparse
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import build_eu_prices as B
import elexon_parse as X
import energy_charts_parse as P

SOURCE = "https://data.elexon.co.uk/bmrs/api/v1/balancing/pricing/market-index"
MAX_RETRY_WAIT = 120

# zone key (the /api/nordic `zone` value) -> the zone's wall clock. Great Britain only: Northern Ireland is part of the SEM
# (zone `ie`, build_semopx_prices.py).
ZONES = {
    "gb":  ("Europe/London",),
}


def interval(dates, tzname):
    """(from, to) as RFC 3339 UTC: local midnight of the first date to local midnight after the last."""
    tz = ZoneInfo(tzname)
    a = datetime.fromisoformat(dates[0]).replace(tzinfo=tz)
    b = (datetime.fromisoformat(dates[-1]) + timedelta(days=1)).replace(tzinfo=tz)
    f = lambda d: d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    return f(a), f(b)


def fetch_mid(start, end):
    """The MID response text for [start, end] (RFC 3339). A 429 is waited out once with Retry-After; anything else raises."""
    url = SOURCE + "?" + urllib.parse.urlencode({"from": start, "to": end, "format": "json"})
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": B.UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt == 0:
                try:
                    wait = int(e.headers.get("Retry-After", "30"))
                except (TypeError, ValueError):
                    wait = 30
                if wait > MAX_RETRY_WAIT:
                    raise RuntimeError(f"Elexon HTTP 429, Retry-After {wait} s (too long to wait)")
                time.sleep(wait + 1)
                continue
            raise RuntimeError(f"Elexon HTTP {e.code}")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise RuntimeError(f"Elexon unreachable: {type(e).__name__}")
    raise RuntimeError("Elexon: out of retries")


def run_zone(zone, now, kv=None, dry=False):
    """Fetch, parse and (unless dry) store the zone. Returns a one-line status."""
    (tzname,) = ZONES[zone]
    # Yesterday and today only: the index of tomorrow does not exist.
    dates = P.local_dates(now, tzname)[:2]
    start, end = interval(dates, tzname)
    payload = X.build_payload(zone, fetch_mid(start, end), tzname, dates, now.date().isoformat())
    if not payload["days"]:
        return f"{zone}: no prices (no complete hour for {dates[0]}..{dates[-1]}); KV untouched"
    summary = ", ".join(f"{d['date']} ({sum(1 for p in d['prices'] if p['eur_mwh'] is not None)} h)" for d in payload["days"])
    key = f"eu-prices-{zone}"
    if dry:
        last = max(((d["date"], p["hour"], p["eur_mwh"]) for d in payload["days"] for p in d["prices"] if p["eur_mwh"] is not None))
        return (f"{zone}: {summary}; latest complete hour {last[0]} {last[1]:02d}:00 = {last[2]} GBP/MWh; "
                f"would write {key} ({len(P.canonical(payload))} bytes, unit {payload['unit']})")
    account, cf_token = kv
    stored = B.kv_get(key, account, cf_token)
    if stored is not None and P.body_hash(stored) == P.body_hash(payload):
        return f"{zone}: {summary}; unchanged, no write"
    B.kv_put(key, payload, B.KV_TTL, account, cf_token)
    return f"{zone}: {summary}; wrote {key} ({len(P.canonical(payload))} bytes)"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="fetch and parse, write nothing")
    ap.add_argument("--date", help="act as if it were this UTC date, 12:00 (default: now)")
    a = ap.parse_args(argv)
    B.load_env_file()
    account, cf_token = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    missing = [] if a.dry_run else [n for n, v in (("CLOUDFLARE_ACCOUNT_ID", account), ("CLOUDFLARE_API_TOKEN", cf_token)) if not v]
    if missing:
        B.log("missing environment: " + ", ".join(missing))
        return 2
    now = (datetime.fromisoformat(a.date).replace(hour=12, tzinfo=timezone.utc) if a.date else datetime.now(timezone.utc))
    B.log(f"=== elexon prices {now:%Y-%m-%d %H:%M}Z{' (dry run)' if a.dry_run else ''} ===")
    ok = 0
    for z in ZONES:
        try:
            B.log("  " + run_zone(z, now, None if a.dry_run else (account, cf_token), a.dry_run), (cf_token,))
            ok += 1
        except Exception as e:      # the job always exits 0
            B.log(f"  {z}: FAILED (non-fatal): {e}", (cf_token,))
    B.log(f"DONE {ok}/{len(ZONES)} zones")
    return 0


if __name__ == "__main__":
    sys.exit(main())
