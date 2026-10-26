#!/usr/bin/env python3
"""Day-ahead prices for Germany, France, Poland and Northern Italy from Energy-Charts (Bundesnetzagentur | SMARD.de,
CC BY 4.0) into Workers KV.

For each zone: GET https://api.energy-charts.info/price for yesterday..tomorrow by the zone's own calendar, hourly means
by the zone's wall clock, and KV `eu-prices-<zone>` shaped like the Nordic feed (`nordic-forecast-<zone>`): the site and
/api/nordic?zone=de|fr|pl|it-n serve it. Actual prices only: there is no forecast and no model, so `trainedThrough`
is null and every day has type 'actual'. A day that is not published yet (tomorrow before ~13:00 CET) is simply absent.

The licence is CC BY 4.0 with the attribution "Bundesnetzagentur | SMARD.de" (and Energy-Charts.info as the source of
the API). The hourly means are a change of the data, so every page that shows them says so (see CHROME_I18N `chg` and the
`note` of PRIS_I18N in index.html).

Rate limit (the API's own docs): /price allows 2 requests a minute per client IP (burst 2) and gets slower under load;
a 429 carries Retry-After. The job makes ONE request per zone per run, 35 s apart, honours Retry-After once, and the
result is cached in KV, so the API sees 8 requests a day. A run takes about two minutes.

Cron (UTC; the auction results appear ~12:45 CET, so 11:30 catches summer and 14:00 catches winter):
    30 11 * * *  cd ~/elpriser-eu && python3 build_eu_prices.py >> eu_prices.log 2>&1
    0 14 * * *   cd ~/elpriser-eu && python3 build_eu_prices.py >> eu_prices.log 2>&1
Environment (or ~/.config/elpriser.env, which is read when present): CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN. The
Energy-Charts API needs no key.

Dry run (fetches and parses, prints what it would write, touches no KV and needs no credentials):
    python3 build_eu_prices.py --dry-run [--zones de,it-n] [--date 2026-10-26]

A zone that fails is logged and skipped and the job still exits 0 (a missing configuration exits 2, before anything is
fetched). A KV write is skipped when the stored body is identical, so the second run of the day costs no write. KV keys
live 3 days: if the job stops, the pages go empty rather than show old prices. Stdlib only (zoneinfo needs the system
tz database).
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import energy_charts_parse as P

KV_NAMESPACE = "126700e66e8d4a19b289b0e8afdaff69"      # the same namespace as scripts/forecast_model/v3/shadow.py
KV_TTL = 3 * 86400
SOURCE = "https://api.energy-charts.info/price"
UA = "elpriser.org/1.0 (+https://elpriser.org; hello@elpriser.org)"
PAUSE = 35                 # seconds between two zones: /price allows 2 a minute
MAX_RETRY_WAIT = 120       # the longest Retry-After we honour

# zone key (the /api/nordic `zone` value) -> (Energy-Charts bzn, the zone's wall clock). Only zones whose price data
# Energy-Charts licenses as CC BY 4.0 (Bundesnetzagentur | SMARD.de) belong here; the others of its list are
# "private and internal use only" and must not be added.
ZONES = {
    "de":   ("DE-LU",    "Europe/Berlin"),
    "fr":   ("FR",       "Europe/Paris"),
    "pl":   ("PL",       "Europe/Warsaw"),
    "it-n": ("IT-North", "Europe/Rome"),
}


def log(msg, secrets=()):
    for s in secrets:
        if s:
            msg = msg.replace(s, "***")
    print(msg, flush=True)


# ─── Cloudflare KV (same REST calls as scripts/forecast_model/v3/shadow.py) ─────────────────────
def load_env_file():
    path = os.path.expanduser("~/.config/elpriser.env")
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))


def _kv_url(key, account):
    return (f"https://api.cloudflare.com/client/v4/accounts/{account}"
            f"/storage/kv/namespaces/{KV_NAMESPACE}/values/{urllib.parse.quote(key)}")


def kv_get(key, account, token):
    req = urllib.request.Request(_kv_url(key, account), headers={"Authorization": f"Bearer {token}", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def kv_put(key, value, ttl, account, token):
    req = urllib.request.Request(f"{_kv_url(key, account)}?expiration_ttl={ttl}",
                                 data=P.canonical(value).encode("utf-8"), method="PUT",
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                                          "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read())
    if not resp.get("success"):
        raise RuntimeError(f"KV put failed for {key}: {resp}")


# ─── Energy-Charts: the ONE place the price source is read ──────────────────────────────────────
def fetch_prices(bzn, start, end):
    """The /price response text for bidding zone `bzn`, local dates start..end (ISO strings; the API reads a date in
    the zone's own timezone, from 00:00 to the last minute of `end`). ONE request; a 429 is waited out once with the
    API's Retry-After; a 404 (nothing published in the range) returns '' ."""
    url = SOURCE + "?" + urllib.parse.urlencode({"bzn": bzn, "start": start, "end": end})
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return ""
            if e.code == 429 and attempt == 0:
                try:
                    wait = int(e.headers.get("Retry-After", "60"))
                except (TypeError, ValueError):
                    wait = 60
                if wait > MAX_RETRY_WAIT:
                    raise RuntimeError(f"Energy-Charts HTTP 429, Retry-After {wait} s (too long to wait)")
                time.sleep(wait + 1)
                continue
            raise RuntimeError(f"Energy-Charts HTTP {e.code}")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise RuntimeError(f"Energy-Charts unreachable: {type(e).__name__}")
    raise RuntimeError("Energy-Charts: out of retries")


# ─── one zone ───────────────────────────────────────────────────────────────────────────────────
def run_zone(zone, now, kv=None, dry=False):
    """Fetch, parse and (unless dry) store one zone. Returns a one-line status."""
    bzn, tzname = ZONES[zone]
    dates = P.local_dates(now, tzname)
    body = fetch_prices(bzn, dates[0], dates[-1])
    payload = P.build_payload(zone, body, tzname, dates, now.date().isoformat()) if body else None
    if not payload or not payload["days"]:
        return f"{zone}: no prices (nothing published for {dates[0]}..{dates[-1]}); KV untouched"
    summary = ", ".join(f"{d['date']} ({sum(1 for p in d['prices'] if p['eur_mwh'] is not None)} h)" for d in payload["days"])
    key = f"eu-prices-{zone}"
    if dry:
        return f"{zone}: {summary}; would write {key} ({len(P.canonical(payload))} bytes); licence: {P.license_info(body)}"
    account, cf_token = kv
    stored = kv_get(key, account, cf_token)
    if stored is not None and P.body_hash(stored) == P.body_hash(payload):
        return f"{zone}: {summary}; unchanged, no write"
    kv_put(key, payload, KV_TTL, account, cf_token)
    return f"{zone}: {summary}; wrote {key} ({len(P.canonical(payload))} bytes)"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="fetch and parse, write nothing")
    ap.add_argument("--zones", help="comma-separated subset (default: all)")
    ap.add_argument("--date", help="act as if it were this UTC date, 12:00 (default: now)")
    ap.add_argument("--pause", type=float, default=PAUSE, help="seconds between zones (default %(default)s; the API allows 2 requests a minute)")
    a = ap.parse_args(argv)
    load_env_file()
    account, cf_token = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    missing = [] if a.dry_run else [n for n, v in (("CLOUDFLARE_ACCOUNT_ID", account), ("CLOUDFLARE_API_TOKEN", cf_token)) if not v]
    if missing:
        log("missing environment: " + ", ".join(missing))
        return 2
    zones = a.zones.split(",") if a.zones else list(ZONES)
    unknown = [z for z in zones if z not in ZONES]
    if unknown:
        log("unknown zone(s): " + ", ".join(unknown) + " (known: " + ", ".join(ZONES) + ")")
        return 2
    now = (datetime.fromisoformat(a.date).replace(hour=12, tzinfo=timezone.utc) if a.date
           else datetime.now(timezone.utc))
    log(f"=== eu prices {now:%Y-%m-%d %H:%M}Z{' (dry run)' if a.dry_run else ''} ===")
    ok = 0
    for i, z in enumerate(zones):
        if i and a.pause > 0:
            time.sleep(a.pause)
        try:
            log("  " + run_zone(z, now, None if a.dry_run else (account, cf_token), a.dry_run), (cf_token,))
            ok += 1
        except Exception as e:      # one zone must never stop the others, and the job always exits 0
            log(f"  {z}: FAILED (non-fatal): {e}", (cf_token,))
    log(f"DONE {ok}/{len(zones)} zones")
    return 0


if __name__ == "__main__":
    sys.exit(main())
