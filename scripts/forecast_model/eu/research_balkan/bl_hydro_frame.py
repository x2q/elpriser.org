"""(d) Add the leak-free A72 reservoir features (fetch_a72.py -> a72_features.parquet) to the research frame: res_pct, res_d4, res_reg taken at the row's LAST KNOWN DAY (date - (h - 1)).
NaN where the zone has no A72 or the 52-week history is too short; the ridge fills with fixed constants (0.75 / 0 / 0.75), the tree takes NaN as it is. -> bl_frame_hydro.parquet"""
import numpy as np, pandas as pd
A = pd.read_parquet("bl_frame.parquet")
H = pd.read_parquet("a72_features.parquet")
H["day"] = pd.to_datetime(H["day"])
A["date"] = pd.to_datetime(A["date"])
A["day"] = A["date"] - pd.to_timedelta(A["h"] - 1, unit="D")
A = A.merge(H[["zone", "day", "res_pct", "res_d4", "res_reg"]], on=["zone", "day"], how="left").drop(columns="day")
# res_reg is a regional mean: give it to every zone of the CEE group, also those without A72 of their own (hu sk si xk)
reg = H.drop_duplicates("day").set_index("day")["res_reg"]
cee = A["zone"].isin(["hu", "sk", "ro", "bg", "gr", "hr", "si", "rs", "me", "mk", "al", "xk"])
A.loc[cee & A["res_reg"].isna(), "res_reg"] = reg.reindex(A.loc[cee & A["res_reg"].isna(), "date"] - pd.to_timedelta(A.loc[cee & A["res_reg"].isna(), "h"] - 1, unit="D")).to_numpy()
A["res_pct_f"] = A["res_pct"].fillna(0.75); A["res_d4_f"] = A["res_d4"].fillna(0.0); A["res_reg_f"] = A["res_reg"].fillna(0.75)
A.to_parquet("bl_frame_hydro.parquet", index=False)
print(A.groupby("zone")[["res_pct", "res_d4", "res_reg"]].apply(lambda g: g.notna().mean()).round(2).T.to_string())
