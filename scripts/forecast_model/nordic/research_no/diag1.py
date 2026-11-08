"""Step 1 (docs/forecast-nordic-no.md): per-zone gains of the stored research columns of regions_all.parquet (Nordic rows) against level+shape,
and a LEVEL / SHAPE decomposition of the error. Reads nordic_regions_all.parquet (Nordic rows of regions_all.parquet)."""
import numpy as np
import pandas as pd
import region_scores as RS

N = ["dk1", "dk2", "no1", "no2", "no3", "no4", "no5", "se1", "se2", "se3", "se4", "fi", "nl"]
d = pd.read_parquet("nordic_regions_all.parquet")
d["ens"] = 0.5 * (d.lear_r365_g + d.lgb_fuel)
cols = ["b_lvlshape", "hyb_base", "lgb_base", "lear_r365_g", "lgb_fuel", "ens", "ens_lt"]
sc = RS.score(d, cols=cols)
sc.to_csv("diag1_scores.csv", index=False)


def gain(z, h, c, p, m="mae"):
    s = sc[(sc.zone == z) & (sc.h == h) & (sc.period == p)].set_index("col")[m]
    return 100 * (1 - s[c] / s["b_lvlshape"])


for c in ["hyb_base", "lgb_base", "lear_r365_g", "ens", "ens_lt"]:
    print("==", c, "gain % full/hold, D+2 D+5 D+7")
    for z in N:
        print(z, "  ".join(f"{gain(z, h, c, 'full'):6.1f}/{gain(z, h, c, 'hold'):6.1f}" for h in (2, 5, 7)))
print("== regret gain hyb_base vs lvlshape (full/hold)")
for z in N:
    print(z, "  ".join(f"{gain(z, h, 'hyb_base', 'full', 'regret'):6.1f}/{gain(z, h, 'hyb_base', 'hold', 'regret'):6.1f}" for h in (2, 5, 7)))

# level / shape decomposition at D+5 over the whole backtest: per day, error = mean over the day (level) + within-day remainder (shape)
print("== decomposition D+5, full period: MAE of day-level error / MAE of within-day shape error, EUR/MWh (baseline | hyb_base | ens)")
x = d[d.h == 5]
for z in N:
    r = []
    for c in ("b_lvlshape", "hyb_base", "ens"):
        s = x[x.zone == z]
        e = s[c] - s.y
        dm = e.groupby(s.date).transform("mean")
        r.append(f"{dm.abs().mean():5.1f}/{(e - dm).abs().mean():4.1f}")
    print(z, f"mean price {x[x.zone == z].y.mean():6.1f}  daily-mean std {x[x.zone == z].groupby('date').y.mean().std():5.1f}", " | ".join(r))
