#!/usr/bin/env python3
"""Export the weights of eu-ens-v2 from the data the EU job already holds, without touching the job.

    PYTHONDONTWRITEBYTECODE=1 python3 export_eu.py --src ~/eu-forecast --out ~/hf-publish/out/eu [--with-fuel] [--reference]

READS (never writes) the production directory `--src`: the code, the price and weather caches, the gate files. Writes only below `--out`:

    publish/weights/{lgb_base.txt, ridge_nofuel.npz, config.json}     the FUEL-FREE models: the LightGBM and the 25 x 6 ridges (the Baltics use only the LightGBM)
    publish/gate/{publish_gate.json, accuracy_nofuel.json, calibration_residual.json}   what is published and what it is worth (fuel entries stripped)
    publish/code/*.py                                                  the production modules the inference needs, copied verbatim
    held-fuel/                                                         (--with-fuel) the models trained WITH the MIBGAS gas and EEX carbon inputs. NEVER
                                                                       uploaded: their data licences are unconfirmed (docs/forecast-runbook.md)
    ref/{prices.pkl, live.pkl, point_nofuel.npy, rows.pkl}             (--reference) the frozen inputs and the production code path's central estimate, for verify_eu.py

The models are the ones train_daily.py would fit today (same rows, same parameters); a parity check against recipe.lear_predict (the production ridge) runs
at export time and aborts on a difference.
"""
import argparse
import json
import os
import pickle
import shutil
import sys
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))

# the production modules the published inference needs (copied verbatim; the inference imports them as they are)
CODE = ["zones.py", "features.py", "calendar_features.py", "region_models.py", "family_models.py", "fuel_features.py", "recipe.py", "forecast.py", "gate.py",
        "fetch_prices.py", "fetch_weather.py", "entsoe_parse.py", "energy_charts_parse.py"]


def log(m):
    print(m, flush=True)


def fit_ridges(RC, FM, history, live, fuel):
    """recipe.lear_predict's training loop, keeping the fitted models: {(zone, h): (mu, sd, beta, intercept)} and the design columns."""
    Xl = RC.lear_design(live, fuel)
    cols = list(Xl.columns)
    hist = history[history["h"].isin(live["h"].unique())]
    models, meta = {}, {}
    for (z, h), g in live.groupby(["zone", "h"]):
        first = g["date"].min()
        end = first - pd.Timedelta(days=int(h))
        tr = hist[(hist["zone"] == z) & (hist["h"] == h) & (hist["date"] <= end) & (hist["date"] > end - pd.Timedelta(days=RC.LEAR_WINDOW_DAYS))]
        if len(tr) < RC.LEAR_MIN_ROWS:
            continue
        Xt = RC.lear_design(tr, fuel).to_numpy(np.float64)
        yt = (tr["y"] - tr["b_lvlshape"]).to_numpy(np.float64)
        ok = np.isfinite(Xt).all(axis=1) & np.isfinite(yt)
        if ok.sum() < RC.LEAR_MIN_ROWS:
            continue
        models[(str(z), int(h))] = FM.ridge_fit(Xt[ok], yt[ok], np.ones(int(ok.sum())))
        meta[f"{z}|{h}"] = {"windowEnd": end.date().isoformat(), "rows": int(ok.sum())}
    return models, cols, meta


def save_ridges(path, models, cols):
    keys = sorted(models)
    np.savez_compressed(path, keys=np.array([f"{z}|{h}" for z, h in keys]), cols=np.array(cols),
                        mu=np.stack([models[k][0] for k in keys]), sd=np.stack([models[k][1] for k in keys]),
                        beta=np.stack([models[k][2] for k in keys]), ym=np.array([models[k][3] for k in keys]))


def strip_gate(src, out):
    """The three gate files with every fuel entry removed (numbers of the fuel-trained model are not part of the fuel-free release)."""
    with open(os.path.join(src, "publish_gate.json"), encoding="utf-8") as f:
        g = json.load(f)
    g["zones"] = {z: {"recipe": v["recipe"], "nofuel": v["nofuel"]} for z, v in g["zones"].items()}
    with open(os.path.join(src, "accuracy_eu.json"), encoding="utf-8") as f:
        a = json.load(f)
    a["zones"] = {z: {"recipe": v["recipe"], "showEur": v["showEur"], "nofuel": v["nofuel"]} for z, v in a["zones"].items()}
    a["recipes"] = {k: v for k, v in a["recipes"].items() if k != "ens"}
    with open(os.path.join(src, "calibration_eu.json"), encoding="utf-8") as f:
        c = json.load(f)
    c["quantile"] = {}                          # the quantile edges belong to the fuel-trained LightGBM models
    os.makedirs(out, exist_ok=True)
    for name, obj in (("publish_gate.json", g), ("accuracy_nofuel.json", a), ("calibration_residual.json", c)):
        with open(os.path.join(out, name), "w", encoding="utf-8") as f:
            json.dump(obj, f, indent=1)
    return g, a, c


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--src", default=os.path.expanduser("~/eu-forecast"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--with-fuel", action="store_true", help="also fit and save the fuel-trained models into held-fuel/ (never uploaded)")
    ap.add_argument("--reference", action="store_true", help="save the frozen inputs and the production central estimate for verify_eu.py")
    ap.add_argument("--jobs", type=int, default=int(os.environ.get("EU_FORECAST_JOBS", "8")))
    a = ap.parse_args(argv)
    src = os.path.abspath(a.src)
    sys.dont_write_bytecode = True
    sys.path.insert(0, src)
    import backtest as B
    import dataset as ds
    import family_models as FM
    import features as F
    import fetch_weather as W
    import forecast as FC
    import fuel_live as FL
    import recipe as RC
    import train_daily as TD
    from zones import ZONES

    t0 = time.time()
    now = datetime.now(timezone.utc)
    log(f"=== EU export {now:%Y-%m-%d %H:%M}Z from {src} ===")
    live = W.live()
    if len(live) < len(ZONES):
        log(f"live weather for {len(live)}/{len(ZONES)} zones: aborting")
        return 1
    log("Building dataset...")
    df = ds.build(out_dir=src, save=False)
    df["date"] = pd.to_datetime(df["t"]).dt.normalize()
    prices = ds.load_prices(src)
    days, eu = F.day_table(prices)
    parts = []
    for z in ZONES:
        tz = ZoneInfo(ZONES[z][1])
        today = now.astimezone(tz).date()
        r = FC.build_rows(z, prices[z], FC.live_weather_local(live, z), FC.live_regional_local(live, z), days[z], eu, today)
        if len(r):
            parts.append(r)
    rows = pd.concat(parts, ignore_index=True)
    log(f"  {len(df):,} training rows, {len(rows):,} live rows ({time.time() - t0:.0f}s)")

    out = os.path.abspath(a.out)
    pub = os.path.join(out, "publish")
    for d in ("weights", "gate", "code"):
        os.makedirs(os.path.join(pub, d), exist_ok=True)

    # ---- fuel-free LightGBM
    model_base, feats_base, tr_base = TD.fit_lgb(df, "rel", a.jobs)
    trained_through = TD.trained_through_of(tr_base)
    del tr_base
    model_base.booster_.save_model(os.path.join(pub, "weights", "lgb_base.txt"))
    log(f"  LightGBM (no fuel) fitted through {trained_through} ({time.time() - t0:.0f}s)")
    Xl = rows.copy()
    Xl["zone"] = pd.Categorical(Xl["zone"], categories=list(ZONES))
    lgb_base = TD.lgb_predict(model_base, feats_base, Xl)

    # ---- fuel-free ridges
    need_lear = [z for z in ZONES if z not in RC.BALTICS]
    cut = rows["date"].min() - pd.Timedelta(days=TD.LEAR_HISTORY_DAYS)
    hist = df[(df["date"] >= cut) & (df["h"] <= RC.H_MAX) & df["y"].notna() & df["zone"].isin(need_lear)].copy()
    tables = RC.RM.day_tables(prices)
    hist_aug = RC.augment(hist, prices, tables)
    live_aug = RC.augment(rows, prices, tables)
    sel = live_aug["zone"].isin(need_lear)
    models, cols, meta = fit_ridges(RC, FM, hist_aug, live_aug[sel], False)
    save_ridges(os.path.join(pub, "weights", "ridge_nofuel.npz"), models, cols)
    log(f"  {len(models)} ridges (zone x horizon), {len(cols)} features ({time.time() - t0:.0f}s)")

    # ---- parity with the production ridge (recipe.lear_predict) on the live rows
    prod = RC.lear_predict(hist_aug, live_aug[sel], False)
    sys.path.insert(0, HERE)
    sys.path.insert(0, os.path.join(HERE, "eu"))
    import eu_infer as EI
    mine = EI.ridge_predict_stored(models, cols, live_aug[sel])
    both = np.isfinite(prod.to_numpy()) & np.isfinite(mine.to_numpy())
    same_nan = (np.isfinite(prod.to_numpy()) == np.isfinite(mine.to_numpy())).all()
    diff = float(np.abs(prod.to_numpy()[both] - mine.to_numpy()[both]).max()) if both.any() else float("nan")
    log(f"  ridge parity vs recipe.lear_predict: max |diff| {diff:.2e} EUR/MWh on {int(both.sum())} hours, same NaN pattern: {same_nan}")
    if not (same_nan and diff < 1e-6):
        log("PARITY FAILED: nothing exported")
        return 2

    cfg = {"model": "eu-ens-v2-nofuel", "recipe": "mean of a LightGBM (pooled over the zones) and a per-zone-and-horizon ridge on the residual of level+shape; "
           "EE, LV, LT: the LightGBM alone. Without gas and carbon inputs.",
           "snapshot": now.date().isoformat(), "generatedAt": now.isoformat(timespec="seconds"), "trainedThrough": trained_through.isoformat(),
           "lgb_features": feats_base, "lgb_target": "price - level_7d", "lgb_params": B.PARAMS, "ridge_window_days": RC.LEAR_WINDOW_DAYS,
           "ridge_min_rows": RC.LEAR_MIN_ROWS, "ridge_alpha_rel": 0.005, "ridge_features": cols, "ridges": meta, "horizons": [RC.H_MIN, RC.H_MAX],
           "zones": list(ZONES), "baltics": list(RC.BALTICS), "imputable": list(RC.IMPUTABLE), "max_imputed": RC.MAX_IMPUTED,
           "unit": "EUR/MWh"}
    with open(os.path.join(pub, "weights", "config.json"), "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=1)
    strip_gate(src, os.path.join(pub, "gate"))
    for fn in CODE:
        p = os.path.join(src, fn)
        if not os.path.exists(p):                      # the two parsers sit one directory over in the repo
            p = os.path.join(src, "..", "..", "eu_prices", fn)
        shutil.copy(p, os.path.join(pub, "code", fn))

    # ---- the reference: the production code path's central estimate on frozen inputs
    if a.reference:
        ref = os.path.join(out, "ref")
        os.makedirs(ref, exist_ok=True)
        zr = live_aug.reset_index(drop=True)
        lear = np.full(len(zr), np.nan)
        lear[sel.to_numpy()] = prod.to_numpy()
        point = np.full(len(zr), np.nan)
        for z in ZONES:
            m = (zr["zone"] == z).to_numpy()
            part = {"lgb_base": lgb_base[m], "lear_nofuel": lear[m]}      # live_aug has the order and length of `rows`
            point[m] = RC.point_forecast(z, part, False, day_ids=(zr.loc[m, "date"].dt.strftime("%Y-%m-%d") + "_" + zr.loc[m, "h"].astype(str)).to_numpy())
        np.save(os.path.join(ref, "point_nofuel.npy"), point)
        with open(os.path.join(ref, "prices.pkl"), "wb") as f:
            pickle.dump(prices, f)
        with open(os.path.join(ref, "live.pkl"), "wb") as f:
            pickle.dump(live, f)
        with open(os.path.join(ref, "now.txt"), "w") as f:
            f.write(now.isoformat())
        log(f"  reference saved ({np.isfinite(point).sum():,} finite hours)")

    # ---- the held models (fuel): staged, never uploaded
    if a.with_fuel:
        table, fst = FL.load(os.path.join(src, "fuel_daily.csv"), now.date(), refresh=False, log=log)
        if table is None:
            log(f"  fuel unusable ({fst['reason']}): held models not exported")
        else:
            held = os.path.join(out, "held-fuel")
            os.makedirs(held, exist_ok=True)
            dff = RC.add_fuel_columns(df, table)
            rows_f = RC.add_fuel_columns(rows, table)
            m, f_, tr = TD.fit_lgb(dff, "rel+fuel", a.jobs)
            m.booster_.save_model(os.path.join(held, "lgb_fuel.txt"))
            for alpha, name in ((0.1, "lgb_fuel_q10.txt"), (0.9, "lgb_fuel_q90.txt")):
                mq, _, _ = TD.fit_lgb(dff, "rel+fuel", a.jobs, alpha)
                mq.booster_.save_model(os.path.join(held, name))
            del tr
            hist_f = RC.augment(dff[(dff["date"] >= cut) & (dff["h"] <= RC.H_MAX) & dff["y"].notna() & dff["zone"].isin(need_lear)].copy(), prices, tables)
            live_f = RC.augment(rows_f, prices, tables)
            selr = live_f["zone"].isin(need_lear)
            models_f, cols_f, meta_f = fit_ridges(RC, FM, hist_f, live_f[selr], True)
            save_ridges(os.path.join(held, "ridge_fuel.npz"), models_f, cols_f)
            with open(os.path.join(held, "config.json"), "w", encoding="utf-8") as fh:
                json.dump({"model": "eu-ens-v2 (production recipe, WITH gas and carbon inputs)", "HELD": "do not upload: MIBGAS / EEX licences unconfirmed",
                           "snapshot": now.date().isoformat(), "trainedThrough": trained_through.isoformat(), "lgb_features": f_, "ridge_features": cols_f, "ridges": meta_f}, fh, indent=1)
            log(f"  held fuel models saved ({len(models_f)} ridges, {time.time() - t0:.0f}s)")
    log(f"DONE ({time.time() - t0:.0f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
