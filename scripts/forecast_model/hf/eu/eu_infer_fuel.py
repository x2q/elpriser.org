"""Inference for eu-ens-v2 AS IT RUNS IN PRODUCTION, i.e. with the gas and carbon inputs. PRIVATE repo only.

    forecast_fuel(prices, live, fuel_table, weights_dir)  ->  {zone: payload}

Same inputs as eu_infer.forecast plus `fuel_table`: the daily fuel table that fuel_live.load(csv, today, refresh=False) returns for a `fuel_daily.csv` that YOU build with
fetch_fuel.py from sources YOU are licensed to use. No fuel data is in this repo, and none may be added to it.
Central estimate: zones other than EE, LV, LT = mean of the ridge (fuel design) and the LightGBM with fuel; EE, LV, LT = the fuel-free LightGBM. The P10 / P90 band comes from the
fuel-trained quantile LightGBMs plus the offsets of gate/calibration_eu.json (kind 'quantile') for every zone. The production implementation is train_daily.py in the GitHub repository.
"""
import json
import os
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
for p in (os.path.join(HERE, "code"), HERE):
    if os.path.isdir(p) and p not in sys.path:
        sys.path.insert(0, p)

import eu_infer as EI         # noqa: E402
import forecast as FC         # noqa: E402
import gate as G              # noqa: E402
import recipe as RC           # noqa: E402
from zones import ZONES       # noqa: E402


def load_fuel_weights(wdir):
    import lightgbm as lgb
    fdir = os.path.join(wdir, "fuel")
    with open(os.path.join(fdir, "config.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    z = np.load(os.path.join(fdir, "ridge_fuel.npz"), allow_pickle=False)
    ridge = {}
    for i, key in enumerate(z["keys"]):
        zone, h = str(key).split("|")
        ridge[(zone, int(h))] = (z["mu"][i].astype(np.float64), z["sd"][i].astype(np.float64), z["beta"][i].astype(np.float64), float(z["ym"][i]))
    gdir = os.path.join(os.path.dirname(os.path.abspath(wdir)), "gate_fuel")     # the FULL gate files (the public `gate/` has the fuel entries stripped)
    return {"cfg": cfg, "lgb_fuel": lgb.Booster(model_file=os.path.join(fdir, "lgb_fuel.txt")), "q10": lgb.Booster(model_file=os.path.join(fdir, "lgb_fuel_q10.txt")),
            "q90": lgb.Booster(model_file=os.path.join(fdir, "lgb_fuel_q90.txt")), "ridge": ridge, "cols": [str(c) for c in z["cols"]],
            "gate": G.load_gate(os.path.join(gdir, "publish_gate.json")), "acc": G.load_accuracy(os.path.join(gdir, "accuracy_eu.json")),
            "cal": G.load_calibration(os.path.join(gdir, "calibration_eu.json"))}


def model_columns_fuel(rows, prices, fuel_table, w, base):
    """-> (augmented rows with the fuel columns, dict lgb_base / lgb_fuel / lear_fuel / q10 / q90 aligned to them)."""
    rows_f = RC.add_fuel_columns(rows, fuel_table)
    X = rows_f.copy()
    X["zone"] = pd.Categorical(X["zone"], categories=list(ZONES))
    lvl = X["level_7d"].to_numpy()
    feats = w["cfg"]["lgb_features"]
    cols = {"lgb_base": base["booster"].predict(X[base["cfg"]["lgb_features"]]) + lvl,
            "lgb_fuel": w["lgb_fuel"].predict(X[feats]) + lvl, "q10": w["q10"].predict(X[feats]) + lvl, "q90": w["q90"].predict(X[feats]) + lvl}
    aug = RC.augment(rows_f, prices, RC.RM.day_tables(prices))
    need = aug["zone"].isin([z for z in ZONES if z not in RC.BALTICS])
    lear = pd.Series(np.nan, index=aug.index)
    if need.any():
        lear[need] = EI.ridge_predict_stored(w["ridge"], w["cols"], aug[need], fuel=True)
    cols["lear_fuel"] = lear.to_numpy()
    return aug, cols


def forecast_fuel(prices, live, fuel_table, weights_dir, now=None, zones=None, log=print):
    now = now or datetime.now(timezone.utc)
    w = load_fuel_weights(weights_dir)
    base = EI.load_weights(weights_dir)               # lgb_base.txt + config.json (the fuel-free LightGBM the Baltics use); its ridge file is not needed here
    rows = EI.live_rows(prices, live, now)
    if rows.empty:
        return {}
    aug, cols = model_columns_fuel(rows, prices, fuel_table, w, base)
    trained_through = datetime.fromisoformat(w["cfg"]["trainedThrough"]).date()
    out = {}
    for z in (zones or list(ZONES)):
        m = (aug["zone"] == z).to_numpy()
        if not m.any():
            continue
        zr = aug[m].reset_index(drop=True)
        part = {k: np.asarray(v)[m] for k, v in cols.items()}
        point = RC.point_forecast(z, part, True, day_ids=(zr["date"].dt.strftime("%Y-%m-%d") + "_" + zr["h"].astype(str)).to_numpy())
        hs = G.published_horizons(w["gate"], w["acc"], z, True)
        if not hs:
            continue
        edges = None
        if w["cal"] is not None:
            lo, hi = FC.offset_arrays(w["cal"], "quantile", z, zr["h"])
            edges = FC.band_edges(point, part["q10"], part["q90"], lo, hi)
        today = now.astimezone(ZoneInfo(ZONES[z][1])).date()
        fdays = FC.build_days(zr, point, edges, hs)
        fdays = [d for d in fdays if all(-500.0 <= p["eur_mwh"] <= 4000.0 for p in d["prices"])]
        if not fdays:
            continue
        block = G.accuracy_block(w["acc"], z, True, {d["horizon"] for d in fdays})
        if block is None:
            continue
        out[z] = FC.payload(z, fdays, today, trained_through, now.isoformat(timespec="seconds"), block, RC.recipe_for(z, True), z not in RC.BALTICS)
    return out
