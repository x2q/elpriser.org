#!/usr/bin/env python3
"""Nordic + NL price forecast, daily job v2: the gate, the accuracy block, and the ensemble recipe for the zones that need it (docs/forecast-nordic-no.md).

    cd ~/nordic && set -a && . ~/.config/elpriser.env && set +a && python3 train_daily_v2.py [--dry-run] [--zones no1,no2] [--skip-refresh]

STAGED, NOT ROLLED OUT: train_daily.py (the cron job of today) is untouched; this file imports it as a library for what it already does (price / weather /
reservoir refresh, the pooled model `pooled`, the old per-zone feed with its settled days) and adds three things:

  1. every zone's forecast days go through publish_gate_nordic.json (the EU rule: >= 5 % better than level+shape on the whole backtest AND the hold-out; a horizon the
     gate does not list is NOT published, and neither is anything behind a gap) and carry `horizon`, a P10-P90 band (calibration_nordic_v2.json) and the zone's
     `accuracy` block (accuracy_nordic.json) in the KV value `nordic-forecast-<zone>`;
  2. the zones whose gate entry says recipe `ens` (NO1, NO2, NO3, NO5; NO4 passes at no horizon) are forecast by the ENSEMBLE recipe (recipe_nordic.py: 730-day ridge +
     LightGBM on price - level_7d, gas / carbon inputs, leak-free reservoir features, the 50/50 shape blend) instead of the pooled model;
  3. the ensemble needs the fuel inputs (MIBGAS gas, EEX carbon, INPUTS only, as in the EU job: eu/fuel_live.py): without usable fuel the `ens` zones publish NO forecast
     days (their gate was measured with fuel; the pooled model fails the gate there) and the settled days alone are served; the other zones are not affected.

Keys written: nordic-forecast-<zone> (TTL 3 days, same keys and shape as before: zone, generated, trainedThrough, unit, days[] + model, recipe, accuracy; forecast days
have `horizon`) and nordic-forecast-archive-<zone>-<date> (TTL 200 days, for monitoring). Nothing else; never eu-*, never forecast-v3-*.
Exit codes: 0 ok, 1 live weather missing (nothing written), 2 gate / accuracy file missing or old format (nothing written), 3 fewer than 10 zones written.
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import train_daily as OLD            # noqa: E402  (the production job, as a library: its main() is guarded)
import recipe_nordic as RN           # noqa: E402
import publish_nordic as PUB         # noqa: E402

KV_FORECAST_TTL = 3 * 86400
KV_ARCHIVE_TTL = 200 * 86400
FUEL_CACHE = os.path.join(DIR, "fuel_daily.csv")
MIN_ZONES = 10
PRICE_SANITY = (-500.0, 4000.0)
OLD_MODEL = "nordic-pooled-v1"


def log(msg):
    print(msg, flush=True)


def split_days(days):
    """The old feed of a zone -> (settled days, last settled date, forecast rows frame(date, hour, h, point))."""
    actual = [d for d in days if d["type"] == "actual"]
    last = max(pd.Timestamp(d["date"]) for d in actual) if actual else None
    rows = []
    for d in days:
        if d["type"] != "forecast" or last is None or pd.Timestamp(d["date"]) <= last:
            continue
        h = PUB.horizon_of(pd.Timestamp(d["date"]), last)
        for p in d["prices"]:
            rows.append({"date": pd.Timestamp(d["date"]), "hour": p["hour"], "h": h, "point": p["eur_mwh"]})
    return actual, last, pd.DataFrame(rows, columns=["date", "hour", "h", "point"])


def ens_points(zones, prices, live, hist_weather, res_lf, table, df, today, jobs, t0):
    """{zone: DataFrame(date, hour, h, point)} from the ensemble recipe for `zones`, and the date the training data runs to."""
    tables = RN.RM.day_tables(prices)
    df = df[df["h"] <= RN.H_MAX].copy()
    df["zone"] = df["zone"].astype(str)
    df["t"] = pd.to_datetime(df["t"])
    df["date"] = df["t"].dt.normalize()
    df = RN.augment(df, prices, tables)
    df = RN.add_reservoir_lf(df, res_lf)
    df = RN.add_fuel(df, table)
    model, tr = RN.lgb_fit(df[df["y"].notna()], jobs)
    per_day = pd.to_datetime(tr["t"]).dt.normalize().value_counts()
    trained_through = per_day[per_day >= 0.5 * per_day.median()].index.max().date()
    log(f"  LightGBM (rel, fuel) on {len(tr):,} rows through {trained_through} ({time.time() - t0:.0f}s)")
    reg = RN.regional_weather(live, hist_weather, today)
    parts = []
    for z in zones:
        lk = RN.last_known_day(prices[z], today)
        if lk is None or pd.Timestamp(lk) < today - pd.Timedelta(days=1):
            log(f"  {z}: prices are stale, no ensemble forecast")
            continue
        r = RN.live_rows(z, prices[z], live[z], reg, today, lk)
        if len(r):
            parts.append(r)
    if not parts:
        return {}, trained_through
    rows = pd.concat(parts, ignore_index=True)
    rows = RN.augment(rows, prices, tables)
    rows = RN.add_reservoir_lf(rows, res_lf)
    rows = RN.add_fuel(rows, table)
    hist = df[df["y"].notna() & df["zone"].isin(zones) & (df["date"] >= rows["date"].min() - pd.Timedelta(days=RN.LEAR_WINDOW_DAYS + 40))]
    ridge = RN.lear_predict(hist, rows, True)
    tree = pd.Series(RN.lgb_predict(model, rows), index=rows.index)
    point = RN.hybrid(rows, RN.point_forecast(ridge, tree))
    out = {}
    for z in zones:
        m = (rows["zone"] == z).to_numpy()
        if m.any():
            out[z] = rows.loc[m, ["date", "hour", "h"]].assign(point=point[m])
            nan = int((~np.isfinite(point[m])).sum())
            if nan:
                log(f"  {z}: {nan} hours without an ensemble estimate (ridge gap {int(ridge[m].isna().sum())}, tree gap {int(tree[m].isna().sum())}): those days are dropped")
    return out, trained_through


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="everything except the KV writes")
    ap.add_argument("--zones", help="comma-separated subset to publish (the models are always trained on all zones)")
    ap.add_argument("--skip-refresh", action="store_true", help="use the cached prices, weather, reservoir and fuel as they are")
    a = ap.parse_args(argv)
    t0 = time.time()
    OLD.env()
    now = datetime.now(timezone.utc)
    today = pd.Timestamp(now.date())
    log(f"=== Nordic daily run v2 {now:%Y-%m-%d %H:%M}Z{' (dry run)' if a.dry_run else ''} ===")
    acct, cf = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    if not a.dry_run and not (acct and cf):
        log("missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN")
        return 2
    gate = PUB.load_gate(os.path.join(DIR, "publish_gate_nordic.json"))
    acc = PUB.load_accuracy(os.path.join(DIR, "accuracy_nordic.json"))
    if gate is None or acc is None:
        log("publish_gate_nordic.json / accuracy_nordic.json missing or not version 2: nothing is published")
        return 2
    cal = PUB.load_calibration(os.path.join(DIR, "calibration_nordic_v2.json"))
    if cal is None:
        log("  calibration_nordic_v2.json missing or not version 2: days are published WITHOUT a band")
    zones = a.zones.split(",") if a.zones else list(RN.ZONES)
    unknown = [z for z in zones if z not in RN.ZONES]
    if unknown:
        log("unknown zone(s): " + ", ".join(unknown))
        return 2
    jobs = int(os.environ.get("NORDIC_JOBS", "8"))

    if not a.skip_refresh:
        OLD.refresh()
    log("Building dataset...")
    OLD.ds.build()
    df = pd.read_parquet(os.path.join(DIR, "dataset_nordic.parquet"))
    prices = OLD.ds.load_prices()
    res = OLD.ds.load_reservoir()
    reservoirs, nordic_res = res if res else ({}, None)
    try:
        live = OLD.live_weather()
    except Exception as e:
        log(f"live weather forecast unavailable ({type(e).__name__}): aborting before anything is written")
        return 1

    # ---- the pooled model: exactly train_daily.py's median model and its per-zone feed (settled days + forecast days)
    import lightgbm as lgb
    train = df.dropna(subset=["y"])
    tr = train.dropna(subset=[c for c in OLD.FEATS if not c.startswith("lag") and c != "zone" and c not in OLD.NULLABLE])
    md = lgb.LGBMRegressor(objective="quantile", alpha=0.5, n_estimators=500, num_leaves=127, min_child_samples=40, learning_rate=0.05, verbosity=-1, n_jobs=jobs)
    md.fit(tr[OLD.FEATS], tr["y"], categorical_feature=["zone"])
    trained_through = pd.to_datetime(tr["t"]).max().date()
    log(f"  pooled model on {len(tr):,} rows through {trained_through} ({time.time() - t0:.0f}s)")
    old = OLD.score({"md": md}, prices, live, reservoirs, nordic_res, now.date())

    # ---- the ensemble for the zones whose recipe is `ens`
    ens_zones = [z for z in zones if PUB.recipe_of(gate, z) == "ens" and PUB.published_horizons(gate, acc, z)]
    ens, ens_through = {}, trained_through
    if ens_zones:
        try:
            import fuel_live as FL
            table, fst = FL.load(FUEL_CACHE, now.date(), refresh=not a.skip_refresh, log=log)
        except Exception as e:
            table, fst = None, {"reason": f"{type(e).__name__}: {e}", "gas_date": None, "eua_date": None}
        if table is None:
            log(f"FUEL off: {fst['reason']}: the ensemble zones ({', '.join(ens_zones)}) publish NO forecast days (settled days only)")
        else:
            log(f"FUEL on (gas print {fst['gas_date']}, carbon print {fst['eua_date']})")
            hist_w = {z: OLD.ds.load_weather("actual", z) for z in RN.ZONES}
            r = pd.read_parquet(os.path.join(DIR, "reservoir_weekly.parquet"))
            ens, ens_through = ens_points(ens_zones, prices, live, hist_w, RN.reservoir_lf(r), table, df, today, jobs, t0)

    # ---- publish
    wrote, skipped, latest = 0, [], {}
    for z in zones:
        try:
            actual, last, pts = split_days(old[z])
            rec = PUB.recipe_of(gate, z)
            if last is None:
                skipped.append(z)
                log(f"  {z}: no settled days, nothing to publish")
                continue
            use_ens = rec == "ens"
            if use_ens:
                pts, through, model = ens.get(z, pts.iloc[0:0]), ens_through, RN.MODEL_NAME
            else:
                through, model = trained_through, OLD_MODEL
            hs = PUB.published_horizons(gate, acc, z)
            fdays = PUB.forecast_days(z, pts, last.date() if hasattr(last, "date") else last, hs, cal)
            fdays = [d for d in fdays if all(PRICE_SANITY[0] <= p["eur_mwh"] <= PRICE_SANITY[1] for p in d["prices"])]
            block = PUB.accuracy_block(acc, z, {d["horizon"] for d in fdays}) if fdays else None
            if fdays and block is None:
                log(f"  {z}: no accuracy numbers for the horizons: forecast days not published")
                fdays = []
            pl = PUB.payload(z, actual, fdays, now.date(), through, now.isoformat(timespec="seconds"), model, rec, block)
            latest[z] = pl
            hz = ",".join(str(d["horizon"]) for d in fdays) or "none"
            if a.dry_run:
                log(f"  {z}: would write nordic-forecast-{z}: {len(actual)} settled days + forecast h {hz} ({rec})")
            else:
                OLD.kv_put(f"nordic-forecast-{z}", pl, KV_FORECAST_TTL, acct, cf)
                OLD.kv_put(f"nordic-forecast-archive-{z}-{now.date().isoformat()}", pl, KV_ARCHIVE_TTL, acct, cf)
                log(f"  {z}: wrote nordic-forecast-{z} (+ archive): {len(actual)} settled days + forecast h {hz} ({rec})")
            wrote += 1
            time.sleep(0.2)
        except Exception as e:
            skipped.append(z)
            log(f"  {z}: FAILED (non-fatal): {type(e).__name__}: {e}")
    with open(os.path.join(DIR, "forecast_latest_v2.json"), "w", encoding="utf-8") as f:
        json.dump(latest, f)
    log(f"DONE {wrote}/{len(zones)} zones" + (f", skipped: {', '.join(skipped)}" if skipped else "") + f" ({time.time() - t0:.0f}s)")
    return 3 if (len(zones) == len(RN.ZONES) and wrote < MIN_ZONES) else 0


if __name__ == "__main__":
    sys.exit(main())
