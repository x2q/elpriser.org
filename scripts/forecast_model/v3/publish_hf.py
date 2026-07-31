#!/usr/bin/env python3
"""Publish the freshly trained v3 boosters to Hugging Face.

Same living-repo pattern as v2: every successful daily run overwrites the
weights, so what is on the Hub is always what production is running. Called
from train_daily.py only after both areas have written their KV entries, and
wrapped there in its own try/except — an HF outage must not affect the site.
"""
import json
import os
import shutil

from huggingface_hub import HfApi

REPO_ID = "Elpriser/denmark-price-forecast"
V3DIR = os.path.dirname(os.path.abspath(__file__))


def publish(models_all, estimators_all, cal, cfg, feats_by_area, today, token):
    stage = f"{V3DIR}/.hf_stage"
    if os.path.exists(stage):
        shutil.rmtree(stage)
    os.makedirs(stage)

    for area, m in models_all.items():
        for name, reg in m.items():
            reg.booster_.save_model(f"{stage}/{area.lower()}_{name}.txt")
    for area, e in estimators_all.items():
        e["dk"].booster_.save_model(f"{stage}/wind_estimator_{area.lower()}.txt")
    any_area = next(iter(estimators_all))
    estimators_all[any_area]["de"].booster_.save_model(f"{stage}/wind_estimator_de.txt")

    json.dump(cal, open(f"{stage}/calibration_hourly.json", "w"), indent=1)
    json.dump({
        "model_version": "v3",
        "features_by_area": feats_by_area,
        "horizons": list(range(2, 10)),
        "quantiles": {"lo": 0.1, "md": 0.5, "hi": 0.9},
        "areas": list(models_all.keys()),
        # DK1 uses the interconnector-capacity block, DK2 does not — it made DK2
        # worse in backtest (two borders vs four, so less signal, more variance).
        "variant_by_area": cfg["variant_by_area"],
        "shape_blend": {"base_weight": 0.5,
                        "regime_guard_trigger": cfg["guard_trigger"],
                        "regime_guard_slope": cfg["guard_slope"]},
        "weather_points": 14,
        "last_trained": today.isoformat(),
    }, open(f"{stage}/config.json", "w"), indent=1)

    shutil.copy(f"{V3DIR}/MODEL_CARD.md", f"{stage}/README.md")
    for fn in ("train_daily.py", "dataset.py", "fetch_ntc.py", "fetch_weather_v3.py"):
        src = f"{V3DIR}/{fn}"
        if os.path.exists(src):
            shutil.copy(src, f"{stage}/{fn}")

    HfApi(token=token).upload_folder(
        repo_id=REPO_ID, repo_type="model", folder_path=stage,
        commit_message=f"v3 daily retrain {today.isoformat()}")
    shutil.rmtree(stage)
    print(f"  published to {REPO_ID}", flush=True)
