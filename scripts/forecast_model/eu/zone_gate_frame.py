#!/usr/bin/env python3
"""Research only (docs/forecast-xk.md): run by zone_research.sh in a COPY of the job directory.

EU-only version of the research frame for the gate: baselines (region_backtest.build_frame), the two LightGBM columns (backtest.py rel / rel+fuel),
and LEAR-365 with and without fuel (family_backtest.run_lear, variant lear_r365 only) -> regions_zone.parquet. Same functions as the research pipeline; the
Nordic rows are dropped only because the recipe columns of EU zones do not depend on them (per-zone ridge)."""
import os, sys, time
DIR = os.getcwd(); sys.path.insert(0, DIR)
import numpy as np, pandas as pd
import region_backtest as RB, family_backtest as FB, region_models as RM
t0 = time.time()
def log(m): print(f"[{time.time()-t0:6.0f}s] {m}", flush=True)
A, prices = RB.build_frame()
nordic = set(RB.NORDIC)
A = A[~A["zone"].isin(nordic)].reset_index(drop=True)
log(f"frame {len(A):,} rows, zones {A.zone.nunique()}")
A = FB.add_lear_columns(A, prices)
P = FB.run_lear(A, step=7, jobs=int(os.environ.get("JOBS", "8")), log=log, variants={"lear_r365": FB.VARIANTS["lear_r365"]})
P[["zone", "t", "h", "date"]] = A[["zone", "t", "h", "date"]]
def merge_eu(A):
    for tag, f in (("base", "backtest_eu_rel.parquet"), ("fuel", "backtest_eu_rel_fuel.parquet")):
        d = pd.read_parquet(f, columns=["zone", "t", "h", "p_raw"])
        d["zone"] = d["zone"].astype(str); d["t"] = pd.to_datetime(d["t"])
        A = A.merge(d.drop_duplicates(["zone", "t", "h"]).rename(columns={"p_raw": f"lgb_{tag}"}), on=["zone", "t", "h"], how="left")
    return A
A = merge_eu(A)
keep = ["zone", "t", "date", "h", "hour", "y", "level_7d", "b_lag7", "b_seasonal", "b_persist", "b_lvlshape", "lgb_base", "lgb_fuel"]
out = A[keep].merge(P[["zone", "t", "h", "lear_r365", "lear_r365_g"]], on=["zone", "t", "h"], how="left")
out = out[out["date"] >= RB.EVAL_FROM]
out.to_parquet("regions_zone.parquet", index=False)
log(f"wrote regions_zone.parquet {len(out):,} rows; nulls: {out[['lgb_base','lgb_fuel','lear_r365','lear_r365_g']].isna().mean().round(3).to_dict()}")
