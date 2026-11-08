"""Build the gate / accuracy / calibration files with the UNCHANGED gate rule for (ctrl) the production recipe, (cand) the same recipe with the published level correction in the zones of
level_correction.PUBLISH_ZONES, and two alternatives on the same research frame (regions_bl.parquet, bl_gate_frame.py): (all) the correction in every zone, (cee) in the 12 zones of region_models.GROUPS['cee'].
Writes gate_<tag>/{publish_gate,accuracy_eu,calibration_eu}.json and prints the pooled comparison.  python3 research_balkan/bl_gate.py"""
import json, os, sys
sys.path.insert(0, os.getcwd())
import numpy as np, pandas as pd
import build_gate as BG, calibrate_bands as CB, gate as G, region_models as RM
import calibrate as K
from zones import ZONES
cols = ["zone", "t", "date", "h", "hour", "y", "level_7d", "b_lag7", "b_seasonal", "b_persist", "b_lvlshape", "lear_r365_g", "lear_r365", "lgb_fuel", "lgb_base"]
df = pd.read_parquet("regions_bl.parquet", columns=cols)
df["date"] = pd.to_datetime(df["date"])
q = pd.read_parquet("backtest_q_fuel.parquet", columns=["zone", "t", "h", "date", "y", "q10", "q90"])
q["zone"] = q["zone"].astype(str); q["date"] = pd.to_datetime(q["date"]); q["t"] = pd.to_datetime(q["t"])
q = q[q["zone"].isin(list(ZONES)) & q["h"].between(2, 7)]
VARIANTS = {"ctrl": (0.0, "default"), "cand": (0.5, "default"), "all": (0.5, None), "cee": (0.5, tuple(RM.GROUPS["cee"]))}
out = {}
for tag, (lam, zones) in VARIANTS.items():
    os.makedirs(f"gate_{tag}", exist_ok=True)
    gate, acc, notes = BG.build(df.copy(), q.copy(), lam, zones)
    open(f"gate_{tag}/publish_gate.json", "w").write(G.dumps_compact(gate) + "\n")
    open(f"gate_{tag}/accuracy_eu.json", "w").write(G.dumps_compact(acc) + "\n")
    n = {m: sum(len(v[m]) for v in gate["zones"].values()) for m in ("fuel", "nofuel")}
    print(f"{tag} (lambda {lam}, zones {gate['levelCorrection']['zones'] if lam else '-'}): horizons published fuel {n['fuel']} of 156, no-fuel {n['nofuel']} of 156; notes: {notes[:6]}")
    # calibration: the band offsets are the UNCORRECTED model's own (calibrate_bands.py, refresh_calibration.sh never see the level correction): identical in every variant
    rr = df[df["zone"].isin(list(ZONES)) & df["h"].between(2, 7)].copy()
    rr["nofuel"] = np.where(rr["zone"].isin(["ee", "lv", "lt"]), rr["lgb_base"], 0.5 * (rr["lear_r365"] + rr["lgb_base"]))
    json.dump({"version": G.VERSION, "quantile": CB.quantile_offsets(q), "residual": K.residual_bands(rr.dropna(subset=["nofuel"]), col="nofuel")}, open(f"gate_{tag}/calibration_eu.json", "w"))
    out[tag] = (gate, acc)
# pooled comparison of the variants against the control (fuel mode, cells published in both)
print("\nfuel mode, cells published in control and variant: mean change in gain (points), whole / hold-out / since 2026-09-01; cells better / worse by > 0.05 on the hold-out; worst hold-out cell")
for tag in ("cand", "all", "cee"):
    rows = []
    for z in ZONES:
        for h in range(2, 8):
            a, b = out["ctrl"][1]["zones"][z]["fuel"].get(str(h)), out[tag][1]["zones"][z]["fuel"].get(str(h))
            if a and b:
                rows.append({"zone": z, "h": h, **{k: 100 * (b[k] - a[k]) for k in ("gain", "gainHold", "gainRecent") if a[k] is not None and b[k] is not None}})
    R = pd.DataFrame(rows)
    corrected = set(out[tag][0]["levelCorrection"]["zones"])
    for label, sel in (("all 26 zones", R.zone != ""), ("corrected zones", R.zone.isin(corrected)), ("not corrected", ~R.zone.isin(corrected))):
        s = R[sel]
        if len(s):
            print(f"  {tag:5s} {label:16s} n={len(s):3d}: {s.gain.mean():+.2f} / {s.gainHold.mean():+.2f} / {s.gainRecent.mean():+.2f}; hold-out better {int((s.gainHold > 0.05).sum())} worse {int((s.gainHold < -0.05).sum())}; worst {s.gainHold.min():+.1f}")
