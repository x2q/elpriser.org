#!/usr/bin/env python3
"""Assemble a Hugging Face model repo from an export (export_eu.py / export_gb.py) and upload it.

    python3 stage.py assemble eu --publish ~/hf-publish/out/eu/publish --stage ~/hf-publish/stage/eu-price-forecast [--no-readme]
    python3 stage.py upload   eu --stage ~/hf-publish/stage/eu-price-forecast [--no-readme] [--tag snapshot-2026-11-09] [--dry-run]

`assemble` copies the repo's own files (inference code, requirements, DATA_LICENCES.md, and - unless --no-readme - the model card with its tables filled in from the gate
files next to it) around the exported weights/, gate/ and code/. It then runs the GUARD below and refuses to continue if anything it finds should not be on the Hub.
`upload` re-runs the guard on exactly what is in --stage, pushes it in ONE commit (the README only without --no-readme, so a weekly weight refresh never overwrites a
hand-reviewed card) and optionally tags the commit. The token is read from HF_TOKEN or ~/.cache/huggingface/token and never printed.
"""
import argparse
import os
import re
import shutil
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import card_tables as CT  # noqa: E402

REPOS = {"eu": "Elpriser/eu-price-forecast", "gb": "Elpriser/gb-price-estimate", "eu-fuel": "Elpriser/eu-price-forecast-fuel"}
PRIVATE = {"eu-fuel"}                    # repos that are uploaded private and checked to still be private afterwards
OWN = {"eu": ["eu_infer.py", "predict_eu.py", "requirements.txt"], "gb": ["gb_infer.py", "predict_gb.py", "requirements.txt"],
       "eu-fuel": ["eu_infer.py", "eu_infer_fuel.py", "predict_eu.py", "predict_eu_fuel.py", "requirements.txt"]}

# What must never reach the Hub from these repos (the licences of the fuel inputs are unconfirmed, nothing is pickled, no credentials).
# The PRIVATE fuel-weights repo may carry the fuel-trained weights, but never a data file of any kind, and nothing from the fuel providers.
FORBIDDEN_NAME = re.compile(r"fuel_daily|held|lgb_fuel|ridge_fuel|q10|q90.*fuel|\.csv$|\.parquet$|\.pkl$|\.pickle$|\.env|\.token", re.I)
FORBIDDEN_NAME_PRIVATE = re.compile(r"fuel_daily|held|\.csv$|\.xlsx?$|\.parquet$|\.pkl$|\.pickle$|\.env|\.token|fixtures|mibgas_data|eua.*report", re.I)
FORBIDDEN_TEXT = re.compile(r"securityToken=[A-Za-z0-9-]{8,}|hf_[A-Za-z0-9]{20,}|cfat_[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9._-]{16,}|CLOUDFLARE_API_TOKEN=\S{8,}|ENTSOE_TOKEN=\S{8,}|HF_TOKEN=\S{8,}")
ALLOWED_FUEL_NAMES = {"fuel_features.py"}      # feature-definition CODE of the production recipe (no data): imported by recipe.py


def guard(stage, kind):
    """Raise SystemExit listing every problem; return the list of files that will be uploaded."""
    problems, files = [], []
    for root, _, names in os.walk(stage):
        for n in names:
            p = os.path.join(root, n)
            rel = os.path.relpath(p, stage)
            if rel.startswith(".cache") or "__pycache__" in rel:
                continue
            files.append(rel)
            if (FORBIDDEN_NAME_PRIVATE if kind in PRIVATE else FORBIDDEN_NAME).search(rel) and n not in ALLOWED_FUEL_NAMES:
                problems.append(f"forbidden file name: {rel}")
                continue
            if os.path.getsize(p) > 25_000_000:
                problems.append(f"too large: {rel}")
            if n.endswith((".txt", ".json", ".py", ".md")):
                with open(p, encoding="utf-8", errors="replace") as fh:
                    text = fh.read()
                m = FORBIDDEN_TEXT.search(text)
                if m:
                    problems.append(f"credential-like text in {rel}")
                if n == "config.json" and re.search(r'"fuel"\s*:\s*true', text) and kind not in PRIVATE:
                    problems.append(f"{rel} declares a fuel-trained model")
    if kind in PRIVATE:
        import json
        fc = os.path.join(stage, "weights", "fuel", "config.json")
        if not os.path.exists(fc) or "WITH gas and carbon" not in open(fc, encoding="utf-8").read():
            problems.append("weights/fuel/config.json is missing or is not the fuel-trained model")
        for must in ("weights/lgb_base.txt", "gate_fuel/publish_gate.json", "gate_fuel/accuracy_eu.json", "gate_fuel/calibration_eu.json", "README.md"):
            if not os.path.exists(os.path.join(stage, must)):
                problems.append(f"{must} is missing")
        readme = os.path.join(stage, "README.md")
        if os.path.exists(readme) and "PRIVATE" not in open(readme, encoding="utf-8").read():
            problems.append("the card does not say the repo is private")
    if kind == "eu":
        import json
        cfgp = os.path.join(stage, "weights", "config.json")
        if os.path.exists(cfgp):
            with open(cfgp, encoding="utf-8") as fh:
                cfg = json.load(fh)
            if cfg.get("model") != "eu-ens-v2-nofuel":
                problems.append("weights/config.json is not the fuel-free model")
            if any("gas" in f.lower() or "eua" in f.lower() or "ccgt" in f.lower() for f in cfg.get("lgb_features", []) + cfg.get("ridge_features", [])):
                problems.append("a gas / carbon feature is in the fuel-free feature lists")
        else:
            problems.append("weights/config.json is missing")
    if problems:
        raise SystemExit("GUARD FAILED, nothing will be uploaded:\n  " + "\n  ".join(problems))
    return sorted(files)


def assemble(kind, publish, stage, readme=True):
    if os.path.exists(stage):
        shutil.rmtree(stage)
    os.makedirs(stage)
    for sub in ("weights", "gate", "code"):
        shutil.copytree(os.path.join(publish, sub), os.path.join(stage, sub))
    for fn in OWN[kind]:
        shutil.copy(os.path.join(HERE, kind, fn), os.path.join(stage, fn))
    shutil.copy(os.path.join(HERE, "DATA_LICENCES.md"), os.path.join(stage, "DATA_LICENCES.md"))
    if readme:
        card = open(os.path.join(HERE, kind, "MODEL_CARD.md"), encoding="utf-8").read()
        gdir = os.path.join(stage, "gate")
        if kind == "eu":
            card = card.replace("ZONE_TABLE", CT.eu_zone_table(gdir))
        else:
            rest, days = CT.gb_tables(gdir)
            card = card.replace("GB_REST_TABLE", rest).replace("GB_DAYS_TABLE", days).replace("HOUR23_TABLE", CT.hour23_table(gdir))
        assert not re.search(r"ZONE_TABLE|GB_REST_TABLE|GB_DAYS_TABLE|HOUR23_TABLE", card), "an unfilled table placeholder"
        open(os.path.join(stage, "README.md"), "w", encoding="utf-8").write(card)
    files = guard(stage, kind)
    smoke(stage, kind)
    return files


def assemble_fuel(publish, held, stage):
    """The PRIVATE repo: everything of the public EU repo (fuel-free weights, stripped gate, code) plus the fuel-trained weights in weights/fuel/, the FULL gate files in gate_fuel/
    and the fuel-input code (fetch_fuel.py, fuel_live.py: code only). No data file of any kind; the guard enforces it."""
    import json
    if os.path.exists(stage):
        shutil.rmtree(stage)
    os.makedirs(stage)
    for sub in ("weights", "gate", "code"):
        shutil.copytree(os.path.join(publish, sub), os.path.join(stage, sub))
    fdir = os.path.join(stage, "weights", "fuel")
    os.makedirs(fdir)
    for fn in ("lgb_fuel.txt", "lgb_fuel_q10.txt", "lgb_fuel_q90.txt", "ridge_fuel.npz"):
        shutil.copy(os.path.join(held, fn), os.path.join(fdir, fn))
    with open(os.path.join(held, "config.json"), encoding="utf-8") as fh:
        cfg = json.load(fh)
    cfg.pop("HELD", None)
    cfg["PRIVATE"] = "internal repo: the gas and carbon data licences are not confirmed; weights only, no data"
    with open(os.path.join(fdir, "config.json"), "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=1)
    os.makedirs(os.path.join(stage, "gate_fuel"))
    for fn in ("publish_gate.json", "accuracy_eu.json", "calibration_eu.json"):
        shutil.copy(os.path.join(HERE, "..", "eu", fn), os.path.join(stage, "gate_fuel", fn))
    for fn in ("fetch_fuel.py", "fuel_live.py"):
        shutil.copy(os.path.join(HERE, "..", "eu", fn), os.path.join(stage, "code", fn))
    for fn in OWN["eu-fuel"]:
        shutil.copy(os.path.join(HERE, "eu", fn), os.path.join(stage, fn))
    shutil.copy(os.path.join(HERE, "DATA_LICENCES.md"), os.path.join(stage, "DATA_LICENCES.md"))
    shutil.copy(os.path.join(HERE, "eu", "MODEL_CARD_FUEL.md"), os.path.join(stage, "README.md"))
    files = guard(stage, "eu-fuel")
    smoke(stage, "eu-fuel")
    return files


def smoke(stage, kind):
    """Import the entry points with ONLY the staged repo on the path: a module the export forgot to copy fails here, not for the first user."""
    import subprocess
    mods = {"eu": "eu_infer, predict_eu", "gb": "gb_infer, predict_gb", "eu-fuel": "eu_infer, eu_infer_fuel, predict_eu_fuel"}[kind]
    r = subprocess.run([sys.executable, "-c", f"import sys; sys.dont_write_bytecode = True; sys.path.insert(0, {os.path.abspath(stage)!r}); import {mods}"],
                       capture_output=True, text=True, cwd=os.path.abspath(stage))
    if r.returncode != 0:
        raise SystemExit("SMOKE IMPORT FAILED, nothing will be uploaded:\n" + r.stderr[-1500:])


def token():
    t = os.environ.get("HF_TOKEN")
    if not t:
        p = os.path.expanduser("~/.cache/huggingface/token")
        t = open(p).read().strip() if os.path.exists(p) else None
    if not t:
        raise SystemExit("no Hugging Face token (HF_TOKEN or ~/.cache/huggingface/token)")
    return t


def upload(kind, stage, readme=True, tag=None, dry=False, message=None):
    files = guard(stage, kind)
    smoke(stage, kind)
    repo = REPOS[kind]
    today = date.today().isoformat()
    message = message or f"{'Initial release' if readme else 'Weekly weight snapshot'} {today}"
    print(f"{'would upload' if dry else 'uploading'} {len(files)} files to {repo}: " + ", ".join(files[:6]) + (" ..." if len(files) > 6 else ""))
    if dry:
        return
    from huggingface_hub import HfApi
    api = HfApi(token=token())
    private = kind in PRIVATE
    api.create_repo(repo, repo_type="model", exist_ok=True, private=private)
    if private:
        api.update_repo_settings(repo, private=True, repo_type="model")        # it must be private BEFORE anything is uploaded
        if not api.model_info(repo).private:
            raise SystemExit(f"{repo} is not private: nothing uploaded")
    ignore = None if readme else ["README.md"]
    info = api.upload_folder(repo_id=repo, repo_type="model", folder_path=stage, commit_message=message, ignore_patterns=ignore,
                             delete_patterns=["code/*", "gate/*", "gate_fuel/*", "weights/*"] if private else ["code/*", "gate/*", "weights/*"])
    if private and not api.model_info(repo).private:
        raise SystemExit(f"{repo} is public after the upload: fix it at once")
    print(f"  commit {getattr(info, 'oid', info)}")
    if tag:
        api.create_tag(repo, tag=tag, repo_type="model", exist_ok=True)
        print(f"  tag {tag}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", choices=["assemble", "upload"])
    ap.add_argument("kind", choices=list(REPOS))
    ap.add_argument("--publish")
    ap.add_argument("--held", help="eu-fuel only: the directory with the fuel-trained weights (export_eu.py --with-fuel: held-fuel/)")
    ap.add_argument("--stage", required=True)
    ap.add_argument("--no-readme", action="store_true")
    ap.add_argument("--tag")
    ap.add_argument("--message")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "assemble":
        files = assemble_fuel(a.publish, a.held, a.stage) if a.kind in PRIVATE else assemble(a.kind, a.publish, a.stage, readme=not a.no_readme)
        print(f"assembled {len(files)} files in {a.stage}; guard passed")
    else:
        upload(a.kind, a.stage, readme=not a.no_readme, tag=a.tag, dry=a.dry_run, message=a.message)
    return 0


if __name__ == "__main__":
    sys.exit(main())
