"""Inference for gb-est-v1 (Great Britain: the hours of today that have no price yet, and D+1 .. D+7) from the published weights.

    estimate(price, wx_live, weights_dir, now)  ->  {"estimate": payload or None, "forecast": payload or None, "pred": DataFrame}

`price`    hourly Series of the Elexon Market Index Price (GBP/MWh) on the London wall clock (naive index), at least ~60 days (fetch_mid.pull builds it)
`wx_live`  the current Open-Meteo forecast for the three points, averaged, already on the London clock (gbfeat.live_local(fetch_weather_gb.live()))
This is run_estimate.run_gb with the models read from LightGBM text files and an .npz instead of a pickle; code/*.py is a copy of scripts/forecast_model/gb/
(+ the helpers it imports), unchanged.
"""
import json
import os
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
for p in (os.path.join(HERE, "code"), HERE):
    if os.path.isdir(p) and p not in sys.path:
        sys.path.insert(0, p)

import gbfeat as GF           # noqa: E402
import gbjob as GJ            # noqa: E402


class _Booster:
    """The slice of LGBMRegressor that gbmodels.predict_lgb uses."""

    def __init__(self, path):
        import lightgbm as lgb
        self.b = lgb.Booster(model_file=path)

    def predict(self, X):
        return self.b.predict(X)


def load_models(wdir):
    """-> the dict run_estimate.run_gb unpickles: ridges {(a, k): (cols, (mu, sd, beta, b0))}, lgb50 / lgb10 / lgb90, trainedThrough, built."""
    with open(os.path.join(wdir, "config.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    z = np.load(os.path.join(wdir, "ridge_gb.npz"), allow_pickle=False)
    cols = [str(c) for c in z["cols"]]
    ridges = {}
    for i, key in enumerate(z["keys"]):
        a, k = str(key).split("|")
        ridges[(int(a), int(k))] = (cols, (z["mu"][i].astype(np.float64), z["sd"][i].astype(np.float64), z["beta"][i].astype(np.float64), float(z["b0"][i])))
    return {"ridges": ridges, "lgb50": _Booster(os.path.join(wdir, "lgb50.txt")), "lgb10": _Booster(os.path.join(wdir, "lgb10.txt")),
            "lgb90": _Booster(os.path.join(wdir, "lgb90.txt")), "trainedThrough": cfg["trainedThrough"], "built": cfg["generatedAt"]}


def load_gate(wdir):
    gdir = os.path.join(os.path.dirname(os.path.abspath(wdir)), "gate")
    out = {}
    for name in ("gb_gate", "gb_calibration", "hour23_gate"):
        with open(os.path.join(gdir, name + ".json"), encoding="utf-8") as f:
            out[name] = json.load(f)
    return out


def estimate(price, wx_live, weights_dir, now=None):
    now = now or datetime.now(timezone.utc)
    models, g = load_models(weights_dir), load_gate(weights_dir)
    loc = now.astimezone(ZoneInfo("Europe/London"))
    today, hr = loc.date(), loc.hour
    h = GJ.live_hist(price, wx_live, today, hr)
    rows = GJ.live_rows(h, today, hr)
    if rows.empty:
        return {"estimate": None, "forecast": None, "pred": rows}
    pred = GJ.predict(models, rows, g["gb_calibration"])
    generated = now.isoformat(timespec="seconds")
    return {"estimate": GJ.build_estimate(pred, g["gb_gate"], h, today, hr, generated),
            "forecast": GJ.build_forecast(pred, g["gb_gate"], today, generated, models["trainedThrough"]), "pred": pred}
