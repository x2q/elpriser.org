"""Does the P10-P90 band stay honest when the point is level-corrected?  Three bands on the same quantile backtest (fuel mode, 24 non-Baltic zones + Baltics as published):
  V0  production today: edges + offsets measured on unshifted edges, no correction anywhere (control)
  V1  consistent: edges shifted by the level correction, offsets measured on the SHIFTED edges (what calibrate_bands.py --regions now writes; what accuracy_eu.json's `coverage` reports)
  V2  what the weekly refresh_calibration.sh would write if it cannot see the correction: offsets from UNSHIFTED edges, the band then shifted by the correction (the daily job's rule)
Prints coverage (share of hours inside), mean width, whole backtest / since 2026-09-01.  python3 research_balkan/bl_band_check.py"""
import os, sys
sys.path.insert(0, os.getcwd())
import numpy as np, pandas as pd
import build_gate as BG, family_models as FM
from zones import ZONES
df = pd.read_parquet("regions_bl.parquet"); df["date"] = pd.to_datetime(df["date"])
d = BG.recipe_columns(df[df["zone"].isin(list(ZONES)) & df["h"].between(2, 7)].copy(), 0.5)
q = pd.read_parquet("backtest_q_fuel.parquet", columns=["zone", "t", "h", "date", "y", "q10", "q90"])
q["zone"] = q["zone"].astype(str); q["date"] = pd.to_datetime(q["date"]); q["t"] = pd.to_datetime(q["t"])
q = q[q["zone"].isin(list(ZONES)) & q["h"].between(2, 7)].merge(d[["zone", "t", "h", "corr_fuel"]], on=["zone", "t", "h"], how="left")
q["corr_fuel"] = q["corr_fuel"].fillna(0.0)
q = q.sort_values(["zone", "h", "date"]).reset_index(drop=True)
def band(frame, a, b):
    lo, _ = FM.rolling_residual_band(frame.assign(q10=a), "q10"); _, hi = FM.rolling_residual_band(frame.assign(q90=b), "q90")
    return lo, hi
res = {}
lo0, hi0 = band(q, q["q10"], q["q90"]); res["V0 control"] = (lo0, hi0)
qs = q.assign(q10=q["q10"] + q["corr_fuel"], q90=q["q90"] + q["corr_fuel"])
lo1, hi1 = band(qs, qs["q10"], qs["q90"]); res["V1 consistent"] = (lo1, hi1)
res["V2 offsets unshifted, band shifted"] = (lo0 + q["corr_fuel"], hi0 + q["corr_fuel"])
bal = q["zone"].isin(["me", "mk", "rs", "xk", "al", "gr"])
print(f"{'':36s} coverage whole / since 09-01  (Balkan six: whole / since 09-01)   width mean EUR/MWh")
for k, (lo, hi) in res.items():
    ok = lo.notna() & hi.notna()
    inside = ((q["y"] >= lo) & (q["y"] <= hi)) & ok
    rec = q["date"] >= "2026-09-01"
    f = lambda m: float(inside[m & ok].mean())
    print(f"{k:36s} {f(q.zone != ''):.3f} / {f(rec):.3f}   ({f(bal):.3f} / {f(bal & rec):.3f})   {float((hi - lo)[ok].mean()):.1f}")
