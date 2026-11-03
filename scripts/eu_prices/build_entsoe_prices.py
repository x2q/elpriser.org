#!/usr/bin/env python3
"""Day-ahead prices for the bidding zones Energy-Charts does not license to us, from the ENTSO-E Transparency Platform
(documentType A44) into Workers KV, next to build_eu_prices.py and in the same shape.

For each zone: ONE request for yesterday..tomorrow by the zone's own calendar, parsed by entsoe_parse (day-ahead A01
only, A03 blocks expanded, hourly means by the zone's wall clock), written to KV `eu-prices-<zone>` — the key
/api/nordic reads for every EU zone. Actual prices only: no forecast and no model. A day that is not published yet
(tomorrow before ~13:00 CET) is simply absent.

The Netherlands (`nl`, NORDIC_OVERLAY) is run by the same job: its settled days go to `eu-prices-nl` and /api/nordic lays them over
the Nordic model's 9-day forecast (`nordic-forecast-nl`). An extra NL-only line may be added to catch a late publication:
    5,35 12-16 * * *  cd ~/elpriser-eu && python3 build_entsoe_prices.py --zones nl >> entsoe_prices.log 2>&1

Ireland (`ie`) is not here any more: build_semopx_prices.py writes eu-prices-ie from the SEMOpx day-ahead results.

Credentials: ENTSOE_TOKEN (the Transparency Platform's security token) and the Cloudflare pair, from the environment or
~/.config/elpriser.env. The token is never logged or put in a URL that is logged.

Cron (UTC; the auction results appear ~12:45 CET, so 11:35 catches summer and 14:05 catches winter), after the
Energy-Charts job that runs at 11:30 and 14:00:
    35 11 * * *  cd ~/elpriser-eu && python3 build_entsoe_prices.py >> entsoe_prices.log 2>&1
    5 14 * * *   cd ~/elpriser-eu && python3 build_entsoe_prices.py >> entsoe_prices.log 2>&1

Dry run (fetches and parses, prints what it would write, touches no KV and needs only ENTSOE_TOKEN):
    python3 build_entsoe_prices.py --dry-run [--zones es,xk] [--date 2026-10-26]

A zone that fails is logged and skipped and the job still exits 0 (a missing configuration exits 2, before anything is
fetched). A KV write is skipped when the stored body is identical. KV keys live 3 days, as the Energy-Charts zones'.
Stdlib only.
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
import energy_charts_parse as P
import entsoe_parse as E

SOURCE = "https://web-api.tp.entsoe.eu/api"
PAUSE = 2                  # seconds between two zones; the platform allows 400 requests a minute
MAX_RETRY_WAIT = 120

# zone key (the /api/nordic `zone` value) -> (the zone's EIC code, the zone's wall clock). The zones of the
# Energy-Charts job (build_eu_prices.py) are not here: their price data is CC BY 4.0 from SMARD.de.
ZONES = {
    "es":  ("10YES-REE------0",    "Europe/Madrid"),
    "pt":  ("10YPT-REN------W",    "Europe/Lisbon"),
    "sk":  ("10YSK-SEPS-----K",    "Europe/Bratislava"),
    "gr":  ("10YGR-HTSO-----Y",    "Europe/Athens"),
    "ro":  ("10YRO-TEL------P",    "Europe/Bucharest"),
    "bg":  ("10YCA-BULGARIA-R",    "Europe/Sofia"),
    "hr":  ("10YHR-HEP------M",    "Europe/Zagreb"),
    "rs":  ("10YCS-SERBIATSOV",    "Europe/Belgrade"),
    "ee":  ("10Y1001A1001A39I",    "Europe/Tallinn"),
    "lv":  ("10YLV-1001A00074",    "Europe/Riga"),
    "lt":  ("10YLT-1001A0008Q",    "Europe/Vilnius"),
    "me":  ("10YCS-CG-TSO---S",    "Europe/Podgorica"),
    "mk":  ("10YMK-MEPSO----8",    "Europe/Skopje"),
    "al":  ("10YAL-KESH-----5",    "Europe/Tirane"),
    "xk":  ("10Y1001C--00100H",    "Europe/Belgrade"),     # Kosovo: CET/CEST; tzdata has no zone of its own, Europe/Belgrade is the one it lists for XK
}


# A zone whose page is served from the Nordic forecast job's feed (KV `nordic-forecast-<zone>`, scripts/forecast_model/nordic), NOT an
# EU_ZONES zone: /api/nordic overlays these settled days on the 9-day model forecast (overlayNordicSettled). The Nordic job reads
# ENTSO-E once a day at 12:40 UTC and the Netherlands' day-ahead results had not reached ENTSO-E by then, so NL's today/tomorrow
# were served as model forecast although the auction had settled. Same A44 request, same parser, same KV key `eu-prices-<zone>`;
# Amsterdam is on CET/CEST like Copenhagen and Berlin. Kept apart from ZONES on purpose: test-eu-prices.mjs pins ZONES to the API's
# EU_ZONES_ENTSOE (zones that have no nordic-forecast feed).
NORDIC_OVERLAY = {
    "nl":  ("10YNL----------L",    "Europe/Amsterdam"),
}
ALL_ZONES = {**ZONES, **NORDIC_OVERLAY}


def interval(dates, tzname):
    """(periodStart, periodEnd) in the API's UTC format: local midnight of the first date to local midnight after the last."""
    tz = ZoneInfo(tzname)
    a = datetime.fromisoformat(dates[0]).replace(tzinfo=tz)
    b = (datetime.fromisoformat(dates[-1]) + timedelta(days=1)).replace(tzinfo=tz)
    f = lambda d: d.astimezone(timezone.utc).strftime("%Y%m%d%H%M")
    return f(a), f(b)


def fetch_a44(token, eic, start, end):
    """The A44 response text for one zone. A 429 is waited out once with Retry-After; 401/403 and anything else raise."""
    url = SOURCE + "?" + urllib.parse.urlencode({
        "securityToken": token, "documentType": "A44", "in_Domain": eic, "out_Domain": eic,
        "periodStart": start, "periodEnd": end})
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": B.UA, "Accept": "application/xml"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt == 0:
                try:
                    wait = int(e.headers.get("Retry-After", "30"))
                except (TypeError, ValueError):
                    wait = 30
                if wait > MAX_RETRY_WAIT:
                    raise RuntimeError(f"ENTSO-E HTTP 429, Retry-After {wait} s (too long to wait)")
                time.sleep(wait + 1)
                continue
            raise RuntimeError(f"ENTSO-E HTTP {e.code}")     # never the URL: it carries the token
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise RuntimeError(f"ENTSO-E unreachable: {type(e).__name__}")
    raise RuntimeError("ENTSO-E: out of retries")


def run_zone(zone, now, token, kv=None, dry=False):
    """Fetch, parse and (unless dry) store one zone. Returns a one-line status."""
    eic, tzname = ALL_ZONES[zone]
    dates = P.local_dates(now, tzname)
    start, end = interval(dates, tzname)
    payload = E.build_payload(zone, fetch_a44(token, eic, start, end), tzname, dates, now.date().isoformat())
    if not payload["days"]:
        return f"{zone}: no prices (nothing published for {dates[0]}..{dates[-1]}); KV untouched"
    summary = ", ".join(f"{d['date']} ({sum(1 for p in d['prices'] if p['eur_mwh'] is not None)} h)" for d in payload["days"])
    key = f"eu-prices-{zone}"
    if dry:
        return f"{zone}: {summary}; would write {key} ({len(P.canonical(payload))} bytes)"
    account, cf_token = kv
    stored = B.kv_get(key, account, cf_token)
    if stored is not None and P.body_hash(stored) == P.body_hash(payload):
        return f"{zone}: {summary}; unchanged, no write"
    B.kv_put(key, payload, B.KV_TTL, account, cf_token)
    return f"{zone}: {summary}; wrote {key} ({len(P.canonical(payload))} bytes)"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="fetch and parse, write nothing")
    ap.add_argument("--zones", help="comma-separated subset (default: all)")
    ap.add_argument("--date", help="act as if it were this UTC date, 12:00 (default: now)")
    ap.add_argument("--pause", type=float, default=PAUSE, help="seconds between zones (default %(default)s)")
    a = ap.parse_args(argv)
    B.load_env_file()
    token = os.environ.get("ENTSOE_TOKEN")
    account, cf_token = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    need = [("ENTSOE_TOKEN", token)] + ([] if a.dry_run else [("CLOUDFLARE_ACCOUNT_ID", account), ("CLOUDFLARE_API_TOKEN", cf_token)])
    missing = [n for n, v in need if not v]
    if missing:
        B.log("missing environment: " + ", ".join(missing))
        return 2
    zones = a.zones.split(",") if a.zones else list(ALL_ZONES)
    unknown = [z for z in zones if z not in ALL_ZONES]
    if unknown:
        B.log("unknown zone(s): " + ", ".join(unknown) + " (known: " + ", ".join(ALL_ZONES) + ")")
        return 2
    now = (datetime.fromisoformat(a.date).replace(hour=12, tzinfo=timezone.utc) if a.date else datetime.now(timezone.utc))
    B.log(f"=== entsoe prices {now:%Y-%m-%d %H:%M}Z{' (dry run)' if a.dry_run else ''} ===")
    ok = 0
    for i, z in enumerate(zones):
        if i and a.pause > 0:
            time.sleep(a.pause)
        try:
            B.log("  " + run_zone(z, now, token, None if a.dry_run else (account, cf_token), a.dry_run), (token, cf_token))
            ok += 1
        except Exception as e:      # one zone must never stop the others, and the job always exits 0
            B.log(f"  {z}: FAILED (non-fatal): {e}", (token, cf_token))
    B.log(f"DONE {ok}/{len(zones)} zones")
    return 0


if __name__ == "__main__":
    sys.exit(main())
