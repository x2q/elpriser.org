"""Markdown tables of docs/forecast-balkan-level-cells.csv for the write-up: per zone and horizon, gain vs level+shape before (the files production uses) > after (level correction), for the
whole backtest, the hold-out and since 2026-09-01, fuel and no-fuel mode.  python3 research_balkan/cells_md.py docs/forecast-balkan-level-cells.csv [fuel|nofuel]"""
import sys
import pandas as pd
D = pd.read_csv(sys.argv[1])
mode = sys.argv[2] if len(sys.argv) > 2 else "fuel"
D = D[D["mode"] == mode]
def fmt(b, a, pb, pa):
    f = lambda v: "x" if pd.isna(v) else f"{100*v:.1f}"
    s = f"{f(b)}>{f(a)}"
    return f"**{s}**" if pb != pa else s
for key, label in (("gain", "whole backtest"), ("hold", "hold-out 2026-07-01.."), ("recent", "since 2026-09-01")):
    print(f"\n#### {mode} mode, gain vs level+shape, {label}, before > after (%); x = not published, bold = the cell appears or disappears\n")
    print("| zone | D+2 | D+3 | D+4 | D+5 | D+6 | D+7 |\n|---|---|---|---|---|---|---|")
    for z, g in D.groupby("zone", sort=False):
        g = g.set_index("h")
        print(f"| {z} | " + " | ".join(fmt(g.loc[h, f"prod_{key}"], g.loc[h, f"cand_{key}"], g.loc[h, "prod_pub"], g.loc[h, "cand_pub"]) for h in range(2, 8)) + " |")
