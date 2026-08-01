#!/usr/bin/env python3
"""Publish the pooled 13-zone Nordic model to Hugging Face.

Same living-repo pattern as the Danish model: each successful daily run
overwrites the weights, so the Hub always holds what production is running.
Called from train_daily.py inside its own try/except — a Hub outage must not
affect the forecast itself.
"""
import json
import os
import shutil

from huggingface_hub import HfApi

REPO_ID = "Elpriser/nordic-price-forecast"
DIR = os.path.dirname(os.path.abspath(__file__))


def publish(models, cal, feats, zones, today, token):
    stage = f"{DIR}/.hf_stage"
    if os.path.exists(stage):
        shutil.rmtree(stage)
    os.makedirs(stage)

    for name, reg in models.items():
        reg.booster_.save_model(f"{stage}/pooled_{name}.txt")
    json.dump(cal, open(f"{stage}/calibration.json", "w"), indent=1)
    json.dump({
        "model_version": "nordic-pooled-v1",
        "zones": list(zones),
        "features": list(feats),
        "categorical": ["zone"],
        "horizons": list(range(2, 10)),
        "quantiles": {"lo": 0.1, "md": 0.5, "hi": 0.9},
        "unit": "EUR/MWh",
        "shape_blend": 0.5,
        # Bands are ADDITIVE residual quantiles, not scaled model quantiles —
        # see the model card for why scaling failed in the flat zones.
        "band_method": "empirical_residual_quantiles",
        "last_trained": today.isoformat(),
    }, open(f"{stage}/config.json", "w"), indent=1)

    shutil.copy(f"{DIR}/MODEL_CARD.md", f"{stage}/README.md")
    for fn in ("train_daily.py", "dataset.py", "backtest.py", "calibrate.py",
               "fetch_prices.py", "fetch_weather.py", "fetch_reservoir.py"):
        src = f"{DIR}/{fn}"
        if os.path.exists(src):
            shutil.copy(src, f"{stage}/{fn}")

    HfApi(token=token).upload_folder(
        repo_id=REPO_ID, repo_type="model", folder_path=stage,
        commit_message=f"Nordic pooled model, daily retrain {today.isoformat()}")
    shutil.rmtree(stage)
    print(f"  published to {REPO_ID}", flush=True)
