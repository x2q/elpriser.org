#!/usr/bin/env python3
"""Ireland's day-ahead price (the all-island Single Electricity Market, zone `ie`) from the SEMOpx day-ahead auction results
into Workers KV `eu-prices-ie`, next to build_eu_prices.py / build_entsoe_prices.py and in the same shape (EUR/MWh, hourly means
by the Dublin clock, actual prices only). Replaces the ENTSO-E source of `ie`: the zone is no longer in build_entsoe_prices.py.

Per run: ONE listing request and one small JSON document per delivery day (yesterday, today, tomorrow once published: about
three to four requests, a second apart); semopx_parse.py explains the API. The auction closes at 12:00 CET and the result is on the
site at about 12:55 CET: tomorrow is absent until then.

Cron (UTC; the result appears about 11:55 UTC in winter and 10:55 UTC in summer, so 12:20 catches both, 14:20 is the retry):
    20 12 * * *  cd ~/elpriser-eu && python3 build_semopx_prices.py >> semopx_prices.log 2>&1
    20 14 * * *  cd ~/elpriser-eu && python3 build_semopx_prices.py >> semopx_prices.log 2>&1
Environment (or ~/.config/elpriser.env): CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN. SEMOpx needs no key.

Dry run (fetches and parses, prints what it would write, touches no KV and needs no credentials):
    python3 build_semopx_prices.py --dry-run [--date 2026-10-26]

A failing run is logged and the job still exits 0 (a missing configuration exits 2, before anything is fetched). A KV write is
skipped when the stored body is identical. KV keys live 3 days. Stdlib only.
"""
import argparse
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import build_eu_prices as B
import energy_charts_parse as P
import semopx_parse as S

API = "https://reports.semopx.com/api/v1/documents"
PAUSE = 1                  # seconds between two requests
MAX_RETRY_WAIT = 120

# zone key (the /api/nordic `zone` value) -> the zone's wall clock. The all-island SEM: Ireland and Northern Ireland.
ZONES = {
    "ie":  ("Europe/Dublin",),
}


def _get(url):
    """The response text of one GET. A 429 is waited out once with Retry-After; anything else raises."""
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
                    raise RuntimeError(f"SEMOpx HTTP 429, Retry-After {wait} s (too long to wait)")
                time.sleep(wait + 1)
                continue
            raise RuntimeError(f"SEMOpx HTTP {e.code}")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise RuntimeError(f"SEMOpx unreachable: {type(e).__name__}")
    raise RuntimeError("SEMOpx: out of retries")


def fetch_listing(page_size=12):
    """The newest DAM result files, as the website's own page asks for them (ExcludeDelayedPublication=0)."""
    return _get(f"{API}/static-reports?" + urllib.parse.urlencode({
        "DPuG_ID": "EA-001", "ResourceName": S.LIST_NAME, "ExcludeDelayedPublication": 0,
        "sort_by": "Date", "order_by": "DESC", "page_size": page_size}))


def fetch_document(doc_id):
    return _get(f"{API}/{urllib.parse.quote(doc_id)}")


def run_zone(zone, now, kv=None, dry=False, pause=PAUSE):
    """Fetch, parse and (unless dry) store the zone. Returns a one-line status."""
    (tzname,) = ZONES[zone]
    dates = P.local_dates(now, tzname)
    # Dublin day D takes its hours 0-22 from the file delivered on D and its hour 23 from the file of D+1; the file of the day
    # before `yesterday` is never needed (its last half hours are the evening before yesterday's midnight).
    wanted = S.select_documents(S.parse_listing(fetch_listing()), dates[0])
    docs = []
    for i, (delivery, doc_id) in enumerate(wanted):
        if i and pause > 0:
            time.sleep(pause)
        docs.append(fetch_document(doc_id))
    payload = S.build_payload(zone, docs, tzname, dates, now.date().isoformat())
    if not payload["days"]:
        return f"{zone}: no prices (nothing published for {dates[0]}..{dates[-1]}); KV untouched"
    summary = ", ".join(f"{d['date']} ({sum(1 for p in d['prices'] if p['eur_mwh'] is not None)} h)" for d in payload["days"])
    key = f"eu-prices-{zone}"
    if dry:
        return f"{zone}: {summary} from {len(docs)} file(s); would write {key} ({len(P.canonical(payload))} bytes, unit {payload['unit']})"
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
    ap.add_argument("--pause", type=float, default=PAUSE, help="seconds between requests (default %(default)s)")
    a = ap.parse_args(argv)
    B.load_env_file()
    account, cf_token = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    missing = [] if a.dry_run else [n for n, v in (("CLOUDFLARE_ACCOUNT_ID", account), ("CLOUDFLARE_API_TOKEN", cf_token)) if not v]
    if missing:
        B.log("missing environment: " + ", ".join(missing))
        return 2
    now = (datetime.fromisoformat(a.date).replace(hour=12, tzinfo=timezone.utc) if a.date else datetime.now(timezone.utc))
    B.log(f"=== semopx prices {now:%Y-%m-%d %H:%M}Z{' (dry run)' if a.dry_run else ''} ===")
    ok = 0
    for z in ZONES:
        try:
            B.log("  " + run_zone(z, now, None if a.dry_run else (account, cf_token), a.dry_run, a.pause), (cf_token,))
            ok += 1
        except Exception as e:      # the job always exits 0
            B.log(f"  {z}: FAILED (non-fatal): {e}", (cf_token,))
    B.log(f"DONE {ok}/{len(ZONES)} zones")
    return 0


if __name__ == "__main__":
    sys.exit(main())
