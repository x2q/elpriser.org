#!/usr/bin/env python3
"""Day-ahead prices for the 25 EU zones that have more than one place to read them, from the FIRST source that has a complete day,
into Workers KV: the source-priority layer on top of build_eu_prices.py (Energy-Charts) and build_entsoe_prices.py (ENTSO-E),
plus OMIE for Spain and Portugal. The zones, their order of sources and the rules are in price_sources.py; this file is the
network and the KV.

For each zone it reads the sources in the zone's order, a later one only for the days an earlier one did not deliver complete,
and writes `eu-prices-<zone>` (hourly days, the shape the Worker reads, each day carrying `source`) and `eu-slots-<zone>` (the
15-minute prices of the same days, from the same source). A day that no source has complete is not published, and a day the site
already has is never dropped because a source is late or down: the stored day stays until a source delivers it. Two sources that
both have a cell and differ by more than 0.01 EUR/MWh are logged (never fatal, never changes what is published).

Sources:
    entsoe          the Transparency Platform's A44 through build_entsoe_prices.fetch_a44 (ENTSOE_TOKEN), 15-minute prices
    energy-charts   the Energy-Charts /price API through build_eu_prices.fetch_prices, CC BY 4.0 from Bundesnetzagentur | SMARD.de, 2 requests a minute per IP
    omie            the market operator's marginalpdbc file of each market day (omie_parse.file_url; no key), ES and PT only

Credentials: ENTSOE_TOKEN and the Cloudflare pair, from the environment or ~/.config/elpriser.env. Never logged.

Run (see docs/price-sources.md for the cron lines; this job REPLACES build_eu_prices.py's zones and build_entsoe_prices.py's
15 EU zones, it does not run beside them):
    python3 build_prices.py [--zones de,at] [--date 2026-11-08] [--crosscheck] [--no-gate]
    python3 build_prices.py --dry-run     fetches and parses, prints what it would write, touches no KV, needs only ENTSOE_TOKEN
    python3 build_prices.py --compare     like --dry-run but READS the live KV (GET only, Cloudflare pair needed) and prints how the
                                          would-be payload differs from the stored one: the staging check, never writes

--crosscheck also asks the sources behind the first one for days that are already complete (the cross-check run); a normal run
asks them only for what is missing. --no-gate ignores the "not before 13:45 CET" rule of the rate-limited fallback. --allow-partial
(off) publishes, for a day no source has complete, the best day of at least 12 priced hours: the old jobs' behaviour, the opposite of
the "never a partial day" rule; it exists for a zone whose only source has a hole (2026-11-08: ENTSO-E lacked Latvia's 7 November).
A zone that fails is logged and skipped and the job exits 0 (a missing configuration exits 2, before anything is fetched).
Stdlib only.
"""
import argparse
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import build_eu_prices as B
import build_entsoe_prices as BE
import energy_charts_parse as P
import entsoe_parse as E
import omie_parse as O
import price_sources as S

TZ = {**{z: v[1] for z, v in B.ZONES.items()}, **{z: v[1] for z, v in BE.ALL_ZONES.items()}}
# the ENTSO-E bidding zones of the Energy-Charts zones that build_entsoe_prices.py does not carry (all verified against the API 2026-11-08)
EIC = {**{z: v[0] for z, v in BE.ALL_ZONES.items()},
       "de": "10Y1001A1001A82H", "at": "10YAT-APG------L", "fr": "10YFR-RTE------C", "be": "10YBE----------2", "pl": "10YPL-AREA-----S",
       "cz": "10YCZ-CEPS-----N", "hu": "10YHU-MAVIR----U", "si": "10YSI-ELES-----O", "ch": "10YCH-SWISSGRIDZ", "it-n": "10Y1001A1001A73I"}
PACE = {S.ENTSOE: 2.0, S.EC: B.PAUSE, S.OMIE: 1.0}      # seconds between two requests to the same source
MAX_DIFF_LINES = 5


class Fetcher:
    """The three sources behind one call, with the pauses each one needs and OMIE's per-market-day files read once a run."""

    def __init__(self, entsoe_token, pace=None):
        self.token = entsoe_token
        self.pace = dict(PACE if pace is None else pace)
        self.last = {}
        self.omie_files = {}

    def _wait(self, src):
        gap = self.pace.get(src, 0) - (time.monotonic() - self.last.get(src, -1e9))
        if gap > 0:
            time.sleep(gap)
        self.last[src] = time.monotonic()

    def fetch(self, src, zone, tzname, dates, horizon):
        """The source's slots for the zone over local `dates`: [] when the source has nothing published, an exception when it fails."""
        if src == S.ENTSOE:
            self._wait(src)
            start, end = BE.interval(dates, tzname)
            return E.parse_a44(BE.fetch_a44(self.token, EIC[zone], start, end))
        if src == S.EC:
            self._wait(src)
            body = B.fetch_prices(B.ZONES[zone][0], dates[0], dates[-1])
            self.last[src] = time.monotonic()
            return P.parse_price(body) if body else []
        if src == S.OMIE:
            slots = []
            for md in S.market_dates(dates, tzname, horizon):
                if md not in self.omie_files:
                    self._wait(src)
                    self.omie_files[md] = self._omie_file(md)
                got = self.omie_files[md]
                slots += got[zone] if got else []
            return slots
        raise ValueError(f"unknown source {src}")

    @staticmethod
    def _omie_file(market_date):
        """One market day's parsed file, or None while it is not published (HTTP 404)."""
        try:
            req = urllib.request.Request(O.file_url(market_date), headers={"User-Agent": B.UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return O.parse_marginalpdbc(r.read(), market_date)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise RuntimeError(f"OMIE HTTP {e.code}")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise RuntimeError(f"OMIE unreachable: {type(e).__name__}")


def _summary(payload):
    return ", ".join(f"{d['date']} ({sum(1 for p in d['prices'] if p['eur_mwh'] is not None)} h, {d.get('source', '?')})" for d in payload["days"])


def run_zone(zone, now, fetcher, kv=None, dry=False, crosscheck=False, gate=True, compare=False, allow_partial=False):
    """Read, merge and (unless dry) store one zone. Returns a list of log lines (the first is the zone's status)."""
    tzname = TZ[zone]
    chain = S.CHAINS[zone]
    dates = P.local_dates(now, tzname)
    horizon = S.horizon_end(now)
    key, skey = f"eu-prices-{zone}", f"eu-slots-{zone}"
    reading = kv is not None
    stored = kv_read(kv, key) if reading else None
    notes, results, done = [], [], set()
    for src in chain:
        missing = [d for d in dates if d not in done]
        if not missing and not crosscheck:
            results.append((src, None))
            continue
        if missing and gate and not S.gate_open(src, now, missing, dates):
            notes.append(f"{src} not asked before {S.FALLBACK_AFTER[src]} CET")
            results.append((src, None))
            continue
        try:
            slots = fetcher.fetch(src, zone, tzname, dates, horizon)
        except Exception as e:      # one source down must never take the zone down
            notes.append(f"{src} FAILED ({type(e).__name__}: {e})")
            results.append((src, None))
            continue
        results.append((src, slots or None))
        cm = S.cells(slots)
        done |= {d for d in dates if S.day_complete(cm, d, tzname, horizon)}
    out = S.combine(zone, tzname, dates, results, now, stored, allow_partial)
    lines = []
    payload = out["payload"]
    tail = ("; " + "; ".join(notes)) if notes else ""
    if not payload:
        lines.append(f"{zone}: no complete day from any source (missing {', '.join(out['missing']) or 'none'}){tail}; KV untouched")
    else:
        slot_payload = _slot_payload(zone, tzname, out, payload, now, kv, skey)
        status = _store(zone, key, skey, payload, slot_payload, kv, dry, compare, stored)
        miss = f"; missing {', '.join(out['missing'])}" if out["missing"] else ""
        lines.append(f"{zone}: {_summary(payload)}{miss}{tail}; {status}")
    for d, h, diff, a, b in out["diffs"][:MAX_DIFF_LINES]:
        lines.append(f"{zone}: DIFF {d} h{h:02d} {diff:.2f} EUR/MWh ({a} vs {b})")
    if len(out["diffs"]) > MAX_DIFF_LINES:
        lines.append(f"{zone}: DIFF ... {len(out['diffs']) - MAX_DIFF_LINES} more hours differ")
    return lines


def kv_read(kv, key):
    """The stored value of `key` (None when absent). A read failure is not fatal: the run then has nothing stored to fall back on."""
    try:
        account, token = kv
        return B.kv_get(key, account, token)
    except Exception:
        return None


def _slot_payload(zone, tzname, out, payload, now, kv, skey):
    """eu-slots-<zone> for the published days: the chosen sources' own slots, plus the stored rows of the days kept from the store."""
    rows = list(out["slots"])
    kept = set(out["sources"]) - set(out["fresh"])      # days that stay from the store: their stored 15-minute rows stay too
    if kept and kv is not None:
        old = kv_read(kv, skey)
        tz = ZoneInfo(tzname)
        for r in (old or {}).get("slots", []):
            t = datetime.fromtimestamp(r[0], timezone.utc)
            if t.astimezone(tz).date().isoformat() in kept:
                rows.append((t, r[1], r[2]))
    return P.build_slots_payload(zone, rows, tzname, payload["days"], now.date().isoformat())


def _store(zone, key, skey, payload, slot_payload, kv, dry, compare, stored):
    """Write (or, dry, describe) the hourly payload and its slots. A failure of the slots never undoes the hourly write."""
    n = len(P.canonical(payload))
    ns = f"{len(slot_payload['slots'])} slots" if slot_payload else "no slots"
    if compare:
        return f"compare: {_vs_stored(stored, payload)}; {skey} {ns}"
    if dry:
        return f"would write {key} ({n} bytes), {skey} {ns}"
    account, token = kv
    res = []
    if stored is not None and P.body_hash(stored) == P.body_hash(payload):
        res.append("unchanged, no write")
    else:
        B.kv_put(key, payload, B.KV_TTL, account, token)
        res.append(f"wrote {key} ({n} bytes)")
    if slot_payload:
        try:
            old = B.kv_get(skey, account, token)
            if old is not None and P.body_hash(old) == P.body_hash(slot_payload):
                res.append(f"{skey} unchanged")
            else:
                B.kv_put(skey, slot_payload, B.KV_TTL, account, token)
                res.append(f"wrote {skey} ({len(slot_payload['slots'])} slots)")
        except Exception as e:
            res.append(f"{skey} FAILED ({type(e).__name__}): hourly prices stand")
    return "; ".join(res)


def _vs_stored(stored, payload):
    """How the payload differs from what is in KV, by day: identical prices, other prices (count of hours), new day, dropped day."""
    if stored is None:
        return "nothing stored"
    old = {d["date"]: d for d in stored.get("days", [])}
    new = {d["date"]: d for d in payload["days"]}
    parts = []
    for date in sorted(set(old) | set(new)):
        if date not in new:
            parts.append(f"{date} only stored")
        elif date not in old:
            parts.append(f"{date} NEW ({new[date].get('source')})")
        else:
            a = {p["hour"]: p["eur_mwh"] for p in old[date]["prices"]}
            b = {p["hour"]: p["eur_mwh"] for p in new[date]["prices"]}
            bad = [h for h in range(24) if a.get(h) != b.get(h)]
            parts.append(f"{date} identical" if not bad else f"{date} {len(bad)} h differ (max {max(abs((a.get(h) or 0) - (b.get(h) or 0)) for h in bad):.2f})")
    return ", ".join(parts)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="fetch and parse, write nothing (reads no KV)")
    ap.add_argument("--compare", action="store_true", help="like --dry-run, but read the live KV (GET only) and print the differences to it")
    ap.add_argument("--zones", help="comma-separated subset (default: all)")
    ap.add_argument("--date", help="act as if it were this UTC date, 12:00 (default: now)")
    ap.add_argument("--crosscheck", action="store_true", help="also ask the later sources for days that are already complete, to log disagreements")
    ap.add_argument("--allow-partial", action="store_true", help="when no source has a day complete, publish the best day of at least 12 priced hours (the old jobs' rule) instead of no day")
    ap.add_argument("--no-gate", action="store_true", help="ignore the 'not before 13:45 CET' rule of the rate-limited fallback")
    a = ap.parse_args(argv)
    B.load_env_file()
    token = os.environ.get("ENTSOE_TOKEN")
    account, cf_token = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    dry = a.dry_run or a.compare
    need = [("ENTSOE_TOKEN", token)] + ([] if (a.dry_run and not a.compare) else [("CLOUDFLARE_ACCOUNT_ID", account), ("CLOUDFLARE_API_TOKEN", cf_token)])
    missing = [n for n, v in need if not v]
    if missing:
        B.log("missing environment: " + ", ".join(missing))
        return 2
    zones = a.zones.split(",") if a.zones else list(S.CHAINS)
    unknown = [z for z in zones if z not in S.CHAINS]
    if unknown:
        B.log("unknown zone(s): " + ", ".join(unknown) + " (known: " + ", ".join(S.CHAINS) + ")")
        return 2
    now = (datetime.fromisoformat(a.date).replace(hour=12, tzinfo=timezone.utc) if a.date else datetime.now(timezone.utc))
    mode = " (compare: reads KV, writes nothing)" if a.compare else " (dry run)" if a.dry_run else ""
    B.log(f"=== prices {now:%Y-%m-%d %H:%M}Z{mode}{' crosscheck' if a.crosscheck else ''} ===")
    fetcher = Fetcher(token)
    kv = (account, cf_token) if (not a.dry_run) else None
    ok = 0
    for z in zones:
        try:
            for line in run_zone(z, now, fetcher, kv, dry, a.crosscheck, not a.no_gate, a.compare, a.allow_partial):
                B.log("  " + line, (token, cf_token))
            ok += 1
        except Exception as e:      # one zone must never stop the others, and the job always exits 0
            B.log(f"  {z}: FAILED (non-fatal): {type(e).__name__}: {e}", (token, cf_token))
    B.log(f"DONE {ok}/{len(zones)} zones")
    return 0


if __name__ == "__main__":
    sys.exit(main())
