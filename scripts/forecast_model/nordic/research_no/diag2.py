"""Step 1: where does the level error of the production model come from? Monthly bias and day-level MAE at D+5, Norwegian zones,
production (hyb_base) against level+shape (b_lvlshape), the ridge (lear_r365_g) and the Nordic-LightGBM/ridge mean (ens)."""
import numpy as np
import pandas as pd

d = pd.read_parquet("nordic_regions_all.parquet")
d["ens"] = 0.5 * (d.lear_r365_g + d.lgb_fuel)
d["month"] = d.date.dt.to_period("M")
x = d[(d.h == 5) & d.zone.isin(["no1", "no2", "no4", "no5"])]
for z in ["no1", "no2", "no4", "no5"]:
    s = x[x.zone == z]
    rows = []
    for m, g in s.groupby("month"):
        dd = g.groupby("date").agg(y=("y", "mean"), b=("b_lvlshape", "mean"), p=("hyb_base", "mean"), l=("lear_r365_g", "mean"), e=("ens", "mean"))
        rows.append((str(m), dd.y.mean(), dd.b.mean() - dd.y.mean(), dd.p.mean() - dd.y.mean(), dd.l.mean() - dd.y.mean(),
                     (dd.b - dd.y).abs().mean(), (dd.p - dd.y).abs().mean(), (dd.l - dd.y).abs().mean(), (dd.e - dd.y).abs().mean()))
    print(f"--- {z} D+5: month, mean price | bias (forecast - actual) of level+shape, production, ridge | day-level MAE of level+shape, production, ridge, ens")
    for r in rows:
        print(f"{r[0]} {r[1]:6.1f} | {r[2]:6.1f} {r[3]:6.1f} {r[4]:6.1f} | {r[5]:5.1f} {r[6]:5.1f} {r[7]:5.1f} {r[8]:5.1f}")
