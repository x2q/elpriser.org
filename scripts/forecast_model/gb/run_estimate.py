#!/usr/bin/env python3
"""The hourly estimate job: the ESTIMATE of the hours that have no settled price yet, for Great Britain, Portugal and Ireland -> KV.

    cd ~/gb-estimate && set -a && . ~/.config/elpriser.env && set +a && python3 run_estimate.py [--dry-run] [--zones gb,pt,ie] [--skip-refresh] [--asof-hour 14]

    gb   eu-estimate-gb (TTL 3 h)   the rest of today, hour by hour (the Elexon Market Index Price appears hour by hour): the intraday ensemble of gbjob.py
         eu-forecast-gb (TTL 6 h)   the forecast days D+1 .. D+7 the gate passed (joined by /api/nordic after the settled days like every EU zone's)
         eu-estimate-archive-gb-<date> (TTL 200 days, the day's first run)
    pt, ie   eu-estimate-<zone> (TTL 3 h)   the one missing last local hour (23) of the newest settled day (hour23.py)

Cron (not installed by the repo; see docs/forecast-runbook.md): 12 * * * *  /home/cc/gb-estimate/run_hourly.sh  - five minutes after the Elexon price job (:07).
It NEVER writes eu-prices-*, eu-forecast-<other zone>, nordic-* or forecast-v3-* keys. --dry-run does everything except the KV writes (no Cloudflare credentials needed).

Failure policy: a zone that cannot be scored is skipped, its key expires by itself (3 h) and the API then serves the settled prices alone, exactly as before. Missing live
weather, stale prices or old models for gb: nothing is written for gb. The job exits 0 unless the configuration is missing (2) or every zone failed (3).
"""
import argparse
import json
import os
import pickle
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
sys.path.insert(1, os.path.join(DIR, "..", "eu"))
sys.path.insert(1, os.path.join(DIR, "..", "..", "eu_prices"))
import fetch_mid                                         # noqa: E402
import fetch_weather_gb as FW                            # noqa: E402
import gbfeat as GF                                      # noqa: E402
import gbjob as GJ                                       # noqa: E402
import hour23 as H23                                     # noqa: E402

ZONES = ("gb", "pt", "ie")                               # the zones of functions/_estimate.js ESTIMATE_ZONES (test-eu-forecast.mjs pins that they agree)
DATA = os.environ.get("GB_DATA_DIR", DIR)
ESTIMATE_TTL = 3 * 3600
FORECAST_TTL = 6 * 3600
ARCHIVE_TTL = 200 * 86400
REWRITE_AFTER_MIN = 100               # an unchanged pt / ie estimate is rewritten after this long (the API ignores one older than 3 h)
API = "https://elpriser.org/api/nordic?zone="
UA = "elpriser.org/1.0 (+https://elpriser.org; hello@elpriser.org)"
SEED = os.path.expanduser("~/eu-forecast")               # read-only source of the pt / ie history on the Spark (the EU job's ENTSO-E caches)


def log(msg):
    print(msg, flush=True)


def load_env():
    path = os.path.expanduser("~/.config/elpriser.env")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"'))


def load_json(name, version):
    try:
        with open(os.path.join(DIR, name), encoding="utf-8") as f:
            v = json.load(f)
    except (OSError, ValueError):
        return None
    return v if isinstance(v, dict) and v.get("version") == version else None


class Sink:
    """KV writes, or in a dry run nothing (the payloads are kept in `out` and in estimate_latest.json)."""

    def __init__(self, dry):
        self.dry, self.out = dry, {}
        if not dry:
            import kv
            self.kv = kv
            self.acct, self.tok = os.environ["CLOUDFLARE_ACCOUNT_ID"], os.environ["CLOUDFLARE_API_TOKEN"]

    def put(self, key, value, ttl, skip_if_same=None):
        """Write unless `skip_if_same(stored)` says the stored body already says the same (saves the free plan's daily write allowance)."""
        self.out[key] = value
        if self.dry:
            return "would write"
        if skip_if_same:
            try:
                if skip_if_same(self.kv.get(key, self.acct, self.tok)):
                    return "unchanged"
            except Exception:
                pass
        self.kv.put(key, value, ttl, self.acct, self.tok)
        return "wrote"


# ------------------------------------------------------------------ Great Britain
def run_gb(now_utc, a, sink):
    tz = ZoneInfo("Europe/London")
    loc = now_utc.astimezone(tz)
    today, hr = loc.date(), a.asof_hour if a.asof_hour is not None else loc.hour
    gate, cal = load_json("gb_gate.json", 1), load_json("gb_calibration.json", 1)
    if gate is None or cal is None:
        log("  gb: gb_gate.json / gb_calibration.json missing or not version 1: nothing is published")
        return "config"
    try:
        with open(os.path.join(DATA, "models", "gb_models.pkl"), "rb") as f:
            models = pickle.load(f)
    except Exception as e:
        log(f"  gb: no models ({type(e).__name__}): run train_gb.py first; nothing is published")
        return "skipped"
    age = (now_utc - datetime.fromisoformat(models["built"])).days
    if age > GJ.MAX_MODEL_AGE_DAYS:
        log(f"  gb: the models are {age} days old (train_gb.py stopped?): nothing is published")
        return "skipped"
    path = os.path.join(DATA, "price_gb.parquet")
    if not a.skip_refresh:
        try:
            fetch_mid.update(path, refresh=3)
        except Exception as e:
            log(f"  gb: Elexon refresh failed, using the cache: {e}")
    price = fetch_mid.load(path)
    if price.index.max().normalize() < pd.Timestamp(today) - pd.Timedelta(days=1):
        log(f"  gb: the newest price is {price.index.max():%Y-%m-%d %H:00}: stale, nothing is published")
        return "skipped"
    try:
        wx = GF.live_local(FW.live())
    except Exception as e:
        log(f"  gb: live weather unavailable ({type(e).__name__}): nothing is published")
        return "skipped"
    h = GJ.live_hist(price, wx, today, hr)
    rows = GJ.live_rows(h, today, hr)
    if rows.empty:
        log("  gb: no level yet (too little history): nothing is published")
        return "skipped"
    pred = GJ.predict(models, rows, cal)
    generated = now_utc.isoformat(timespec="seconds")
    est = GJ.build_estimate(pred, gate, h, today, hr, generated)
    fc = GJ.build_forecast(pred, gate, today, generated, models["trainedThrough"])
    known = int(np.isfinite(h.P[h.di(today), :hr]).sum())
    log(f"  gb: London {today} {hr:02d}:xx, {known} hours settled so far; trained through {models['trainedThrough']} (models {age} d old)")
    if est:
        r = sink.put("eu-estimate-gb", est, ESTIMATE_TTL)
        hs = est["hours"]
        log(f"  gb: {r} eu-estimate-gb: hours {hs[0]['hour']}..{hs[-1]['hour']}, mean {np.mean([x['eur_mwh'] for x in hs]):.1f} GBP/MWh, "
            f"{'with band' if 'min_eur_mwh' in hs[0] else 'NO band'}, class rest@{est['accuracy']['asOf']:02d} (MAE {est['accuracy']['mae']} vs {est['accuracy']['baseMae']} level+shape)")
    else:
        log("  gb: no estimate for the rest of today (gate, or no finite hour)")
    if fc:
        same = lambda s: bool(s) and s.get("days") == fc["days"] and s.get("generated") == fc["generated"] and \
            (now_utc - datetime.fromisoformat(s["generatedAt"])).total_seconds() < REWRITE_AFTER_MIN * 60
        r = sink.put("eu-forecast-gb", fc, FORECAST_TTL, same)
        log(f"  gb: {r} eu-forecast-gb: days D+{','.join(str(d['horizon']) for d in fc['days'])}, "
            f"{'with band' if 'min_eur_mwh' in fc['days'][0]['prices'][0] else 'NO band'}")
    else:
        log("  gb: no forecast days passed the gate")
    # the archive (for monitor_gb.py): every run on disk, the day's first run also in KV
    if est or fc:
        arch = {"asof": generated, "today": today.isoformat(), "hour": hr, "estimate": est, "forecast": fc,
                "raw": {"point": [None if not np.isfinite(v) else round(float(v), 2) for v in pred["point"]], "k": pred["k"].tolist(), "hr": pred["hr"].tolist()}}
        d = os.path.join(DATA, "archive")
        os.makedirs(d, exist_ok=True)
        first = not any(n.startswith(f"gb-{today.isoformat()}") for n in os.listdir(d))
        if not a.dry_run:
            with open(os.path.join(d, f"gb-{today.isoformat()}-{hr:02d}.json"), "w", encoding="utf-8") as f:
                json.dump(arch, f)
            if first:
                sink.put(f"eu-estimate-archive-gb-{today.isoformat()}", {k: v for k, v in arch.items() if k != "raw"}, ARCHIVE_TTL)
            for n in os.listdir(d):                                   # keep 90 days on disk
                if n.startswith("gb-") and n[3:13] < (today - timedelta(days=90)).isoformat():
                    os.remove(os.path.join(d, n))
    return "ok" if (est or fc) else "skipped"


# ------------------------------------------------------------------ Portugal and Ireland: the missing hour 23
def api_days(zone):
    req = urllib.request.Request(API + zone, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def run_h23(zone, now_utc, a, sink):
    gate = load_json("hour23_gate.json", 1)
    z = ((gate or {}).get("zones") or {}).get(zone)
    if not z or not z.get("publish"):
        log(f"  {zone}: hour23_gate.json lets nothing through: no estimate")
        return "skipped"
    cache = os.path.join(DATA, f"hist_{zone}.parquet")
    if os.path.exists(cache):
        s = pd.read_parquet(cache)
    elif os.path.exists(os.path.join(SEED, f"price_{zone}.parquet")):
        s = pd.read_parquet(os.path.join(SEED, f"price_{zone}.parquet"))        # read only; the history of the EU job
        log(f"  {zone}: history seeded from {SEED}/price_{zone}.parquet")
    else:
        log(f"  {zone}: no price history ({cache}): skipped")
        return "skipped"
    s = s.set_index(pd.to_datetime(s["t"]))["eur_mwh"].sort_index()
    try:
        ans = api_days(zone)
    except Exception as e:
        log(f"  {zone}: /api/nordic unavailable ({type(e).__name__}): skipped")
        return "skipped"
    new = {}
    for d in ans.get("days", []):
        if d.get("type") == "actual":
            for p in d.get("prices", []):
                if p.get("eur_mwh") is not None:
                    new[pd.Timestamp(d["date"]) + pd.Timedelta(hours=int(p["hour"]))] = float(p["eur_mwh"])
    s = pd.concat([s[~s.index.isin(list(new))], pd.Series(new, dtype=float)]).sort_index()
    if not a.dry_run:
        s.rename("eur_mwh").rename_axis("t").reset_index().to_parquet(cache, index=False)
    days = pd.date_range(s.index.min().normalize(), s.index.max().normalize())
    P = s.reindex(pd.date_range(days[0], days[-1] + pd.Timedelta(hours=23), freq="h")).to_numpy(float).reshape(len(days), 24)
    i = len(days) - 1
    if not (np.isfinite(P[i, :23]).all() and not np.isfinite(P[i, 23])):
        log(f"  {zone}: the newest day {days[i]:%Y-%m-%d} is not 'hours 0..22 priced, hour 23 missing': no estimate")
        return "skipped"
    if days[i] < pd.Timestamp(now_utc.date()) - pd.Timedelta(days=1):
        log(f"  {zone}: the newest day is {days[i]:%Y-%m-%d}: stale, no estimate")
        return "skipped"
    method = z["method"]
    v = H23.estimate(P, i, method)
    if not np.isfinite(v):
        log(f"  {zone}: no estimate ({method} needs more history)")
        return "skipped"
    res = [P[j, 23] - H23.estimate(P, j, method) for j in range(max(40, i - H23.BAND_DAYS), i) if np.isfinite(P[j, 23])]
    off = H23.band_offsets(res)
    hour = {"hour": 23, "eur_mwh": round(float(v), 2)}
    if off:
        hour["min_eur_mwh"], hour["max_eur_mwh"] = round(float(min(v + off[0], v)), 2), round(float(max(v + off[1], v)), 2)
    acc = {k: z[k] for k in ("mae", "baseMae", "bestNaiveMae", "gain", "gainHold", "gainRecent", "maeHold", "maeSince", "coverage", "coverageRecent", "days") if z.get(k) is not None}
    acc.update({"unit": "EUR/MWh", "baseline": gate.get("baseline"), "period": gate.get("period"), "recent": gate.get("recent"), "hours": 1})
    est = {"zone": zone, "date": f"{days[i]:%Y-%m-%d}", "generatedAt": now_utc.isoformat(timespec="seconds"), "model": gate.get("model"), "unit": "EUR/MWh",
           "method": "last-settled-hour" if method == "persist" else "last-settled-hour-plus-typical-step", "hours": [hour], "accuracy": acc}
    same = lambda st: bool(st) and st.get("date") == est["date"] and st.get("hours") == est["hours"] and \
        (now_utc - datetime.fromisoformat(st["generatedAt"])).total_seconds() < REWRITE_AFTER_MIN * 60
    r = sink.put(f"eu-estimate-{zone}", est, ESTIMATE_TTL, same)
    if not a.dry_run:                                       # the first estimate made of each day, kept on disk for monitor_gb.py
        d = os.path.join(DATA, "archive")
        os.makedirs(d, exist_ok=True)
        fn = os.path.join(d, f"h23-{zone}-{est['date']}.json")
        if not os.path.exists(fn):
            with open(fn, "w", encoding="utf-8") as f:
                json.dump({"zone": zone, "date": est["date"], "hour": hour, "method": method, "hour22": float(P[i, 22])}, f)
    log(f"  {zone}: {r} eu-estimate-{zone}: {est['date']} hour 23 = {hour['eur_mwh']} EUR/MWh ({method}; hour 22 was {P[i, 22]:.2f}), "
        f"{'band ' + str(hour['min_eur_mwh']) + '..' + str(hour['max_eur_mwh']) if off else 'NO band'}")
    return "ok"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--zones", default=",".join(ZONES))
    ap.add_argument("--skip-refresh", action="store_true")
    ap.add_argument("--asof-hour", type=int, help="act as if it were this London clock hour today (the settled hours from it on are ignored)")
    a = ap.parse_args(argv)
    t0 = time.time()
    load_env()
    now = datetime.now(timezone.utc)
    log(f"=== estimate run {now:%Y-%m-%d %H:%M}Z{' (dry run)' if a.dry_run else ''} ===")
    if not a.dry_run and not (os.environ.get("CLOUDFLARE_ACCOUNT_ID") and os.environ.get("CLOUDFLARE_API_TOKEN")):
        log("missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN")
        return 2
    zones = [z for z in a.zones.split(",") if z]
    bad = [z for z in zones if z not in ZONES]
    if bad:
        log("unknown zone(s): " + ", ".join(bad))
        return 2
    sink = Sink(a.dry_run)
    status = {}
    for z in zones:
        try:
            status[z] = run_gb(now, a, sink) if z == "gb" else run_h23(z, now, a, sink)
        except Exception as e:                  # one zone must not stop the others
            status[z] = "failed"
            log(f"  {z}: FAILED (non-fatal): {type(e).__name__}: {e}")
    if a.dry_run:
        with open(os.path.join(DATA, "estimate_latest.json"), "w", encoding="utf-8") as f:
            json.dump(sink.out, f)
    log(f"DONE {sum(1 for v in status.values() if v == 'ok')}/{len(zones)} zones ({', '.join(f'{k}: {v}' for k, v in status.items())}) ({time.time() - t0:.0f}s)")
    return 2 if "config" in status.values() else (3 if zones and all(v == "failed" for v in status.values()) else 0)


if __name__ == "__main__":
    sys.exit(main())
