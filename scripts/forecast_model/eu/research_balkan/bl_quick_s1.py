"""Seed-1 only quick look: LightGBM candidates against production's tree with the same seed (pairs in the recipe with the production ridge)."""
import sys
import numpy as np, pandas as pd
import bl_eval as E
pd.set_option("display.width", 250); pd.set_option("display.max_columns", 40)
names = sys.argv[1:]
A = E.load_base()
p = E._k(pd.read_parquet("backtest_eu_rel_fuel_s1.parquet", columns=["zone", "t", "h", "p_raw"])).drop_duplicates(["zone", "t", "h"]).rename(columns={"p_raw": "lgb_s1"})
A = A.merge(p, on=["zone", "t", "h"], how="left")
for n in names:
    A = E.add_lgb(A, n, (1,))
A["prod_s1"] = E.recipe_col(A, "lear_r365_g", "lgb_s1")
rec = ["prod_s1"]
for n in names:
    A[f"r365+{n}"] = E.recipe_col(A, "lear_r365_g", n); rec.append(f"r365+{n}")
    A[f"r730+{n}"] = E.recipe_col(A, "lear_r730_g", n); rec.append(f"r730+{n}")
A["r730+s1"] = E.recipe_col(A, "lear_r730_g", "lgb_s1"); rec.append("r730+s1")
allc = rec + ["lgb_s1"] + names
mask = A[allc].notna().all(axis=1) & ~A["zone"].isin(E.BALTICS)
C = E.cells(A, allc, mask)
print(E.summarise(C).loc[allc].to_string())
for c in rec[1:] + names:
    ref = "lgb_s1" if c in names else "prod_s1"
    print(f"{c:22s} vs {ref}: " + " | ".join(f"{p}: +{v[0]}/-{v[1]} mean {v[2]:+.2f} worst {v[3]:+.1f}" for p, v in E.compare(C, c, ref).items()))
