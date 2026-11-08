"""Longer ridge training window (research, COPY ~/eu-forecast-d257). The production ridge trains on the last 365 days; al and xk lose strongly with shorter windows
(al D+7 gain 90 d -5.5 %, 180 d 0.1 %, 365 d 7.0 %), so the question is whether MORE history helps: windows of 540 and 730 days (expanding until the data has that many days:
price and weather-as-issued history start 2024-03-15). Same frame, same folds, same level+shape baseline as zone_gate_frame.py; only the window differs."""
import os, sys, time
DIR = os.getcwd(); sys.path.insert(0, DIR)
import numpy as np, pandas as pd
import region_backtest as RB, family_backtest as FB
t0 = time.time()
def log(m): print(f"[{time.time()-t0:6.0f}s] {m}", flush=True)
A, prices = RB.build_frame()
A = A[~A["zone"].isin(set(RB.NORDIC))].reset_index(drop=True)
A = FB.add_lear_columns(A, prices)
V = {"lear_r365": (365, None, "ridge"), "lear_r540": (540, None, "ridge"), "lear_r730": (730, None, "ridge")}
P = FB.run_lear(A, step=7, jobs=int(os.environ.get("JOBS", "6")), log=log, variants=V)
P[["zone", "t", "h", "date"]] = A[["zone", "t", "h", "date"]]
P = P[P["date"] >= RB.EVAL_FROM].drop(columns="date")
P.to_parquet("exp6_lear.parquet", index=False)
log(f"wrote exp6_lear.parquet {len(P):,} rows: {[c for c in P.columns if c.startswith('lear')]}")
