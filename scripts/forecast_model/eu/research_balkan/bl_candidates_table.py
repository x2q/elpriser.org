"""The consolidated candidate table of docs/forecast-balkan-level.md: every candidate as a recipe (mean of a ridge column and a LightGBM column; the 3-seed mean tree `lgb_bag3` and the 365-day ridge are the
reference `prod_bag3`), scored on the same rows (24 non-Baltic zones; the ENS candidates on the 13 zones that have ECMWF weather), under the gate's periods. Prints pooled lines and the per-zone level-skill table.
python3 research_balkan/bl_candidates_table.py [--ens]"""
import sys, os
import numpy as np, pandas as pd
import bl_eval as E
import level_correction as LC
pd.set_option("display.width", 260); pd.set_option("display.max_columns", 60)
ens = "--ens" in sys.argv
A = E.load_base()
ridge = ["a_ewm5", "a_l3", "b_reg", "dl", "d_hyd", "d_hyd_730"] + (["c_ens", "c_ens_sd"] if ens else [])
tree = ["t_rel", "t_rel_reg", "t_hyd"] + (["t_ens", "t_ens_sd"] if ens else [])
for r in ridge:
    A = E.add_ridge(A, r)
for t in tree:
    A = E.add_lgb(A, t)
rec = {"prod_bag3": ("lear_r365_g", "lgb_bag3"), "(e) r730": ("lear_r730_g", "lgb_bag3"), "(a) anchor ewm5 (ridge)": ("a_ewm5", "lgb_bag3"), "(a) anchor 3d (ridge)": ("a_l3", "lgb_bag3"),
       "(a) level-invariant tree": ("lear_r365_g", "t_rel"), "(b) regional ridge": ("b_reg", "lgb_bag3"), "(b) regional tree": ("lear_r365_g", "t_rel_reg"),
       "(a)+(b) rel tree + regional ridge": ("b_reg", "t_rel"), "(d) hydro ridge": ("d_hyd", "lgb_bag3"), "(d) hydro ridge 730": ("d_hyd_730", "lgb_bag3"), "(d) hydro tree": ("lear_r365_g", "t_hyd"),
       "(e)+(a) 730 + rel tree": ("lear_r730_g", "t_rel")}
if ens:
    rec.update({"(c) ENS ridge": ("c_ens", "lgb_bag3"), "(c) ENS ridge + spread": ("c_ens_sd", "lgb_bag3"), "(c) ENS tree": ("lear_r365_g", "t_ens"), "(c) ENS ridge + tree": ("c_ens", "t_ens"),
                "(c) ENS ridge + tree + spread": ("c_ens_sd", "t_ens_sd")})
for name, (r, t) in rec.items():
    A[name] = E.recipe_col(A, r, t)
A["(f) level correction on prod_bag3"] = A["prod_bag3"]
base = A[(A["h"].between(2, 7)) & ~A["zone"].isin(E.BALTICS)].dropna(subset=list(rec)).copy()
for name, src in (("(f) level correction 0.5/14", "prod_bag3"), ("(e)+(f) 730 + correction", "(e) r730")):
    base[name] = base[src] + LC.apply_to_backtest(base.rename(columns={src: "p"}), 0.5, 14, 3, col="p")
cols = list(rec) + ["(f) level correction 0.5/14", "(e)+(f) 730 + correction"]
mask_all = pd.Series(True, index=base.index)
C = E.cells(base, cols, mask_all)
S = E.summarise(C)
print("=== pooled over the 24 non-Baltic zones: mean gain vs level+shape (%): whole / hold-out / since 2026-09-01 at D+2, D+5, D+7; Balkan six since September")
print(S.loc[cols].to_string())
print("\n=== against prod_bag3: cells better / worse (> 0.05 points), mean change in points, worst cell")
for c in cols[1:]:
    cmp = E.compare(C, c, "prod_bag3")
    print(f"{c:36s} " + " | ".join(f"{p}: +{v[0]}/-{v[1]} {v[2]:+.2f} ({v[3]:+.1f})" for p, v in cmp.items()))
if ens:
    ENSZ = ["hu", "sk", "ro", "bg", "gr", "hr", "si", "rs", "me", "mk", "al", "xk", "it-n"]
    C13 = C[C.zone.isin(ENSZ)]
    print("\n=== the 13 zones that have ECMWF weather only (pooled over them)")
    ec = ["prod_bag3"] + [c for c in rec if c.startswith("(c)")] + ["(e) r730"]
    print(E.summarise(C13).loc[ec].to_string())
    for c in ec[1:]:
        cmp = E.compare(C13, c, "prod_bag3")
        print(f"{c:36s} " + " | ".join(f"{p}: +{v[0]}/-{v[1]} {v[2]:+.2f} ({v[3]:+.1f})" for p, v in cmp.items()))
zs = E.BAL + E.WATCH
sel = ["prod_bag3", "(e) r730", "(f) level correction 0.5/14", "(e)+(f) 730 + correction", "(a) level-invariant tree", "(b) regional ridge", "(d) hydro ridge"] + (["(c) ENS ridge + tree"] if ens else [])
for per, label in (("recent", "since 2026-09-01"), ("hold", "hold-out"), ("full", "whole backtest")):
    print(f"\n=== D+5 gain vs level+shape, {label}, % (columns = candidates)")
    t = C[(C.h == 5) & C.zone.isin(zs) & C.col.isin(sel)].pivot_table(index="zone", columns="col", values=per) * 100
    print(t.loc[zs, sel].round(1).to_string())
print("\n=== D+5 day-level bias since 2026-09-01 (forecast - actual, EUR/MWh) and day-level MAE")
for k in ("bias", "lvl_mae"):
    t = C[(C.h == 5) & C.zone.isin(zs) & C.col.isin(sel)].pivot_table(index="zone", columns="col", values=k)
    print(k); print(t.loc[zs, sel].round(1).to_string())
C.to_parquet("bl_candidates_cells.parquet")
