#!/usr/bin/env python3
"""Export gb-est-v1 (and the hour-23 rule of Portugal and Ireland) from the files the estimate job already holds, without touching the job.

    PYTHONDONTWRITEBYTECODE=1 python3 export_gb.py --src ~/gb-estimate --out ~/hf-publish/out/gb [--reference]

READS (never writes) `--src`: models/gb_models.pkl (written by train_gb.py), the gate and calibration JSON, the price and weather caches. Writes only below `--out`:

    publish/weights/{lgb50.txt, lgb10.txt, lgb90.txt, ridge_gb.npz, config.json}      the LightGBM median / P10 / P90 and the 64 ridges (as-of hour x day offset)
    publish/gate/{gb_gate.json, gb_calibration.json, hour23_gate.json}
    publish/code/*.py                                                              the production modules the inference needs, verbatim
    ref/{frozen.pkl, pred.pkl}                                                     (--reference) frozen inputs and the production prediction, for verify_gb.py

The pickle is read only here, on the machine that wrote it; nothing pickled is published.
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
CODE_GB = ["gbfeat.py", "gbcal.py", "gbmodels.py", "gbjob.py", "hour23.py", "fetch_mid.py", "fetch_weather_gb.py"]
CODE_EU = ["fetch_weather.py", "zones.py"]                                      # the EU modules fetch_weather_gb reuses (request helpers, constants; the zone points)
CODE_PRICES = ["elexon_parse.py", "build_elexon_prices.py", "build_eu_prices.py", "energy_charts_parse.py"]


def log(m):
    print(m, flush=True)


def find(name, *dirs):
    for d in dirs:
        p = os.path.join(d, name)
        if os.path.exists(p):
            return p
    raise FileNotFoundError(name)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--src", default=os.path.expanduser("~/gb-estimate"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--reference", action="store_true")
    a = ap.parse_args(argv)
    src = os.path.abspath(a.src)
    sys.dont_write_bytecode = True
    sys.path.insert(0, src)
    import fetch_mid
    import fetch_weather_gb as FW
    import gbfeat as GF
    import gbjob as GJ

    now = datetime.now(timezone.utc)
    out = os.path.abspath(a.out)
    pub = os.path.join(out, "publish")
    for d in ("weights", "gate", "code"):
        os.makedirs(os.path.join(pub, d), exist_ok=True)
    with open(os.path.join(src, "models", "gb_models.pkl"), "rb") as f:
        m = pickle.load(f)
    age = (now - datetime.fromisoformat(m["built"])).days
    log(f"=== GB export {now:%Y-%m-%d %H:%M}Z: models built {m['built']} ({age} d old), trained through {m['trainedThrough']}, {m['rows']:,} rows ===")
    if age > GJ.MAX_MODEL_AGE_DAYS:
        log("the models are too old (train_gb.py stopped?): nothing exported")
        return 2
    for name in ("lgb50", "lgb10", "lgb90"):
        m[name].booster_.save_model(os.path.join(pub, "weights", name + ".txt"))
    keys = sorted(m["ridges"])
    cols = m["ridges"][keys[0]][0]
    assert all(m["ridges"][k][0] == cols for k in keys), "ridge cells with different design columns"
    np.savez_compressed(os.path.join(pub, "weights", "ridge_gb.npz"), keys=np.array([f"{a_}|{k_}" for a_, k_ in keys]), cols=np.array(cols),
                        mu=np.stack([m["ridges"][k][1][0] for k in keys]), sd=np.stack([m["ridges"][k][1][1] for k in keys]),
                        beta=np.stack([m["ridges"][k][1][2] for k in keys]), b0=np.array([m["ridges"][k][1][3] for k in keys]))
    cfg = {"model": GJ.MODEL_NAME, "snapshot": now.date().isoformat(), "generatedAt": m["built"], "exportedAt": now.isoformat(timespec="seconds"),
           "trainedThrough": m["trainedThrough"], "trainingRows": m["rows"], "ridge_cells": [f"{a_}|{k_}" for a_, k_ in keys], "ridge_features": cols,
           "lgb_features": GF.LGB_FEATS, "unit": "GBP/MWh", "recipe": "mean of a ridge (one per as-of hour and day offset) and a LightGBM, both on the residual of level+shape; "
           "P10/P90 from two LightGBM quantile models plus rolling offsets"}
    with open(os.path.join(pub, "weights", "config.json"), "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=1)
    for name in ("gb_gate.json", "gb_calibration.json", "hour23_gate.json"):
        shutil.copy(os.path.join(src, name), os.path.join(pub, "gate", name))
    eu_dir = os.path.join(os.path.expanduser("~/eu-forecast"))
    for fn in CODE_GB:
        shutil.copy(find(fn, src), os.path.join(pub, "code", fn))
    for fn in CODE_EU + CODE_PRICES:
        shutil.copy(find(fn, src, eu_dir), os.path.join(pub, "code", fn))
    log(f"  weights: {len(keys)} ridges x {len(cols)} features, 3 boosters")

    if a.reference:
        ref = os.path.join(out, "ref")
        os.makedirs(ref, exist_ok=True)
        tz = ZoneInfo("Europe/London")
        loc = now.astimezone(tz)
        today, hr = loc.date(), loc.hour
        price = fetch_mid.load(os.path.join(src, "price_gb.parquet"))
        price = price[price.index >= price.index.max() - pd.Timedelta(days=90)]
        wx = GF.live_local(FW.live())
        h = GJ.live_hist(price, wx, today, hr)
        rows = GJ.live_rows(h, today, hr)
        pred = GJ.predict(m, rows, json.load(open(os.path.join(src, "gb_calibration.json"))))
        with open(os.path.join(ref, "frozen.pkl"), "wb") as f:
            pickle.dump({"price": price, "wx": wx, "now": now.isoformat()}, f)
        pred[["k", "hr", "point", "lo", "hi"]].to_pickle(os.path.join(ref, "pred.pkl"))
        log(f"  reference: price through {price.index.max():%Y-%m-%d %H:00}, London {today} {hr:02d}:xx, {int(np.isfinite(pred['point']).sum())} finite hours")
    log("DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
