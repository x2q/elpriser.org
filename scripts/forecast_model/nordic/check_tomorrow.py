"""Confirm the h=2 feature set is fully available for tomorrow.

The fix routes an unpublished day through the model at h=2. That is only
correct if every feature h=2 needs is actually known for that day — otherwise
the row would be dropped or predicted from NaNs. This checks the real price
series rather than assuming.
"""
import datetime
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "/home/cc/nordic")
import dataset as ds

prices = ds.load_prices()
today = datetime.datetime.now(datetime.timezone.utc).date()
tom = today + datetime.timedelta(days=1)
print("today:", today, "| tomorrow:", tom)

for z in ["se3", "no1", "nl"]:
    p = prices[z]
    today_n = len(p[p.index.normalize() == pd.Timestamp(today)])
    tom_n = len(p[p.index.normalize() == pd.Timestamp(tom)])
    dm = p.groupby(p.index.normalize()).mean()
    lvl = dm.rolling(30, min_periods=10).mean()
    idx = pd.date_range(pd.Timestamp(tom), periods=24, freq="h")
    h = 2
    lk = pd.Timestamp(tom) - pd.Timedelta(days=h - 1)

    lags = {}
    for k in (1, 2, 3, 7, 14, 21, 28):
        vals = [p.get(t - pd.Timedelta(days=k), np.nan) for t in idx]
        lags[f"lag{k}"] = int(sum(1 for v in vals if pd.notna(v)))

    route = "ACTUAL" if tom_n > 12 else "FORECAST via h=2"
    ldm = dm.get(lk, float("nan"))
    l30 = lvl.get(lk, float("nan"))
    print(f"\n  {z}: today {today_n}/24 published | tomorrow {tom_n}/24 -> {route}")
    print(f"     last_day_mean({lk.date()}) = {ldm:.1f}   level_30d = {l30:.1f}")
    print(f"     lag coverage (of 24): {lags}")
    missing = [k for k, v in lags.items() if v < 24]
    print(f"     -> all h=2 features available: "
          f"{not missing and pd.notna(ldm) and pd.notna(l30)}"
          + (f"  (incomplete: {missing})" if missing else ""))
