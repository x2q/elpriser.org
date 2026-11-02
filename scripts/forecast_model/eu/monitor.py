#!/usr/bin/env python3
"""Live accuracy of the EU forecast, from the archive the daily job keeps (the forecast-v3-archive pattern).

    python3 monitor.py [--days 21] [--zones de,fr] [--alert-factor 1.5]

Every run of train_daily.py stores what it published as `eu-forecast-archive-<zone>-<date>`. Once a forecast day has settled, its
real prices are in the local price cache (price_<zone>.parquet, ENTSO-E A44), so the error per zone and horizon can be measured
on what customers actually saw - something the backtest cannot prove, because the weather in a backtest is a reconstruction.

Output: per horizon, the live MAE next to the backtest MAE of accuracy_eu.json and their ratio, and a list of (zone, horizon) cells
whose live MAE is more than --alert-factor times the backtest's (accuracy_eu.json, `mae`) with at least MIN_DAYS settled days (exit code 4, so a cron
wrapper can mail it). A cell with fewer days is shown but never alerts: two bad days are weather, not a broken model.
"""
import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)

MIN_DAYS = 10


def evaluate(archives, actual, field="published"):
    """archives: [payload as stored]; actual: {zone: hourly Series on the zone's naive local clock}.
    `field` picks the numbers to score: "published" (what customers saw), "uncorrected" (the model's own) or "shadow" (with the
    shadow level correction; level_correction.py). Returns a DataFrame zone, h, days, mae, bias (EUR/MWh) and cover (the share of hours
    that fell inside the published min..max band; NaN for a field without a band or a day published without one) over the forecast
    days that have settled prices for all 24 hours."""
    rows = []
    for pl in archives:
        z = pl.get("zone")
        a = actual.get(z)
        if a is None:
            continue
        for d in pl.get("days", []):
            if d.get("type") != "forecast":
                continue
            idx = pd.date_range(pd.Timestamp(d["date"]), periods=24, freq="h")
            y = a.reindex(idx).to_numpy(dtype=float)
            band = None
            if field == "published":
                ps = sorted(d["prices"], key=lambda p: p["hour"])
                f = np.array([p["eur_mwh"] if p.get("eur_mwh") is not None else np.nan for p in ps], dtype=float)
                if all(p.get("min_eur_mwh") is not None and p.get("max_eur_mwh") is not None for p in ps) and len(ps) == 24:
                    band = (np.array([p["min_eur_mwh"] for p in ps], dtype=float), np.array([p["max_eur_mwh"] for p in ps], dtype=float))
            else:
                f = np.array(d.get(field) or [], dtype=float)
            if len(f) != 24 or np.isnan(y).any() or np.isnan(f).any():
                continue            # the day has not (fully) settled, or the forecast is incomplete
            cover = float(((y >= band[0]) & (y <= band[1])).mean()) if band is not None else np.nan
            rows.append({"zone": z, "h": int(d["horizon"]), "date": d["date"], "mae": float(np.abs(f - y).mean()), "bias": float((f - y).mean()), "cover": cover})
    if not rows:
        return pd.DataFrame(columns=["zone", "h", "days", "mae", "bias", "cover"])
    df = pd.DataFrame(rows)
    return df.groupby(["zone", "h"], as_index=False).agg(days=("date", "nunique"), mae=("mae", "mean"), bias=("bias", "mean"), cover=("cover", "mean"))


def backtest_mae(accuracy, zone, h):
    """The backtest MAE of accuracy_eu.json (version 2: zones -> fuel|nofuel -> horizon -> cell) for a zone and horizon, in the fuel mode
    the daily job normally runs in; NaN when the file has no number."""
    z = ((accuracy or {}).get("zones") or {}).get(zone) or {}
    e = (z.get("fuel") or {}).get(str(int(h))) or (z.get("nofuel") or {}).get(str(int(h)))
    return e["mae"] if e and e.get("mae") is not None else np.nan


def drift(live, accuracy, factor=1.5, min_days=MIN_DAYS):
    """live (evaluate's output) against accuracy_eu.json -> the same frame with backtest_mae, ratio and `alert`."""
    out = live.copy()
    out["backtest_mae"] = [backtest_mae(accuracy, r["zone"], r["h"]) for _, r in out.iterrows()]
    out["ratio"] = out["mae"] / out["backtest_mae"]
    out["alert"] = (out["ratio"] > factor) & (out["days"] >= min_days)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=21, help="how many past run dates to read from the archive")
    ap.add_argument("--zones")
    ap.add_argument("--alert-factor", type=float, default=1.5)
    ap.add_argument("--field", default="published", choices=["published", "uncorrected", "shadow"],
                    help="which archived numbers to score; run once with published and once with shadow to compare them")
    a = ap.parse_args(argv)
    import kv
    import train_daily as T
    import dataset as ds
    from zones import ZONES
    T.load_env()
    acct, tok = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    if not (acct and tok):
        print("missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN")
        return 2
    zones = a.zones.split(",") if a.zones else list(ZONES)
    today = datetime.now(timezone.utc).date()
    archives = []
    for z in zones:
        for k in range(1, a.days + 1):
            v = kv.get(f"eu-forecast-archive-{z}-{(today - timedelta(days=k)).isoformat()}", acct, tok)
            if v:
                archives.append(v)
    live = evaluate(archives, ds.load_prices(zones=zones), a.field)
    res = drift(live, T.load_json("accuracy_eu.json"), a.alert_factor)
    pd.set_option("display.width", 200)
    if res.empty:
        print("no settled archived forecast days yet")
        return 0
    print(res.round(2).to_string(index=False))
    bad = res[res["alert"]]
    if len(bad):
        print("\nALERT: live error more than %.1fx the backtest in: " % a.alert_factor + ", ".join(f"{r.zone} D+{int(r.h)}" for r in bad.itertuples()))
        return 4
    return 0


if __name__ == "__main__":
    sys.exit(main())
