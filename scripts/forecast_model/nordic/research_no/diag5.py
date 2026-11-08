"""Step 1/2: level vs shape error and bias, production (p0_hyb) against the ensemble recipe, Norwegian zones, D+5, whole backtest and since 2026-09-01.
MAE of the day-level error (the day's mean forecast - the day's mean price) and of the within-day remainder, EUR/MWh, on the rows all three columns have."""
import numpy as np
import pandas as pd
import score_nfr as SN

NAMES = {"b_lvlshape": "level+shape", "p0_hyb": "production", "hyb:r730lf+lrel13lf": "ensemble"}
df = SN.load(list(NAMES), SN.NO)
df = df.dropna(subset=list(NAMES) + ["y"])
for h in (2, 5, 7):
    print(f"--- D+{h}: day-level MAE / within-day shape MAE / mean bias since 2026-09-01 (forecast - actual), EUR/MWh; level+shape | production | ensemble")
    for z in SN.NO:
        s = df[(df.zone == z) & (df.h == h)]
        cells = []
        for c in NAMES:
            e = s[c] - s["y"]
            dm = e.groupby(s["date"]).transform("mean")
            cells.append(f"{dm.abs().mean():5.1f}/{(e - dm).abs().mean():4.1f}/{e[s['date'] >= '2026-09-01'].mean():6.1f}")
        print(f"{z}  mean price {s['y'].mean():5.1f}   " + " | ".join(cells))
