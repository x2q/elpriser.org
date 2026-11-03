#!/usr/bin/env python3
"""Weekly snapshot of the EU (fuel-free) and GB model weights to Hugging Face. Runs on the Spark; never touches the production jobs' files or schedules.

    python3 snapshot_hf.py [--kinds eu,gb] [--dry-run] [--readme]

For each kind: (1) export the weights from what the production job already holds (export_eu.py / export_gb.py READ the job's directory and write below
~/hf-publish/out); (2) assemble the repo in ~/hf-publish/stage and run the guard (no fuel files, no pickles, no credentials, imports work); (3) verify the staged
copy against the production code path on frozen inputs (verify_eu.py / verify_gb.py, exact agreement); (4) upload in ONE commit and tag it `snapshot-YYYY-MM-DD`.
Any failure stops that kind before the upload, so the Hub keeps the last good snapshot. The model card is NOT touched unless --readme (re-run that when the gate
files changed, i.e. after the research was redone); the hand-reviewed README stays as it is.

The fuel-trained EU weights are never exported here (export_eu.py is run WITHOUT --with-fuel): they are produced by hand, kept off the Hub until the MIBGAS and EEX
licences are confirmed in writing, and the stage guard rejects any file that looks like them.

Cron (NOT installed by this change; see docs/hf-publishing.md):  45 15 * * 0  /home/cc/hf-publish/snapshot_hf.sh
"""
import argparse
import json
import os
import subprocess
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get("HF_WORK", os.path.expanduser("~/hf-publish"))
SRC = {"eu": os.path.expanduser("~/eu-forecast"), "gb": os.path.expanduser("~/gb-estimate")}
NAME = {"eu": "eu-price-forecast", "gb": "gb-price-estimate"}


def log(m):
    print(m, flush=True)


def sh(cmd, env=None):
    log("  $ " + " ".join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1", **(env or {})})
    out = (r.stdout + r.stderr).strip().splitlines()
    for line in out[-12:]:
        log("    " + line)
    return r.returncode, "\n".join(out)


def complete(kind, publish):
    """The export must be whole: a snapshot with a zone or an as-of cell missing is worse than the previous one."""
    cfg = json.load(open(os.path.join(publish, "weights", "config.json"), encoding="utf-8"))
    if kind == "eu":
        want = 22 * 6
        if len(cfg["ridges"]) != want or len(cfg["zones"]) != 25:
            return f"{len(cfg['ridges'])} ridges instead of {want}"
    else:
        if len(cfg["ridge_cells"]) != 64:
            return f"{len(cfg['ridge_cells'])} ridge cells instead of 64"
    return None


def run(kind, a):
    out = os.path.join(WORK, "out", kind)
    stage = os.path.join(WORK, "stage", NAME[kind])
    py = sys.executable
    exp = ["export_eu.py", "export_gb.py"][kind == "gb"]
    rc, _ = sh([py, os.path.join(HERE, exp), "--src", SRC[kind], "--out", out, "--reference"])
    if rc:
        return f"{kind}: export failed (exit {rc})"
    pub = os.path.join(out, "publish")
    problem = complete(kind, pub)
    if problem:
        return f"{kind}: incomplete export: {problem}"
    cmd = [py, os.path.join(HERE, "stage.py"), "assemble", kind, "--publish", pub, "--stage", stage] + ([] if a.readme else ["--no-readme"])
    rc, txt = sh(cmd)
    if rc:
        return f"{kind}: assemble/guard failed"
    ver = ["verify_eu.py", "verify_gb.py"][kind == "gb"]
    rc, txt = sh([py, os.path.join(HERE, ver), "--pkg", stage, "--ref", os.path.join(out, "ref")])
    if rc or "VERIFY OK" not in txt:
        return f"{kind}: verification against the production code path failed"
    tag = f"snapshot-{date.today().isoformat()}"
    cmd = [py, os.path.join(HERE, "stage.py"), "upload", kind, "--stage", stage, "--tag", tag] + ([] if a.readme else ["--no-readme"]) + (["--dry-run"] if a.dry_run else [])
    rc, txt = sh(cmd)
    if rc:
        return f"{kind}: upload failed"
    return None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--kinds", default="eu,gb")
    ap.add_argument("--dry-run", action="store_true", help="export, assemble, guard and verify, but do not upload")
    ap.add_argument("--readme", action="store_true", help="also publish the README (model card with fresh tables)")
    a = ap.parse_args(argv)
    log(f"=== HF snapshot {date.today().isoformat()}{' (dry run)' if a.dry_run else ''} ===")
    failed = []
    for kind in a.kinds.split(","):
        err = run(kind, a)
        log(f"{kind}: {'OK' if err is None else 'FAILED: ' + err}")
        if err:
            failed.append(err)
    log("DONE" + (f", failed: {len(failed)}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
