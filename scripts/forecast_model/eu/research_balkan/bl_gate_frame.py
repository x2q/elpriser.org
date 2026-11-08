"""The research frame build_gate.py / calibrate_bands.py read, for the PRODUCTION recipe exactly as it is today: ridge 365 (lear_r365, lear_r365_g of the r730 chain) + the single stored LightGBM draws of
backtest.py rel / rel+fuel (production fits one model, not a seed bag) -> regions_bl.parquet (26 zones, h 2..7, 2025-04-01..2026-11-02, the same rows as the checked-in gate)."""
import numpy as np, pandas as pd
def k(d):
    d["zone"] = d["zone"].astype(str); d["t"] = pd.to_datetime(d["t"]); return d
Z = k(pd.read_parquet("regions_zone.parquet", columns=["zone", "t", "date", "h", "hour", "y", "level_7d", "b_lag7", "b_seasonal", "b_persist", "b_lvlshape"]))
L = k(pd.read_parquet("r730_lear.parquet", columns=["zone", "t", "h", "lear_r365", "lear_r365_g"]))
out = Z.merge(L, on=["zone", "t", "h"], how="left")
for col, f in (("lgb_fuel", "backtest_eu_rel_fuel.parquet"), ("lgb_base", "backtest_eu_rel.parquet")):
    d = k(pd.read_parquet(f, columns=["zone", "t", "h", "p_raw"])).drop_duplicates(["zone", "t", "h"]).rename(columns={"p_raw": col})
    out = out.merge(d, on=["zone", "t", "h"], how="left")
print(len(out), out.zone.nunique(), out.date.min(), out.date.max())
print(out[["lear_r365", "lear_r365_g", "lgb_fuel", "lgb_base"]].isna().mean().round(4).to_dict())
out.to_parquet("regions_bl.parquet", index=False)
