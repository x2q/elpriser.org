#!/usr/bin/env python3
"""Shadow level correction for the v3 forecast. Nothing reads its output.

Why: the live archive (2026-10-06 onwards) shows v3 forecasting 9-29 % too low in
the current high-price regime. A trailing correction of the day-level error looked
useful on the 12 live days (-3..-8 % MAE) but gained almost nothing in the 16-month
backtest (-0.3 % DK1, -1.7 % DK2), because the bias normally comes and goes. Twelve
days cannot settle that, so this job computes the corrected forecast every day and
stores it NEXT TO the real one under its own key, untouched by the site and the
apps. shadow_eval.py then scores both against settled prices.

What it does, per area, for the run issued on day D:
  1. For each horizon h in HORIZONS, the error of the forecasts the archive holds for
     target days D-WINDOW..D-1 at that same horizon: day-mean(actual) - day-mean(forecast).
  2. The correction c_h is their mean (needs at least MIN_DAYS days, else none).
  3. Every forecast hour of horizon h is shifted by LAMBDA * c_h; its P10/P90 band
     moves with it. Hour-to-hour shape is not touched. Horizons >= 8 are left alone.
Only information available at the time is used (runs issued before D, actuals up to
D), so a backfilled day is what the job would really have produced.

KV: forecast-v3-shadow-{area}-{date}  (same payload as the archive, model "v3-shadow").
Stdlib only: it must not depend on the training code.
"""
import argparse
import copy
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

KV_NAMESPACE = "126700e66e8d4a19b289b0e8afdaff69"
AREAS = ["DK1", "DK2"]
HORIZONS = range(2, 8)      # D+2 .. D+7; D+8/D+9 are a separate question
LAMBDA = 0.5                # half of the measured error, so a bias that flips costs little
WINDOW_DAYS = 14            # target days whose errors are averaged
MIN_DAYS = 3                # fewer days than this: no correction
MIN_HOURS = 20              # a day needs this many settled hours to count (23-hour DST days pass)
TTL = 120 * 86400


# ─── Cloudflare KV ──────────────────────────────────────────────────────────
def env_creds():
    path = os.path.expanduser("~/.config/elpriser.env")
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))
    return os.environ["CLOUDFLARE_ACCOUNT_ID"], os.environ["CLOUDFLARE_API_TOKEN"]


def _kv_url(key, account):
    return (f"https://api.cloudflare.com/client/v4/accounts/{account}"
            f"/storage/kv/namespaces/{KV_NAMESPACE}/values/{urllib.parse.quote(key)}")


def kv_get(key, account, token):
    req = urllib.request.Request(_kv_url(key, account), headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def kv_put(key, value, ttl, account, token):
    req = urllib.request.Request(f"{_kv_url(key, account)}?expiration_ttl={ttl}",
                                 data=json.dumps(value).encode(), method="PUT",
                                 headers={"Authorization": f"Bearer {token}",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read())
    if not resp.get("success"):
        raise RuntimeError(f"KV put failed for {key}: {resp}")


def archive_key(area, d):
    return f"forecast-v3-archive-{area}-{d.isoformat()}"


def shadow_key(area, d):
    return f"forecast-v3-shadow-{area}-{d.isoformat()}"


# ─── pure logic ─────────────────────────────────────────────────────────────
def _d(s):
    return date.fromisoformat(s)


def hours_of(day):
    """{hour: price} for one archive day."""
    return {p["hour"]: p["spot_dkk_mwh"] for p in day["prices"] if p.get("spot_dkk_mwh") is not None}


def settled(runs):
    """{date: {hour: price}} of every settled price any run carries (later runs win)."""
    out = {}
    for run in sorted(runs, key=lambda r: r["generated"]):
        for day in run["days"]:
            if day["type"] == "actual":
                out[_d(day["date"])] = hours_of(day)
    return out


def corrections(runs, issued):
    """{h: {"c": DKK/MWh or 0, "n": days}} using only what was known on `issued`."""
    actual = settled(runs)
    lo, hi = issued - timedelta(days=WINDOW_DAYS), issued - timedelta(days=1)
    resid = {h: {} for h in HORIZONS}
    for run in runs:
        gen = _d(run["generated"])
        if gen >= issued:
            continue
        for day in run["days"]:
            if day["type"] != "forecast":
                continue
            t, h = _d(day["date"]), (_d(day["date"]) - gen).days
            if h not in resid or not lo <= t <= hi or t not in actual:
                continue
            f, a = hours_of(day), actual[t]
            common = [hr for hr in f if hr in a]
            if len(common) < MIN_HOURS:
                continue
            resid[h][t] = sum(a[hr] for hr in common) / len(common) - sum(f[hr] for hr in common) / len(common)
    return {h: {"c": (sum(r.values()) / len(r)) if len(r) >= MIN_DAYS else 0.0, "n": len(r)}
            for h, r in resid.items()}


def apply_shadow(base, corr, backfilled=False):
    """A copy of the archived run with the level shift applied to forecast days."""
    out = copy.deepcopy(base)
    issued = _d(base["generated"])
    for day in out["days"]:
        if day["type"] != "forecast":
            continue
        h = (_d(day["date"]) - issued).days
        c = corr.get(h)
        if not c or c["n"] < MIN_DAYS:
            continue
        shift = LAMBDA * c["c"]
        for p in day["prices"]:
            for k in ("spot_dkk_mwh", "spot_min_dkk_mwh", "spot_max_dkk_mwh"):
                if p.get(k) is not None:
                    p[k] = round(p[k] + shift, 2)
    out["model"] = "v3-shadow"
    out["shadow"] = {"base": "v3", "lambda": LAMBDA, "windowDays": WINDOW_DAYS, "minDays": MIN_DAYS,
                     "horizons": [min(HORIZONS), max(HORIZONS)], "backfilled": backfilled,
                     "corrections": {str(h): {"c": round(v["c"], 1), "n": v["n"]} for h, v in corr.items()}}
    return out


# ─── job ────────────────────────────────────────────────────────────────────
def load_runs(area, issued, account, token):
    runs = []
    for i in range(WINDOW_DAYS + max(HORIZONS) + 2):
        d = issued - timedelta(days=i)
        r = kv_get(archive_key(area, d), account, token)
        if r:
            runs.append(r)
    return runs


def run_day(area, d, account, token, backfilled=False, force=False, dry=False):
    if not force and not dry and kv_get(shadow_key(area, d), account, token):
        print(f"  {area} {d}: shadow exists, skipped")
        return
    runs = load_runs(area, d, account, token)
    base = next((r for r in runs if r["generated"] == d.isoformat()), None)
    if base is None:
        print(f"  {area} {d}: no archived run to shadow (non-fatal)")
        return
    corr = corrections(runs, d)
    out = apply_shadow(base, corr, backfilled)
    summary = ", ".join(f"D+{h}: {v['c']:+.0f} (n={v['n']})" for h, v in corr.items())
    print(f"  {area} {d}: {summary}")
    if not dry:
        kv_put(shadow_key(area, d), out, TTL, account, token)
        print(f"  KV written: {shadow_key(area, d)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--date", help="run date YYYY-MM-DD (default: today, UTC)")
    ap.add_argument("--backfill-from", help="also (re)produce every day from this date")
    ap.add_argument("--force", action="store_true", help="overwrite existing shadow keys")
    ap.add_argument("--dry-run", action="store_true", help="print the corrections, write nothing")
    a = ap.parse_args()
    account, token = env_creds()
    today = _d(a.date) if a.date else datetime.now(timezone.utc).date()
    start = _d(a.backfill_from) if a.backfill_from else today
    print(f"=== shadow correction {start}..{today} ===", flush=True)
    d = start
    while d <= today:
        for area in AREAS:
            try:
                run_day(area, d, account, token, backfilled=d < today, force=a.force, dry=a.dry_run)
            except Exception as e:      # the shadow must never fail anything else
                print(f"  {area} {d}: failed (non-fatal): {e}")
        d += timedelta(days=1)
    print("DONE")


if __name__ == "__main__":
    sys.exit(main())
