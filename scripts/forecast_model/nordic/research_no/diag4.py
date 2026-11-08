"""Step 1: how coupled are the Norwegian zones to their neighbours? Share of hours with the same price (to the cent) and the correlation of daily means,
2025-04-01..2026-10-31. Used to decide whether NO4 (and the others) can be forecast through a neighbour's forecast."""
import numpy as np
import pandas as pd

Z = ["dk1", "dk2", "no1", "no2", "no3", "no4", "no5", "se1", "se2", "se3", "se4", "fi", "nl"]
P = {}
for z in Z:
    d = pd.read_parquet(f"nprice_{z}.parquet")
    s = d.set_index(pd.to_datetime(d["t"]))["eur_mwh"].sort_index()
    P[z] = s[~s.index.duplicated(keep="last")]
P = pd.DataFrame(P)
P = P[(P.index >= "2025-04-01") & (P.index < "2026-11-01")]
for z in ["no1", "no2", "no3", "no4", "no5"]:
    print(f"--- {z}: share of hours with an identical price (|diff| < 0.01), and correlation of daily means")
    rows = []
    dm = P.resample("D").mean()
    for o in Z:
        if o == z:
            continue
        same = ((P[z] - P[o]).abs() < 0.01).mean()
        rows.append((o, same, dm[z].corr(dm[o])))
    rows.sort(key=lambda r: -r[1])
    print("  " + "  ".join(f"{o}:{s:.2f}/{c:.2f}" for o, s, c in rows[:6]))
print("share of NO4 hours at or below 5 EUR/MWh:", (P["no4"] <= 5).mean().round(3), " mean", P["no4"].mean().round(1))
for per, (a, b) in {"select": ("2025-04-01", "2026-06-30"), "hold": ("2026-07-01", "2026-10-31")}.items():
    x = P[(P.index >= a) & (P.index <= b + " 23:00")]
    print(per, "mean price by zone:", x.mean().round(1).to_dict())
