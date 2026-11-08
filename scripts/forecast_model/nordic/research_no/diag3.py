"""Step 1: the March / July 2026 level misses of the production model, day by day (no1, D+5)."""
import pandas as pd

d = pd.read_parquet("nordic_regions_all.parquet")
for z, a, b in (("no1", "2026-02-24", "2026-03-31"), ("no5", "2026-07-01", "2026-07-31")):
    s = d[(d.zone == z) & (d.h == 5) & (d.date >= a) & (d.date <= b)]
    g = s.groupby("date").agg(y=("y", "mean"), lvl=("level_7d", "mean"), base=("b_lvlshape", "mean"), prod=("hyb_base", "mean"), lgb=("lgb_base", "mean"),
                              ridge=("lear_r365_g", "mean"))
    print(z, "D+5 daily means"); print(g.round(1).to_string())
