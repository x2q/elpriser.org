"""Build the gate / accuracy / calibration files with the UNCHANGED gate code for (control) the production recipe and (candidate) the same recipe with the published level correction,
on the same research frame (regions_bl.parquet, bl_gate_frame.py), and compare cell by cell.  python3 research_balkan/bl_gate.py [--lam 0.5]
Writes gate_ctrl/ and gate_cand/ (publish_gate.json, accuracy_eu.json, calibration_eu.json) and bl_cells.csv."""
import argparse, json, os, sys
sys.path.insert(0, os.getcwd())
import numpy as np, pandas as pd
import build_gate as BG, calibrate_bands as CB, gate as G
from zones import ZONES
ap = argparse.ArgumentParser(); ap.add_argument("--lam", type=float, default=0.5); a = ap.parse_args()
cols = ["zone", "t", "date", "h", "hour", "y", "level_7d", "b_lag7", "b_seasonal", "b_persist", "b_lvlshape", "lear_r365_g", "lear_r365", "lgb_fuel", "lgb_base"]
df = pd.read_parquet("regions_bl.parquet", columns=cols)
df["date"] = pd.to_datetime(df["date"])
q = pd.read_parquet("backtest_q_fuel.parquet", columns=["zone", "t", "h", "date", "y", "q10", "q90"])
q["zone"] = q["zone"].astype(str); q["date"] = pd.to_datetime(q["date"]); q["t"] = pd.to_datetime(q["t"])
q = q[q["zone"].isin(list(ZONES)) & q["h"].between(2, 7)]
for tag, lam in (("ctrl", 0.0), ("cand", a.lam)):
    os.makedirs(f"gate_{tag}", exist_ok=True)
    gate, acc, notes = BG.build(df.copy(), q.copy(), lam)
    open(f"gate_{tag}/publish_gate.json", "w").write(G.dumps_compact(gate) + "\n")
    open(f"gate_{tag}/accuracy_eu.json", "w").write(G.dumps_compact(acc) + "\n")
    n = {m: sum(len(v[m]) for v in gate["zones"].values()) for m in ("fuel", "nofuel")}
    print(f"{tag} (lambda {lam}): horizons published fuel {n['fuel']} of 156, no-fuel {n['nofuel']} of 156; notes: {notes[:8]}")
    # calibration: the band offsets are the UNCORRECTED model's own (calibrate_bands.py / refresh_calibration.sh never see the level correction): identical for control and candidate
    import calibrate as K
    rr = df[df["zone"].isin(list(ZONES)) & df["h"].between(2, 7)].copy()
    rr["nofuel"] = np.where(rr["zone"].isin(["ee", "lv", "lt"]), rr["lgb_base"], 0.5 * (rr["lear_r365"] + rr["lgb_base"]))
    cal = {"version": G.VERSION, "quantile": CB.quantile_offsets(q), "residual": K.residual_bands(rr.dropna(subset=["nofuel"]), col="nofuel")}
    json.dump(cal, open(f"gate_{tag}/calibration_eu.json", "w"))
