"""Inference for eu-ens-v2, the FUEL-FREE variant, from the published weights.

    forecast(prices, live, weights_dir)  ->  {zone: payload}

`prices`  {zone: hourly Series of day-ahead prices (EUR/MWh) on the zone's own wall clock, naive timestamps}; about 60 days of history is enough.
`live`    {zone: DataFrame(UTC hourly index; columns wind_speed_100m, direct_radiation, temperature_2m, precipitation)}: the current Open-Meteo
          forecast averaged over the zone's points (fetch_weather.live() builds it).
The recipe is the one in recipe.py: the mean of a LightGBM (pooled over the zones) and a per-zone-and-horizon ridge on the residual of the naive
"level + shape" forecast; EE, LV and LT use the LightGBM alone. The ridge coefficients in `ridge_nofuel.npz` are the ones fitted on the 365 days
before `config.json: trainedThrough`; production refits them every day, a snapshot ages (see the model card).
Everything below is the production code path (code/*.py is a copy of scripts/forecast_model/eu/), except that the ridge is applied from stored
coefficients instead of being fitted.
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

import features as F          # noqa: E402
import forecast as FC         # noqa: E402
import gate as G              # noqa: E402
import recipe as RC           # noqa: E402
from zones import ZONES       # noqa: E402


def load_weights(wdir):
    """-> dict(cfg, booster, ridge, cols, gate, acc, cal). Nothing is pickled: LightGBM text, an .npz without pickles, and JSON."""
    import lightgbm as lgb
    with open(os.path.join(wdir, "config.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    booster = lgb.Booster(model_file=os.path.join(wdir, "lgb_base.txt"))
    z = np.load(os.path.join(wdir, "ridge_nofuel.npz"), allow_pickle=False)
    cols = [str(c) for c in z["cols"]]
    ridge = {}
    for i, key in enumerate(z["keys"]):
        zone, h = str(key).split("|")
        ridge[(zone, int(h))] = (z["mu"][i].astype(np.float64), z["sd"][i].astype(np.float64), z["beta"][i].astype(np.float64), float(z["ym"][i]))
    gdir = os.path.join(os.path.dirname(os.path.abspath(wdir)), "gate")
    return {"cfg": cfg, "booster": booster, "ridge": ridge, "cols": cols,
            "gate": G.load_gate(os.path.join(gdir, "publish_gate.json")),
            "acc": G.load_accuracy(os.path.join(gdir, "accuracy_nofuel.json")),
            "cal": G.load_calibration(os.path.join(gdir, "calibration_residual.json"))}


def ridge_predict_stored(models, cols, live, impute=True):
    """recipe.lear_predict with the fitted ridges taken from `models` {(zone, h): (mu, sd, beta, intercept)} instead of fitted: the same design matrix,
    the same replacement of a missing hourly price lag by the training mean (at most RC.MAX_IMPUTED of the six per row), NaN where anything else is
    missing. Returns a Series aligned to live.index; `.attrs['imputed']` counts the replaced values."""
    import family_models as FM
    out = pd.Series(np.nan, index=live.index)
    out.attrs["imputed"] = 0
    if live.empty:
        return out
    Xl = RC.lear_design(live, False)
    if list(Xl.columns) != list(cols):
        raise ValueError("the ridge design matrix differs from the one the weights were fitted on")
    imp = [i for i, c in enumerate(cols) if c in RC.IMPUTABLE] if impute else []
    for (z, h), g in live.groupby(["zone", "h"]):
        model = models.get((str(z), int(h)))
        if model is None:
            continue
        Xg = Xl.loc[g.index].to_numpy(np.float64)
        if imp:
            nan = ~np.isfinite(Xg)
            fill = nan[:, imp]
            other = nan.copy()
            other[:, imp] = False
            usable = ~other.any(axis=1) & (fill.sum(axis=1) <= RC.MAX_IMPUTED)
            for k, j in enumerate(imp):
                m = fill[:, k] & usable
                Xg[m, j] = model[0][j]
                out.attrs["imputed"] += int(m.sum())
        good = np.isfinite(Xg).all(axis=1) & g["b_lvlshape"].notna().to_numpy()
        if good.any():
            out.loc[g.index[good]] = g.loc[g.index[good], "b_lvlshape"].to_numpy() + FM.linear_predict(model, Xg[good])
    return out


def live_rows(prices, live, now):
    """The feature rows of every zone's forecast days (24 hours x h = 2 .. 7), built by the production function."""
    days, eu = F.day_table(prices)
    parts = []
    for z in ZONES:
        if z not in prices or z not in live:
            continue
        today = now.astimezone(ZoneInfo(ZONES[z][1])).date()
        r = FC.build_rows(z, prices[z], FC.live_weather_local(live, z), FC.live_regional_local(live, z), days[z], eu, today)
        if len(r):
            parts.append(r)
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()


def model_columns(rows, prices, w):
    """-> (augmented live rows, dict of the model columns lgb_base / lear_nofuel aligned to them, number of imputed lags)."""
    Xl = rows.copy()
    Xl["zone"] = pd.Categorical(Xl["zone"], categories=list(ZONES))
    feats = w["cfg"]["lgb_features"]
    lgb_base = w["booster"].predict(Xl[feats]) + Xl["level_7d"].to_numpy()
    aug = RC.augment(rows, prices, RC.RM.day_tables(prices))
    need = aug["zone"].isin([z for z in ZONES if z not in RC.BALTICS])
    lear = pd.Series(np.nan, index=aug.index)
    imputed = 0
    if need.any():
        res = ridge_predict_stored(w["ridge"], w["cols"], aug[need])
        lear[need] = res
        imputed = res.attrs.get("imputed", 0)
    return aug, {"lgb_base": lgb_base, "lear_nofuel": lear.to_numpy()}, imputed


def forecast(prices, live, weights_dir, now=None, zones=None, log=print):
    """{zone: payload} in the shape of elpriser.org's `eu-forecast-<zone>` (forecast days D+2 .. D+7 that pass the gate; P10 / P90 as min_eur_mwh /
    max_eur_mwh; the accuracy block of exactly those horizons). A zone that cannot be forecast is absent from the result."""
    w = load_weights(weights_dir)
    now = now or datetime.now(timezone.utc)
    rows = live_rows(prices, live, now)
    if rows.empty:
        return {}
    aug, cols, imputed = model_columns(rows, prices, w)
    if imputed:
        log(f"  {imputed} missing price lags replaced by their training mean")
    trained_through = datetime.fromisoformat(w["cfg"]["trainedThrough"]).date()
    out = {}
    for z in (zones or list(ZONES)):
        m = (aug["zone"] == z).to_numpy()
        if not m.any():
            continue
        zr = aug[m].reset_index(drop=True)
        part = {k: np.asarray(v)[m] for k, v in cols.items()}
        point = RC.point_forecast(z, part, False, day_ids=(zr["date"].dt.strftime("%Y-%m-%d") + "_" + zr["h"].astype(str)).to_numpy())
        hs = G.published_horizons(w["gate"], w["acc"], z, False)
        if not hs:
            continue
        edges = None
        if w["cal"] is not None:
            lo, hi = FC.offset_arrays(w["cal"], "residual", z, zr["h"])
            edges = FC.band_edges(point, None, None, lo, hi)
        today = now.astimezone(ZoneInfo(ZONES[z][1])).date()
        fdays = FC.build_days(zr, point, edges, hs)
        fdays = [d for d in fdays if all(-500.0 <= p["eur_mwh"] <= 4000.0 for p in d["prices"])]
        if not fdays:
            continue
        block = G.accuracy_block(w["acc"], z, False, {d["horizon"] for d in fdays})
        if block is None:
            continue
        out[z] = FC.payload(z, fdays, today, trained_through, now.isoformat(timespec="seconds"), block, RC.recipe_for(z, False), False)
    return out
