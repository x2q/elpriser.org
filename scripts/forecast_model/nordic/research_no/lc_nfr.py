#!/usr/bin/env python3
"""Candidate 'level correction' (eu/level_correction.py: lambda 0.5 x the mean day-level error of the same zone and horizon over the 14 settled days known at issue)
applied to a recipe column; writes cand_<name>.parquet for nfr.py merge.   python3 lc_nfr.py "r730+lrel13" ens730lc [--lam 0.5]"""
import argparse
import os
import sys

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import level_correction as LC     # noqa: E402
import score_nfr as SN            # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("expr")
ap.add_argument("name")
ap.add_argument("--lam", type=float, default=0.5)
a = ap.parse_args()
df = SN.load([a.expr], None)
df = df.dropna(subset=[a.expr]).copy()
df["p_raw"] = df[a.expr]
corr = LC.apply_to_backtest(df, a.lam, col="p_raw")
df[a.name] = df["p_raw"] + corr
df[["zone", "t", "h", a.name]].to_parquet(os.path.join(DIR, f"cand_{a.name}.parquet"), index=False)
print(f"cand_{a.name}.parquet: {len(df):,} rows, mean correction {np.mean(corr):.2f}, mean |correction| {np.mean(np.abs(corr)):.2f} EUR/MWh")
