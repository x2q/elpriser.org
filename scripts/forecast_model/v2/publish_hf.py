#!/usr/bin/env python3
"""Publicerer dagens friskt-trænede v2-boostere til HuggingFace Hub.

Kaldes fra train_daily.py efter en vellykket kørsel for begge områder.
LightGBM's eget tekstformat (Booster.save_model) bruges i stedet for pickle
— portabelt, ingen kodekørsel ved indlæsning, læsbart som diff.

Repoet er "levende": hver daglig kørsel overskriver boosterne + config.json
med den friskeste model (samme mønster som datasæt-repoerne, der også
opdateres løbende). MODEL_CARD.md kopieres ind uændret hver gang, så
redigeringer i git automatisk forplanter sig til HF ved næste kørsel.
"""
import json
import os
import shutil

from huggingface_hub import HfApi

REPO_ID = "Elpriser/denmark-price-forecast"
V2DIR = os.path.dirname(os.path.abspath(__file__))


def publish(models_all, estimators_all, cal_h, feats, today, token):
    """models_all: {area: {"lo":LGBMRegressor,"md":...,"hi":...}}
    estimators_all: {area: {"dk":LGBMRegressor, "de":LGBMRegressor}}"""
    stage = f"{V2DIR}/.hf_stage"
    if os.path.exists(stage):
        shutil.rmtree(stage)
    os.makedirs(stage)

    for area, m in models_all.items():
        for name, reg in m.items():
            reg.booster_.save_model(f"{stage}/{area.lower()}_{name}.txt")
    for area, e in estimators_all.items():
        e["dk"].booster_.save_model(f"{stage}/wind_estimator_{area.lower()}.txt")
    # DE-estimatoren er delt/identisk pr. område (samme kildedata) — gem én gang
    any_area = next(iter(estimators_all))
    estimators_all[any_area]["de"].booster_.save_model(f"{stage}/wind_estimator_de.txt")

    json.dump(cal_h, open(f"{stage}/calibration_hourly.json", "w"), indent=1)
    json.dump({
        "features": feats,
        "horizons": list(range(2, 10)),
        "quantiles": {"lo": 0.1, "md": 0.5, "hi": 0.9},
        "coords": {"dk1": [56.0, 9.5], "dk2": [55.5, 12.0], "de": [54.0, 9.5]},
        "areas": list(models_all.keys()),
        "last_trained": today.isoformat(),
    }, open(f"{stage}/config.json", "w"), indent=1)

    shutil.copy(f"{V2DIR}/MODEL_CARD.md", f"{stage}/README.md")
    for fn in ("train_daily.py", "dataset.py"):
        shutil.copy(f"{V2DIR}/{fn}", f"{stage}/{fn}")

    api = HfApi(token=token)
    api.upload_folder(repo_id=REPO_ID, repo_type="model", folder_path=stage,
                      commit_message=f"Daglig gentræning {today.isoformat()}")
    shutil.rmtree(stage)
    print(f"  publiceret til {REPO_ID}", flush=True)
