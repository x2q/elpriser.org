"""(f) Level correction toward the last 7-14 settled days (level_correction.py: shift by LAMBDA x the mean day-level error of the same zone and horizon over the last K days that were
settled when the forecast was issued) applied to the production recipe, the 730-day recipe and a candidate, under the gate's scoring.  python3 research_balkan/bl_screen_lc.py"""
import sys
import numpy as np, pandas as pd
import bl_eval as E
import level_correction as LC
pd.set_option("display.width", 250); pd.set_option("display.max_columns", 40)
def adaptive(res, k=14, min_days=3, lam=1.0, col="p"):
    """(f2) evidence-weighted level correction: the same trailing mean day-level error m over the last k settled days as level_correction.py, times the shrinkage w = m^2 / (m^2 + s^2 / n)
    (s = their standard deviation, n = how many there are) and `lam` (1.0): a persistent one-signed error is passed on almost whole, noise around zero is not."""
    errs = LC.day_errors_from_backtest(res, col)
    parts = []
    for (z, h), g in errs.groupby(["zone", "h"]):
        s = g.set_index("date")["res"].asfreq("D")
        m = s.rolling(k, min_periods=min_days).mean(); sd = s.rolling(k, min_periods=min_days).std(); n = s.rolling(k, min_periods=min_days).count()
        w = (m ** 2 / (m ** 2 + sd ** 2 / n)).fillna(0.0)
        parts.append(pd.DataFrame({"zone": z, "h": h, "date": s.index, "corr": (lam * w * m).shift(int(h) - 1).to_numpy()}))
    c = pd.concat(parts, ignore_index=True)
    out = res[["zone", "h", "date"]].copy(); out["date"] = pd.to_datetime(out["date"]); out["zone"] = out["zone"].astype(str)
    return out.merge(c, on=["zone", "h", "date"], how="left")["corr"].fillna(0.0).to_numpy()


A = E.load_base()
A["prod"] = E.recipe_col(A, "lear_r365_g", "lgb_fuel")
A["prod_bag3"] = E.recipe_col(A, "lear_r365_g", "lgb_bag3")
A["r730_bag3"] = E.recipe_col(A, "lear_r730_g", "lgb_bag3")
A = A[(A["h"].between(2, 7)) & ~A["zone"].isin(E.BALTICS)].dropna(subset=["prod", "prod_bag3", "r730_bag3", "y", "b_lvlshape"]).reset_index(drop=True)
cols = ["prod_bag3", "r730_bag3"]
for base in ("prod_bag3", "r730_bag3"):
    for lam, k in ((0.5, 14), (0.5, 7), (1.0, 7), (0.5, 3)):
        name = f"{base}|lc{lam}/{k}"
        A[name] = A[base] + LC.apply_to_backtest(A.rename(columns={base: "p"}), lam, k, 3, col="p")
        cols.append(name)
for base in ("prod_bag3", "r730_bag3"):
    name = f"{base}|adapt14"
    A[name] = A[base] + adaptive(A.rename(columns={base: "p"}), 14, 3, 1.0, "p")
    cols.append(name)
C = E.cells(A, cols)
S = E.summarise(C)
print(S.loc[cols].to_string())
for c in cols[2:]:
    ref = c.split("|")[0]
    cmp = E.compare(C, c, ref)
    print(f"{c:22s} vs {ref}: " + " | ".join(f"{p}: +{v[0]}/-{v[1]} mean {v[2]:+.2f} worst {v[3]:+.1f}" for p, v in cmp.items()))
C.to_parquet("bl_screen_lc_cells.parquet")
