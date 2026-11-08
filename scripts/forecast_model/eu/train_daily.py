#!/usr/bin/env python3
"""EU price forecast - the daily job for the 26 EU zones of /api/nordic whose own model this is.

    cd ~/eu-forecast && set -a && . ~/.config/elpriser.env && set +a && python3 train_daily.py [--dry-run] [--zones de,fr] [--skip-refresh]

Order of work: top up the price history (ENTSO-E A44) and the weather history (Open-Meteo previous-runs), fetch the live 10-day weather
forecast, refresh the fuel cache (fuel_live.py: MIBGAS gas + EEX carbon, INPUTS only), build the pooled training set, train
  LightGBM without fuel (the Baltics' model), LightGBM with fuel and its P10 / P90 quantile models (when the fuel is usable),
fit the 365-day ridge of every zone and horizon (recipe.lear_predict), and write for each zone
    eu-forecast-<zone>                          the forecast (TTL 3 days), read by /api/nordic
    eu-forecast-archive-<zone>-<YYYY-MM-DD>     the run as published (TTL 200 days), for measuring real accuracy later (monitor.py)
It NEVER writes eu-prices-<zone> or any nordic-forecast-* / forecast-v3-* key. --dry-run does everything except the KV writes and prints a
summary; it needs ENTSOE_TOKEN (and network) unless --skip-refresh, but not the Cloudflare pair.

The recipe is recipe.py (docs/forecast-per-region.md). WHAT is published is decided by files, not by this code (gate.py):
  publish_gate.json   zone -> the horizons (D+2 .. D+7) whose out-of-sample error is at least 5 % below the naive level+shape method
  accuracy_eu.json    zone -> what the forecast is worth, per horizon (the `accuracy` block of the payload; a horizon without numbers is not published)
  calibration_eu.json the P10 / P90 band offsets (calibrate_bands.py, monthly)
A missing or old-format gate / accuracy file means NOTHING is published (exit 2); a missing calibration means days WITHOUT a band.

Failure policy: a zone that cannot be scored is skipped (its old key expires after 3 days and the API then serves the settled prices alone);
a missing live weather forecast aborts the whole run with exit 1 before anything is written; a failing FUEL source never aborts anything:
fuel_live uses the cache while its newest value is at most 3 days old (carbon: 6, auctions are weekdays only) and otherwise the fuel zones
run WITHOUT fuel under the gate's own `nofuel` horizons, with the log line "FUEL off: <reason>". The job exits 0 otherwise; exit 3 when fewer
than MIN_ZONES zones were written. The log line "DONE n/26 zones" is the one to alert on.

Level correction (level_correction.py): in the zones of LC.PUBLISH_ZONES (me mk rs xk al gr) the published forecast is the model's number plus LAMBDA x the mean error of the same
zone and horizon over the last 14 settled days of the job's OWN archive (LC.PUBLISH_LAMBDA = 0.5; EU_FORECAST_LAMBDA=0 turns it off); the other zones are published as the model made them. The model's own numbers (`uncorrected`) are archived beside the published ones, and
monitor.py --field uncorrected scores them against --field published.
EU_FORECAST_NO_FUEL=1 never fetches or reads the fuel inputs (every fuel zone then runs the no-fuel recipe).

Cron (not installed by the repo; see run_daily.sh and docs/forecast-runbook.md): 15 15 * * *  /home/cc/eu-forecast/run_daily.sh
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import backtest as B                  # noqa: E402
import dataset as ds                  # noqa: E402
import features as F                  # noqa: E402
import fetch_prices                   # noqa: E402
import fetch_weather as W             # noqa: E402
import forecast as FC                 # noqa: E402
import fuel_live as FL                # noqa: E402
import gate as G                      # noqa: E402
import kv                             # noqa: E402
import level_correction as LC         # noqa: E402
import recipe as RC                   # noqa: E402
from zones import ZONES               # noqa: E402

PRICE_SANITY = (-500.0, 4000.0)       # EUR/MWh: the harmonised day-ahead limits are -500 and 4,000
MIN_ZONES = 20                        # fewer zones written than this is reported as a failed run (exit 3) after writing what there is
FUEL_CACHE = os.path.join(DIR, "fuel_daily.csv")
LEAR_HISTORY_DAYS = RC.LEAR_WINDOW_DAYS + 40       # rows kept for the ridge: the window plus the days between its end and the newest target


def load_env():
    path = os.path.expanduser("~/.config/elpriser.env")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"'))


def log(msg):
    print(msg, flush=True)


def load_json(name):
    path = os.path.join(DIR, name)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def refresh(zones):
    log("Refreshing prices...")
    for z in zones:
        try:
            fetch_prices.update(z)
        except Exception as e:           # a zone's price top-up failing leaves its cache as it was
            log(f"  {z}: price refresh failed, using cached: {e}")
    log("Refreshing weather history...")
    try:
        W.fetch_history(pause=3)
    except Exception as e:
        log(f"  weather history refresh failed, using cached: {e}")


def fit_lgb(df, variant, jobs, alpha=0.5):
    """backtest.py's LightGBM (median unless `alpha`), target = price - level_7d. Returns (model, features, rows used)."""
    import lightgbm as lgb
    feats = B.feats_for(variant)
    tr = df.dropna(subset=B.required(feats) + ["y"])
    m = lgb.LGBMRegressor(n_jobs=jobs, **{**B.PARAMS, "alpha": alpha})
    m.fit(tr[feats], tr["y"] - tr["level_7d"], categorical_feature=["zone"])
    return m, feats, tr


def lgb_predict(model, feats, X):
    return model.predict(X[feats]) + X["level_7d"].to_numpy()


def trained_through_of(tr):
    """The newest day with (nearly) every zone's rows - a stray first hour of the next day in the eastern zones must not make a model look
    fresher than it is. A frozen source shows up here as a date that stops moving."""
    per_day = pd.to_datetime(tr["t"]).dt.normalize().value_counts()
    return per_day[per_day >= 0.5 * per_day.median()].index.max().date()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="do everything except write to KV")
    ap.add_argument("--zones", help="comma-separated subset to score (the models are always trained on all zones)")
    ap.add_argument("--skip-refresh", action="store_true", help="use the cached prices, weather and fuel as they are")
    a = ap.parse_args(argv)
    t0 = time.time()
    load_env()
    now = datetime.now(timezone.utc)
    log(f"=== EU forecast run {now:%Y-%m-%d %H:%M}Z{' (dry run)' if a.dry_run else ''} ===")
    acct, cf = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    if not a.dry_run and not (acct and cf):
        log("missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN")
        return 2
    if not os.environ.get("ENTSOE_TOKEN") and not a.skip_refresh:
        log("missing ENTSOE_TOKEN")
        return 2
    zones = a.zones.split(",") if a.zones else list(ZONES)
    unknown = [z for z in zones if z not in ZONES]
    if unknown:
        log("unknown zone(s): " + ", ".join(unknown))
        return 2
    gate = G.load_gate(os.path.join(DIR, "publish_gate.json"))
    acc = G.load_accuracy(os.path.join(DIR, "accuracy_eu.json"))
    if gate is None or acc is None:
        log("publish_gate.json / accuracy_eu.json missing or not version 2: nothing is published")
        return 2
    cal = G.load_calibration(os.path.join(DIR, "calibration_eu.json"))
    if cal is None:
        log("  calibration_eu.json missing or not version 2: days are published WITHOUT a band")

    if not a.skip_refresh:
        refresh(list(ZONES))
    try:
        live = W.live()
    except Exception as e:
        log(f"live weather forecast unavailable ({type(e).__name__}): aborting before anything is written")
        return 1
    if len(live) < len(ZONES):
        log(f"live weather for {len(live)}/{len(ZONES)} zones: aborting before anything is written")
        return 1

    if os.environ.get("EU_FORECAST_NO_FUEL") == "1":        # the switch for a licence answer of "no": nothing is fetched or read
        table, fst = None, {"reason": "switched off (EU_FORECAST_NO_FUEL=1)", "gas_date": None, "eua_date": None}
    else:
        table, fst = FL.load(FUEL_CACHE, now.date(), refresh=not a.skip_refresh, log=log)
    fuel_ok = table is not None
    log(f"FUEL {'on' if fuel_ok else 'off: ' + str(fst['reason'])} (gas print {fst['gas_date']}, carbon print {fst['eua_date']}); "
        + ("" if fuel_ok else "the fuel zones run without fuel under the gate's nofuel horizons"))

    log("Building dataset...")
    df = ds.build(save=False)
    if df.empty or df["zone"].nunique() < MIN_ZONES:
        log("dataset has too few zones: aborting")
        return 1
    df["date"] = pd.to_datetime(df["t"]).dt.normalize()
    if fuel_ok:
        df = RC.add_fuel_columns(df, table)
    prices = ds.load_prices()
    days, eu = F.day_table(prices)
    log(f"  {len(df):,} training rows ({time.time() - t0:.0f}s)")

    # live rows of every zone, with the same fuel columns as the training rows
    parts = []
    for z in ZONES:
        try:
            tz = ZoneInfo(ZONES[z][1])
            today = now.astimezone(tz).date()
            r = FC.build_rows(z, prices[z], FC.live_weather_local(live, z), FC.live_regional_local(live, z), days[z], eu, today)
        except Exception as e:
            log(f"  {z}: live rows FAILED (non-fatal): {type(e).__name__}: {e}")
            continue
        if len(r):
            parts.append(r)
    if not parts:
        log("no zone has fresh prices: nothing to score")
        return 3 if len(zones) == len(ZONES) else 0
    rows = pd.concat(parts, ignore_index=True)
    if fuel_ok:
        rows = RC.add_fuel_columns(rows, table)

    # ---- the models
    jobs = int(os.environ.get("EU_FORECAST_JOBS", "8"))
    model_base, feats_base, tr_base = fit_lgb(df, "rel", jobs)
    trained_through = trained_through_of(tr_base)
    lag = (now.date() - trained_through).days
    log(f"  LightGBM (no fuel) on {len(tr_base):,} rows, through {trained_through} ({lag} days before today; {time.time() - t0:.0f}s)")
    if lag > 7:
        log(f"  WARNING: the newest training row is {lag} days old - a source has stopped refreshing")
    Xl = rows.copy()
    Xl["zone"] = pd.Categorical(Xl["zone"], categories=list(ZONES))
    preds = {"lgb_base": lgb_predict(model_base, feats_base, Xl)}
    del tr_base
    q_lo = q_hi = None
    if fuel_ok:
        m, f_, tr = fit_lgb(df, "rel+fuel", jobs)
        preds["lgb_fuel"] = lgb_predict(m, f_, Xl)
        del tr
        mq, fq, trq = fit_lgb(df, "rel+fuel", jobs, 0.1)
        q_lo = lgb_predict(mq, fq, Xl)
        mq, fq, trq = fit_lgb(df, "rel+fuel", jobs, 0.9)
        q_hi = lgb_predict(mq, fq, Xl)
        del trq
        log(f"  LightGBM with fuel and its P10 / P90 models done ({time.time() - t0:.0f}s)")
    # the ridge of every zone and horizon, on the last 365 days (+ the days between the window's end and today)
    need_lear = [z for z in ZONES if z not in RC.BALTICS]
    cut = rows["date"].min() - pd.Timedelta(days=LEAR_HISTORY_DAYS)
    hist = df[(df["date"] >= cut) & (df["h"] <= RC.H_MAX) & df["y"].notna() & df["zone"].isin(need_lear)].copy()
    del df
    tables = RC.RM.day_tables(prices)
    hist = RC.augment(hist, prices, tables)
    live_aug = RC.augment(rows, prices, tables)
    sel = live_aug["zone"].isin(need_lear)
    lear = pd.Series(np.nan, index=live_aug.index)
    imputed = 0
    if sel.any():
        res = RC.lear_predict(hist, live_aug[sel], fuel_ok)
        lear[sel] = res
        imputed = res.attrs.get("imputed", 0)
    preds["lear_fuel" if fuel_ok else "lear_nofuel"] = lear.to_numpy()
    log(f"  ridge (365 days, {'with' if fuel_ok else 'without'} fuel) done ({time.time() - t0:.0f}s); {imputed} missing price lags replaced by their training mean")

    # ---- publish
    errors = LC.merge_errors(LC.day_errors_from_archive(os.path.join(DIR, "archive"), prices))
    lam = float(os.environ.get("EU_FORECAST_LAMBDA", LC.PUBLISH_LAMBDA))          # what is PUBLISHED; 0 = the uncorrected model (shadow only)
    log(f"  level correction: {len(errors):,} day errors from the live archive; published lambda={lam} in {', '.join(LC.PUBLISH_ZONES) if LC.PUBLISH_ZONES else 'all zones'}, shadow lambda={LC.LAMBDA}")
    level_corr = (lambda z, h, d: LC.correction(errors, z, h, d, lam) if LC.publishes(z) else 0.0) if lam > 0 else None
    shadow_corr = lambda z, h, d: LC.correction(errors, z, h, d, LC.LAMBDA)
    wrote, skipped, latest = 0, [], {}
    for z in zones:
        try:
            m = (live_aug["zone"] == z).to_numpy()
            if not m.any():
                skipped.append(z)
                log(f"  {z}: nothing to publish (stale prices)")
                continue
            zr = live_aug[m].reset_index(drop=True)
            part = {k: np.asarray(v)[m] for k, v in preds.items()}
            point = RC.point_forecast(z, part, fuel_ok, day_ids=(zr["date"].dt.strftime("%Y-%m-%d") + "_" + zr["h"].astype(str)).to_numpy())
            ridge = part["lear_fuel" if fuel_ok else "lear_nofuel"]
            if z not in RC.BALTICS and (np.isfinite(point) & ~np.isfinite(ridge)).any():
                log(f"  {z}: {int((np.isfinite(point) & ~np.isfinite(ridge)).sum())} hours from the LightGBM alone (the ridge had a gap it could not bridge)")
            if not np.isfinite(point).all():          # a day with a missing hour is dropped by build_days: say why
                nan_h = sorted({int(h) for h in zr["h"][~np.isfinite(point)]})
                log(f"  {z}: no central estimate for {int((~np.isfinite(point)).sum())} hours (horizons {nan_h}; NaN per component: "
                    + ", ".join(f"{k} {int(np.isnan(v).sum())}" for k, v in part.items()) + ")")
            hs = G.published_horizons(gate, acc, z, fuel_ok)
            if not hs:
                skipped.append(z)
                log(f"  {z}: the gate lets no horizon through" + ("" if fuel_ok else " without fuel"))
                continue
            edges = None
            if cal is not None:
                # fuel on: the quantile models' own edges + the zone's offsets (the report's section-7 recipe). Fuel off: the quantile models
                # were not trained, so the band hangs on the central estimate with the residual offsets (calibrate_bands.py, 'nofuel' recipe).
                # A zone without offsets of the kind in use gets NO band; offsets of the other kind do not fit this central estimate.
                if fuel_ok:
                    lo, hi = FC.offset_arrays(cal, "quantile", z, zr["h"])
                    edges = FC.band_edges(point, q_lo[m], q_hi[m], lo, hi)
                else:
                    lo, hi = FC.offset_arrays(cal, "residual", z, zr["h"])
                    edges = FC.band_edges(point, None, None, lo, hi)
            tz = ZoneInfo(ZONES[z][1])
            today = now.astimezone(tz).date()
            fdays = FC.build_days(zr, point, edges, hs, level_corr, shadow_corr)
            fdays = [d for d in fdays if all(PRICE_SANITY[0] <= p["eur_mwh"] <= PRICE_SANITY[1] for p in d["prices"])]
            if not fdays:
                skipped.append(z)
                log(f"  {z}: nothing to publish (no finite forecast for a published horizon)")
                continue
            block = G.accuracy_block(acc, z, fuel_ok, {d["horizon"] for d in fdays})
            if block is None:
                skipped.append(z)
                log(f"  {z}: no accuracy numbers for the horizons: not published")
                continue
            pl = FC.payload(z, fdays, today, trained_through, now.isoformat(timespec="seconds"), block, RC.recipe_for(z, fuel_ok), fuel_ok and z not in RC.BALTICS)
            latest[z] = FC.archive_payload(pl, fdays)
            horizons = ",".join(str(d["horizon"]) for d in fdays)
            mean = np.mean([p["eur_mwh"] for d in fdays for p in d["prices"]])
            band = "with band" if "min_eur_mwh" in fdays[0]["prices"][0] else "NO band"
            if a.dry_run:
                log(f"  {z}: would write eu-forecast-{z}: {len(fdays)} days (h {horizons}), {RC.recipe_for(z, fuel_ok)}, {band}, mean {mean:.1f} EUR/MWh")
            else:
                kv.put(f"eu-forecast-{z}", pl, kv.FORECAST_TTL, acct, cf)
                arch = FC.archive_payload(pl, fdays)
                kv.put(f"eu-forecast-archive-{z}-{today.isoformat()}", arch, kv.ARCHIVE_TTL, acct, cf)
                os.makedirs(os.path.join(DIR, "archive"), exist_ok=True)
                with open(os.path.join(DIR, "archive", f"{z}-{today.isoformat()}.json"), "w", encoding="utf-8") as fh:
                    json.dump(arch, fh)
                log(f"  {z}: wrote eu-forecast-{z} (+ archive): {len(fdays)} days (h {horizons}), {RC.recipe_for(z, fuel_ok)}, {band}, mean {mean:.1f} EUR/MWh")
            wrote += 1
            time.sleep(0.2)
        except Exception as e:
            skipped.append(z)
            log(f"  {z}: FAILED (non-fatal): {type(e).__name__}: {e}")
    # a local copy of what was (or, in a dry run, would have been) published: for looking at, never read by the site
    with open(os.path.join(DIR, "forecast_latest.json"), "w", encoding="utf-8") as f:
        json.dump(latest, f)
    log(f"DONE {wrote}/{len(zones)} zones" + (f", skipped: {', '.join(skipped)}" if skipped else "") + f" ({time.time() - t0:.0f}s)")
    return 3 if (len(zones) == len(ZONES) and wrote < MIN_ZONES) else 0


if __name__ == "__main__":
    sys.exit(main())
