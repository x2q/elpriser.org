#!/usr/bin/env python3
"""Measures WHEN each source first carries tomorrow's complete day-ahead prices: the number the source order of price_sources.py rests on.

A poller, not a job: every --every seconds, inside the daily windows below, it asks each (zone, source) pair it is given for the zone's
tomorrow and appends one JSON line to --out the FIRST time that pair has the day complete (price_sources.day_complete). Nothing else is
written, no KV is touched. Run it from the staging directory, never from cron:
    nohup python3 measure_first_seen.py --out first_seen.jsonl --until 2026-11-10T00:00 > first_seen.out 2>&1 &
Read it with:   python3 measure_first_seen.py --report first_seen.jsonl

Windows (UTC): the auction results are out ~12:45 CET, so 10:30-15:30 covers summer (10:45 UTC) and winter (11:45 UTC) with margin. --now-window
adds one more window starting at the launch time (to catch a day that is still being published when the poller starts).
Requests: ENTSO-E 1 request per zone per round (the platform allows 400 a minute), OMIE 1 per round (a small static file), Energy-Charts
at most EC_ZONES, one request per zone per round, 35 s apart, and NEVER between :58 and :10 of the hours the production jobs run (11:30, 14:00,
16:00, 18:00, 22:00 UTC), because they share the Spark's IP and the API allows 2 requests a minute. Nord Pool is not asked: its terms forbid
automatic extraction (docs/price-sources.md).
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import build_eu_prices as B
import build_prices as J
import energy_charts_parse as P
import price_sources as S

ENTSOE_ZONES = ["de", "at", "fr", "be", "nl", "pl", "cz", "hu", "si", "ch", "it-n", "es", "pt", "gr", "ro"]
EC_ZONES = ["de", "it-n", "ch"]
OMIE_ZONES = ["es", "pt"]
WINDOW = ((10, 30), (15, 30))
PRODUCTION_EC = [(11, 30), (14, 0), (16, 0), (18, 0), (22, 0)]       # UTC; the job takes about six minutes from here


def in_window(now, start_extra=None):
    hm = (now.hour, now.minute)
    return (WINDOW[0] <= hm <= WINDOW[1]) or (start_extra is not None and start_extra <= now <= start_extra + timedelta(hours=6))


def ec_blocked(now):
    t = now.hour * 60 + now.minute
    return any(h * 60 + m - 2 <= t <= h * 60 + m + 10 for h, m in PRODUCTION_EC)


def report(path):
    first = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            r = json.loads(line)
            first[(r["zone"], r["date"], r["source"])] = ("<=" if r.get("first_round") else "") + r["seen_utc"]
    zones = sorted({(z, d) for z, d, _ in first})
    for z, d in zones:
        row = {s: first.get((z, d, s), "-") for s in (S.ENTSOE, S.EC, S.OMIE)}
        print(f"{z:5} {d}  " + "  ".join(f"{s}={v[:2] + v[13:18] + 'Z' if v.startswith('<=') else v[11:16] + 'Z' if v != '-' else '-'}" for s, v in row.items()))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default="first_seen.jsonl")
    ap.add_argument("--every", type=int, default=300, help="seconds between rounds (default %(default)s)")
    ap.add_argument("--until", help="stop at this UTC time, ISO (default: 36 hours from now)")
    ap.add_argument("--now-window", action="store_true", help="also poll for 6 hours from the launch, whatever the time of day")
    ap.add_argument("--report", metavar="FILE", help="print the first-seen table of a result file and exit")
    a = ap.parse_args(argv)
    if a.report:
        return report(a.report)
    B.load_env_file()
    token = os.environ.get("ENTSOE_TOKEN")
    if not token:
        print("missing environment: ENTSOE_TOKEN")
        return 2
    start = datetime.now(timezone.utc)
    until = datetime.fromisoformat(a.until).replace(tzinfo=timezone.utc) if a.until else start + timedelta(hours=36)
    seen = set()
    if os.path.exists(a.out):
        with open(a.out, encoding="utf-8") as fh:
            for line in fh:
                r = json.loads(line)
                seen.add((r["zone"], r["date"], r["source"]))
    f = J.Fetcher(token)
    print(f"measure_first_seen from {start:%Y-%m-%d %H:%M}Z until {until:%Y-%m-%d %H:%M}Z every {a.every}s -> {a.out}", flush=True)
    rounds = 0
    while datetime.now(timezone.utc) < until:
        now = datetime.now(timezone.utc)
        if not in_window(now, start if a.now_window else None):
            time.sleep(60)
            continue
        horizon = S.horizon_end(now)
        f.omie_files = {}
        asks = [(z, S.ENTSOE) for z in ENTSOE_ZONES] + [(z, S.OMIE) for z in OMIE_ZONES] + ([] if ec_blocked(now) else [(z, S.EC) for z in EC_ZONES])
        for zone, src in asks:
            tz = J.TZ[zone]
            dates = P.local_dates(now, tz)
            tomorrow = dates[-1]
            if (zone, tomorrow, src) in seen:
                continue
            try:
                slots = f.fetch(src, zone, tz, [tomorrow], horizon)
            except Exception as e:
                print(f"{now:%H:%M}Z {zone} {src}: {type(e).__name__}: {e}", flush=True)
                continue
            if S.day_complete(S.cells(slots), tomorrow, tz, horizon):
                rec = {"seen_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "zone": zone, "date": tomorrow, "source": src}
                if rounds == 0:
                    rec["first_round"] = True       # already there when the poller started: the time is an upper bound, not a first sighting
                seen.add((zone, tomorrow, src))
                with open(a.out, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps(rec) + "\n")
                print(json.dumps(rec), flush=True)
        rounds += 1
        time.sleep(max(1, a.every - (datetime.now(timezone.utc) - now).total_seconds()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
