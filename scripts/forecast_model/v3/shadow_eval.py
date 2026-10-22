#!/usr/bin/env python3
"""Score the shadow correction against the real v3 forecast on settled prices.

For every archived run that has a shadow twin, compares the two on the hours where
a correction was actually applied (horizon with at least MIN_DAYS of history), per
horizon and per ISO week, and prints the decision rule from shadow.py's plan:

  adopt only if the shadow has the lower MAE at EVERY horizon D+2..D+7 and in at
  least 3 of the last 4 full weeks. Otherwise drop it.

  python3 shadow_eval.py [--from 2026-10-06]
"""
import argparse
import collections
import sys
from datetime import datetime, timedelta, timezone

import shadow as S


def collect(area, start, account, token):
    runs, shadows = [], {}
    d = start
    today = datetime.now(timezone.utc).date()
    while d <= today:
        r = S.kv_get(S.archive_key(area, d), account, token)
        if r:
            runs.append(r)
        s = S.kv_get(S.shadow_key(area, d), account, token)
        if s:
            shadows[d] = s
        d += timedelta(days=1)
    return runs, shadows


def score(runs, shadows):
    actual = S.settled(runs)
    rows = []   # (week, h, base_err, shadow_err)
    for d, sh in shadows.items():
        base = next((r for r in runs if r["generated"] == d.isoformat()), None)
        if base is None:
            continue
        bdays = {x["date"]: x for x in base["days"]}
        corr = sh["shadow"]["corrections"]
        for day in sh["days"]:
            if day["type"] != "forecast" or day["date"] not in bdays:
                continue
            t = S._d(day["date"])
            h = (t - d).days
            c = corr.get(str(h))
            if not c or c["n"] < S.MIN_DAYS or t not in actual:
                continue
            b = S.hours_of(bdays[day["date"]])
            s = S.hours_of(day)
            for hr, a in actual[t].items():
                if hr in b and hr in s:
                    rows.append((t.isocalendar()[:2], h, b[hr] - a, s[hr] - a))
    return rows


def report(area, rows):
    print(f"\n== {area}: {len(rows)} scored hours")
    if not rows:
        return None
    by_h = collections.defaultdict(list)
    by_w = collections.defaultdict(list)
    for w, h, be, se in rows:
        by_h[h].append((be, se))
        by_w[w].append((be, se))

    def line(label, v):
        n = len(v)
        mb = sum(abs(b) for b, _ in v) / n
        ms = sum(abs(s) for _, s in v) / n
        print(f"  {label:<10} n={n:<5} MAE prod {mb:6.0f}  shadow {ms:6.0f}  ({100 * (ms / mb - 1):+5.1f} %)"
              f"   bias prod {sum(b for b, _ in v) / n:6.0f}  shadow {sum(s for _, s in v) / n:6.0f}")
        return ms < mb

    print(" by horizon")
    wins_h = [line(f"D+{h}", by_h[h]) for h in sorted(by_h)]
    print(" by ISO week")
    weeks = sorted(by_w)
    wins_w = [line(f"{y}-W{wk:02d}", by_w[(y, wk)]) for y, wk in weeks]
    full = wins_w[-4:]
    horizons = set(by_h)
    ok = all(wins_h) and len(full) >= 3 and sum(full) >= 3
    if len(weeks) < 4 or horizons != set(S.HORIZONS):
        verdict = "TOO EARLY (needs 4 weeks of data and all of D+2..D+7)"
    else:
        verdict = "ADOPT" if ok else "DROP"
    print(f" rule: lower MAE at every horizon ({sum(wins_h)}/{len(wins_h)}) and in >=3 of last 4 weeks "
          f"({sum(full)}/{len(full)})  ->  {verdict}")
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--from", dest="start", default="2026-10-06")
    a = ap.parse_args()
    account, token = S.env_creds()
    start = S._d(a.start)
    for area in S.AREAS:
        runs, shadows = collect(area, start, account, token)
        print(f"{area}: {len(runs)} archived runs, {len(shadows)} shadow runs")
        report(area, score(runs, shadows))


if __name__ == "__main__":
    sys.exit(main())
