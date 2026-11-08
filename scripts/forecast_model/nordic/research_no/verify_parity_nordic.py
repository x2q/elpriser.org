#!/usr/bin/env python3
"""Does the LIVE row builder of the ensemble job (recipe_nordic.live_rows + augment + add_reservoir_lf + add_fuel) give the same numbers as the research frame the gate
was measured on (nfr_frame.parquet)?  Real data, run in a directory that has both (the staging copy on the Spark):

    python3 verify_parity_nordic.py [--today 2026-10-20] [--zones no1,no3,dk1]

Rows are built as of `today` (prices cut at today + 1, as in the cron run) and compared column by column with the frame's rows for the same (zone, t, h). Weather columns
are compared only in shape (the frame carries the forecast as issued at the lead, the live builder takes the observed weather here), everything else must match to 1e-6.
Prints a table and exits 1 on a mismatch."""
import argparse
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recipe_nordic as RN        # noqa: E402
import dataset as ds              # noqa: E402  (the Nordic job's own)
import fuel_features as FUEL      # noqa: E402
import fetch_fuel as FF           # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--today", default="2026-10-20")
ap.add_argument("--zones", default="no1,no3,no5,dk1")
a = ap.parse_args()
today = pd.Timestamp(a.today)
prices_all = ds.load_prices()
prices = {z: p[p.index < today + pd.Timedelta(days=2)] for z, p in prices_all.items()}      # known at the cron run: through tomorrow
frame = pd.read_parquet("nfr_frame.parquet")
frame["zone"] = frame["zone"].astype(str)
hist_w = {z: ds.load_weather("actual", z) for z in RN.ZONES}
live = {z: hist_w[z][hist_w[z].index >= today - pd.Timedelta(days=1)] for z in RN.ZONES}
reg = RN.regional_weather(live, {z: w[w.index < today] for z, w in hist_w.items()}, today)
res = RN.reservoir_lf(pd.read_parquet("reservoir_weekly.parquet"))
table = FUEL.daily_table(FF.load("fuel_daily.csv"))
tables = RN.RM.day_tables(prices)
bad = 0
cols = ["weekday", "month", "is_weekend", "doy_sin", "doy_cos", "lag1", "lag2", "lag3", "lag7", "lag14", "lag21", "lag28", "seasonal4w", "last_day_mean", "level_30d",
        "level_7d", "ewm5", "lag_last", "p_prev", "is_holiday", "xmas_week", "b_lvlshape", "d_lag_last", "d_prev", "d_lag7", "d_lag14",
        "res_pct_lf", "res_anom_lf", "nres_anom_lf", "gas", "eua", "ccgt_mc", "ccgt_mc_d7", "ccgt_mc_d28", "gas_d7", "gas_m1_spread", "mc_gap"]
# the frame's own res_*_lf columns (nfr.py's reservoir_lf) are compared with the job's (recipe_nordic.reservoir_lf): two implementations, one result
for z in a.zones.split(","):
    lk = RN.last_known_day(prices[z], today)
    rows = RN.live_rows(z, prices[z], live[z], reg, today, lk)
    rows = RN.add_fuel(RN.add_reservoir_lf(RN.augment(rows, prices, tables), res), table)
    f = frame[(frame["zone"] == z) & frame["t"].between(rows["t"].min(), rows["t"].max())]
    m = rows.merge(f, on=["zone", "t", "h"], suffixes=("", "_f"))
    print(f"{z}: last known {lk}, {len(rows)} live rows, {len(m)} matched to the frame (h {sorted(m['h'].unique())})")
    for c in cols:
        if c + "_f" not in m:
            continue
        both = m[c].notna() & m[c + "_f"].notna()
        diff = np.abs(m.loc[both, c] - m.loc[both, c + "_f"])
        nan_mismatch = int((m[c].isna() != m[c + "_f"].isna()).sum())
        mx = float(diff.max()) if both.any() else 0.0
        flag = "" if (mx < 1e-6 and nan_mismatch == 0) else "   <-- MISMATCH"
        if flag:
            bad += 1
        if flag or c in ("lag7", "last_day_mean", "level_7d", "res_anom_lf", "ccgt_mc"):
            print(f"    {c:14s} max |diff| {mx:10.6f}   NaN pattern differs in {nan_mismatch} rows{flag}")
print("PARITY OK" if not bad else f"PARITY: {bad} column(s) differ")
sys.exit(1 if bad else 0)
