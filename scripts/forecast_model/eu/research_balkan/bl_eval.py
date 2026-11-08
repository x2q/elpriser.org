"""Scoring of the balkan-level candidates under the gate's protocol (docs/forecast-balkan-level.md): same rows, same baseline (level + shape with level_7d), same periods
(whole 2025-04-01.., select ..2026-06-30, hold-out 2026-07-01.., since 2026-09-01), the recipe = mean of a ridge column and a LightGBM column (fuel mode; EE/LV/LT = the plain LightGBM
of production, untouched). Used as a module (load_base / recipe / table) by the candidate drivers.
"""
import os, sys, glob
DIR = os.getcwd(); sys.path.insert(0, DIR)
import numpy as np, pandas as pd

BAL = ["me", "mk", "rs", "xk", "al", "gr"]
WATCH = ["it-n", "sk", "hu"]
BALTICS = ["ee", "lv", "lt"]
T_HOLD, T_SHIFT = pd.Timestamp("2026-07-01"), pd.Timestamp("2026-09-01")


def _k(d):
    d["zone"] = d["zone"].astype(str); d["t"] = pd.to_datetime(d["t"]); return d


def load_base():
    """Research frame of production's recipe + the stored candidate columns: zone t date h y level_7d b_lvlshape lgb_fuel lgb_base lear_r365_g lear_r730_g lgb_bag3."""
    Z = _k(pd.read_parquet("regions_zone.parquet", columns=["zone", "t", "date", "h", "hour", "y", "level_7d", "b_lag7", "b_seasonal", "b_persist", "b_lvlshape", "lgb_base", "lgb_fuel"]))
    L = _k(pd.read_parquet("r730_lear.parquet", columns=["zone", "t", "h", "lear_r365", "lear_r365_g", "lear_r730_g", "lear_r730"]))
    A = Z.drop(columns=["lgb_fuel"]).merge(L, on=["zone", "t", "h"], how="left")
    # regions_zone.parquet's lgb_fuel is already the 3-seed mean of the ridge730 work; production's own number is the single stored draw of backtest.py rel+fuel
    one = _k(pd.read_parquet("backtest_eu_rel_fuel.parquet", columns=["zone", "t", "h", "p_raw"])).drop_duplicates(["zone", "t", "h"]).rename(columns={"p_raw": "lgb_fuel"})
    A = A.merge(one, on=["zone", "t", "h"], how="left")
    s = []
    for n in (1, 2, 3):
        p = _k(pd.read_parquet(f"backtest_eu_rel_fuel_s{n}.parquet", columns=["zone", "t", "h", "p_raw"])).rename(columns={"p_raw": f"s{n}"})
        s.append(p.drop_duplicates(["zone", "t", "h"]).set_index(["zone", "t", "h"]))
    S = pd.concat(s, axis=1).reset_index()
    S["lgb_bag3"] = S[["s1", "s2", "s3"]].mean(axis=1)
    A = A.merge(S[["zone", "t", "h", "lgb_bag3"]], on=["zone", "t", "h"], how="left")
    A["date"] = pd.to_datetime(A["date"])
    return A


def add_ridge(A, name, path=None):
    d = _k(pd.read_parquet(path or f"bl_ridge_{name}.parquet"))
    return A.merge(d.drop_duplicates(["zone", "t", "h"]), on=["zone", "t", "h"], how="left")


def add_lgb(A, name, seeds=(1, 2, 3)):
    """Mean over the seeds of bl_lgb_<name>_s<seed>.parquet as column `name` (NaN where a seed is missing)."""
    parts = []
    for s in seeds:
        d = _k(pd.read_parquet(f"bl_lgb_{name}_s{s}.parquet")).drop_duplicates(["zone", "t", "h"]).set_index(["zone", "t", "h"])[name].rename(f"{name}_{s}")
        parts.append(d)
    m = pd.concat(parts, axis=1).mean(axis=1, skipna=False).rename(name).reset_index()
    return A.merge(m, on=["zone", "t", "h"], how="left")


def recipe_col(A, ridge, tree):
    """The published fuel-mode forecast of every non-Baltic zone from a ridge column and a LightGBM column; the Baltics keep the plain LightGBM (lgb_base)."""
    return np.where(A["zone"].isin(BALTICS), A["lgb_base"], 0.5 * (A[ridge] + A[tree]))


def cells(A, cols, mask=None):
    """Per zone, horizon and column: MAE gain vs level+shape over four periods, the bias since 2026-09-01, the day-level MAE since 2026-09-01, on the rows where every column in `cols` exists.
    Returns a long frame (zone, h, col, gain, hold, select, recent, bias, lvl_mae, base_bias, base_lvl_mae)."""
    need = ["y", "b_lvlshape"] + list(cols)
    d = A[(A["h"].between(2, 7)) & (A["date"] >= "2025-04-01")].dropna(subset=need)
    if mask is not None:
        d = d[mask.loc[d.index]]
    out = []
    per = {"full": d["date"] >= "2025-04-01", "hold": d["date"] >= T_HOLD, "select": d["date"] < T_HOLD, "recent": d["date"] >= T_SHIFT}
    ae_base = (d["b_lvlshape"] - d["y"]).abs()
    for c in cols:
        ae = (d[c] - d["y"]).abs()
        e = d[c] - d["y"]
        eb = d["b_lvlshape"] - d["y"]
        # day-level error (mean over the day) for the recent period
        key = [d["zone"], d["h"], d["date"]]
        dl = e.groupby(key).transform("mean"); dlb = eb.groupby(key).transform("mean")
        for (z, h), g in d.groupby(["zone", "h"]):
            r = {"zone": z, "h": int(h), "col": c}
            for p, m in per.items():
                mm = m.loc[g.index]
                b = ae_base.loc[g.index][mm].mean()
                r[p] = 1 - ae.loc[g.index][mm].mean() / b if mm.any() and b > 0 else np.nan
            mm = per["recent"].loc[g.index]
            r["bias"] = e.loc[g.index][mm].mean(); r["base_bias"] = eb.loc[g.index][mm].mean()
            r["lvl_mae"] = dl.loc[g.index][mm].abs().mean(); r["base_lvl_mae"] = dlb.loc[g.index][mm].abs().mean()
            out.append(r)
    return pd.DataFrame(out)


def summarise(C, ref=None, zones_bal=BAL):
    """One line per candidate column: mean gain (24 non-Baltic zones) whole / hold / recent at D+2, D+5, D+7; the Balkan six's gain since 2026-09-01; cells below the 5 % rule."""
    C = C[~C.zone.isin(BALTICS)]
    rows = []
    for c, g in C.groupby("col", sort=False):
        r = {"col": c}
        for h in (2, 5, 7):
            x = g[g.h == h]
            r[f"D{h} whole"] = 100 * x["full"].mean(); r[f"D{h} hold"] = 100 * x["hold"].mean(); r[f"D{h} recent"] = 100 * x["recent"].mean()
        b = g[g.zone.isin(zones_bal)]
        r["bal recent D2-7"] = 100 * b["recent"].mean()
        r["bal recent D5"] = 100 * b[b.h == 5]["recent"].mean()
        r["bal bias D5"] = b[b.h == 5]["bias"].mean()
        r["bal lvlMAE D5"] = b[b.h == 5]["lvl_mae"].mean()
        r["cells pass"] = int(((g["full"] >= 0.05) & (g["hold"] >= 0.05)).sum())
        rows.append(r)
    return pd.DataFrame(rows).set_index("col").round(2)


def compare(C, new, old):
    """Cells (zone, h) where `new` beats / loses to `old` on the whole backtest, the hold-out and since September (counts) and the mean change in points."""
    a = C[C.col == new].set_index(["zone", "h"]); b = C[C.col == old].set_index(["zone", "h"])
    out = {}
    for p in ("full", "hold", "select", "recent"):
        dlt = 100 * (a[p] - b[p])
        out[p] = (int((dlt > 0.05).sum()), int((dlt < -0.05).sum()), float(dlt.mean()), float(dlt.min()))
    return out
