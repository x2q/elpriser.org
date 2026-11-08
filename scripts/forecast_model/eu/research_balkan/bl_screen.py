"""Screen ridge and LightGBM candidates: python3 research_balkan/bl_screen.py --ridge r365 a_ewm5 ... --lgb t_rel ... [--tree lgb_bag3]
Each ridge candidate is scored alone and in the recipe with the production tree (the stored draw `lgb_fuel`, and the 3-seed mean `lgb_bag3`); each LightGBM candidate alone and with the
production ridge (`lear_r365_g`)."""
import sys, argparse
import numpy as np, pandas as pd
import bl_eval as E
pd.set_option("display.width", 250); pd.set_option("display.max_columns", 40)
ap = argparse.ArgumentParser()
ap.add_argument("--ridge", nargs="*", default=[]); ap.add_argument("--lgb", nargs="*", default=[]); ap.add_argument("--seeds", nargs="*", type=int, default=[1, 2, 3])
ap.add_argument("--detail", default="")
a = ap.parse_args()
A = E.load_base()
cols = ["lear_r365_g", "lgb_fuel", "lgb_bag3", "lear_r730_g"]
for r in a.ridge:
    A = E.add_ridge(A, r); cols.append(r)
for t in a.lgb:
    A = E.add_lgb(A, t, tuple(a.seeds)); cols.append(t)
if "r365" in a.ridge:
    d = (A["r365"] - A["lear_r365_g"]).abs().dropna()
    print("parity r365 vs lear_r365_g: max |diff|", float(d.max()), "rows", len(d))
A["prod"] = E.recipe_col(A, "lear_r365_g", "lgb_fuel")
A["prod_bag3"] = E.recipe_col(A, "lear_r365_g", "lgb_bag3")
rec = ["prod", "prod_bag3"]
A["r730_bag3"] = E.recipe_col(A, "lear_r730_g", "lgb_bag3"); rec.append("r730_bag3")
for r in a.ridge:
    if r == "r365":
        continue
    A[f"{r}+bag3"] = E.recipe_col(A, r, "lgb_bag3"); rec.append(f"{r}+bag3")
for t in a.lgb:
    A[f"r365+{t}"] = E.recipe_col(A, "lear_r365_g", t); rec.append(f"r365+{t}")
    for r in a.ridge:
        if r != "r365":
            A[f"{r}+{t}"] = E.recipe_col(A, r, t); rec.append(f"{r}+{t}")
allc = rec + [c for c in cols if c in A]
base_mask = A[allc].notna().all(axis=1) & ~A["zone"].isin(E.BALTICS)
C = E.cells(A, allc, base_mask)
print("\n=== mean gain over 24 zones (%), whole / hold-out / since 2026-09-01; Balkan six since September; cells passing 5 % rule (of 144)")
S = E.summarise(C)
print(S.loc[[c for c in allc if c in S.index]].to_string())
ref = "prod_bag3"
print(f"\n=== recipes against {ref} (cells better/worse by > 0.05 points, mean change in points, worst): whole | hold | select | recent")
for c in rec:
    if c == ref:
        continue
    cmp = E.compare(C, c, ref)
    print(f"{c:28s}", " | ".join(f"{p}: +{v[0]}/-{v[1]} mean {v[2]:+.2f} worst {v[3]:+.1f}" for p, v in cmp.items()))
C.to_parquet("bl_screen_cells.parquet")
if a.detail:
    x = C[(C.col == a.detail) | (C.col == ref)]
    for p in ("recent", "hold"):
        print(f"\n=== {a.detail} vs {ref}, {p} gain %, D+2/D+5/D+7")
        t = x[x.h.isin([2, 5, 7])].pivot_table(index="zone", columns=["col", "h"], values=p) * 100
        print(t.round(1).to_string())
