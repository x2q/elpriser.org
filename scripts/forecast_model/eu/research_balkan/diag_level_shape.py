"""Diagnosis (docs/forecast-balkan-level.md section 1): split the error of the production recipe into LEVEL (day mean) and SHAPE (within-day) per zone,
horizon and month; bias since 2026-09-01; is the level miss common to the region?  Run in a COPY of the job directory (needs regions_zone.parquet, r730_lear.parquet)."""
import os, sys
sys.path.insert(0, os.getcwd())
import numpy as np, pandas as pd
pd.set_option("display.width", 250); pd.set_option("display.max_columns", 50); pd.set_option("display.max_rows", 500)
Z = pd.read_parquet("regions_zone.parquet", columns=["zone", "t", "date", "h", "y", "level_7d", "b_lvlshape", "lgb_fuel", "lgb_base"])
L = pd.read_parquet("r730_lear.parquet", columns=["zone", "t", "h", "lear_r365_g", "lear_r730_g"])
for d in (Z, L):
    d["zone"] = d["zone"].astype(str); d["t"] = pd.to_datetime(d["t"])
A = Z.merge(L, on=["zone", "t", "h"], how="left")
A["date"] = pd.to_datetime(A["date"])
A = A[~A.zone.isin(["ee", "lv", "lt"])].dropna(subset=["lear_r365_g", "lgb_fuel", "y", "b_lvlshape"])
A["prod"] = 0.5 * (A["lear_r365_g"] + A["lgb_fuel"])
COLS = {"lvl+shape": "b_lvlshape", "ridge365": "lear_r365_g", "lgb": "lgb_fuel", "prod": "prod"}
A = A[A.groupby(["zone", "h", "date"])["y"].transform("size") == 24]
for c in COLS.values():
    A["d_" + c] = A[c] - A["y"]
g = A.groupby(["zone", "h", "date"])
D = g.agg(ym=("y", "mean"), lvl7=("level_7d", "first"), **{"m_" + c: ("d_" + c, "mean") for c in COLS.values()}).reset_index()
for c in COLS.values():
    A["s_" + c] = (A["d_" + c] - g["d_" + c].transform("mean")).abs()
Sg = A.groupby(["zone", "h", "date"])[["s_" + c for c in COLS.values()]].mean().reset_index()
D = D.merge(Sg, on=["zone", "h", "date"])
D["month"] = D["date"].dt.strftime("%Y-%m")
D.to_parquet("diag_days.parquet")
BAL = ["me", "mk", "rs", "xk", "al", "gr"]; WATCH = ["it-n", "sk", "hu"]


def tab(sel, h, since="2026-09-01", until=None):
    d = D[(D.h == h) & (D.date >= since)]
    if until:
        d = d[d.date < until]
    out = []
    for z in sel:
        x = d[d.zone == z]
        r = {"zone": z, "days": len(x), "price": x.ym.mean()}
        for k, c in COLS.items():
            r[f"lvlMAE {k}"] = x["m_" + c].abs().mean()
        for k, c in COLS.items():
            r[f"bias {k}"] = x["m_" + c].mean()
        for k, c in COLS.items():
            r[f"shapeMAE {k}"] = x["s_" + c].mean()
        out.append(r)
    return pd.DataFrame(out).set_index("zone").round(1)


for h in (2, 5, 7):
    print(f"\n=== since 2026-09-01, D+{h}: day-LEVEL MAE, bias (forecast - actual), within-day SHAPE MAE, EUR/MWh")
    print(tab(BAL + WATCH + ["de", "ro", "bg"], h))
print("\n=== before the shift 2025-04..2026-08, D+5")
print(tab(BAL + WATCH + ["de"], 5, "2025-04-01", "2026-09-01"))
for c, name in (("prod", "prod"), ("b_lvlshape", "level+shape")):
    p = D[D.h == 5].pivot_table(index="month", columns="zone", values="m_" + c, aggfunc="mean")
    print(f"\n=== monthly mean day-level bias D+5, {name} (forecast - actual)")
    print(p[BAL + WATCH + ["de", "hu", "ro", "bg"]].round(1).tail(12))
p = D[D.h == 5].pivot_table(index="month", columns="zone", values="ym", aggfunc="mean")
print("\n=== monthly mean price")
print(p[BAL + WATCH + ["de", "hu", "ro", "bg"]].round(0).tail(14))
d = D[(D.h == 5) & (D.date >= "2026-09-01")]
E = d.pivot(index="date", columns="zone", values="m_prod")
print("\n=== D+5 daily level error of prod since 2026-09-01: cross-zone correlation")
print(E[BAL + ["hu", "ro", "bg", "de", "it-n", "sk"]].corr().round(2))
u, s, vt = np.linalg.svd((E - E.mean()).fillna(0).to_numpy(), full_matrices=False)
print("share of the variance of the level errors, first common factor (all zones):", round(s[0] ** 2 / (s ** 2).sum(), 2), "; first 3:", np.round(s[:3] ** 2 / (s ** 2).sum(), 2))
D["move"] = D["ym"] - D["lvl7"]
print("\n=== mean (actual day mean - level_7d) since 2026-09-01 by horizon: how far the price runs away from its trailing 7-day mean (EUR/MWh)")
print(D[D.date >= "2026-09-01"].pivot_table(index="zone", columns="h", values="move", aggfunc="mean").loc[BAL + WATCH + ["de", "ro", "bg", "hu"]].round(1))
