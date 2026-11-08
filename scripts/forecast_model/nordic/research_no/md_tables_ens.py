#!/usr/bin/env python3
"""Markdown tables of docs/forecast-nordic-ens.md from decision_ens.json (decide_recipe.py): the decision table (S per candidate, admissibility) and, per zone and horizon,
the pooled model against the recipe that is staged (or, for zones that stay, against `ens`).

    python3 md_tables_ens.py [decision_ens.json] > tables.md
"""
import json
import sys

HS = range(2, 9)
NAMES = ["ens", "ens_nr", "ens365", "ens_b25", "ens_b75"]


def f(x):
    return f"{x:.1f}"


def main():
    d = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "decision_ens.json"))
    cells, zones = d["cells"], d["zones"]
    print("### Decision table (mean over D+2..D+8; S = select-period MAE gain over level+shape, points above pooled in brackets; regret = difference of the mean regret gain to pooled, select / whole)\n")
    print("| zone | pooled S | " + " | ".join(NAMES) + " | decision |")
    print("|---|---|" + "---|" * len(NAMES) + "---|")
    for z, v in zones.items():
        row = []
        for n in NAMES:
            c = v["candidates"][n]
            tag = "ok" if c["admissible"] else ("gate: loses D+" + ",".join(map(str, c["lost_cells"])) if not c["gate_ok"] else "regret worse")
            row.append(f"{c['S']:.1f} ({c['S'] - v['S_pooled']:+.1f}), {c['regret_dsel']:+.1f}/{c['regret_dfull']:+.1f}, {tag}")
        print(f"| {z} | {v['S_pooled']:.1f} | " + " | ".join(row) + f" | **{v['recipe']}** |")
    print()
    for z, v in zones.items():
        n = v["recipe"] if v["recipe"] != "pooled" else "ens"
        head = f"{z}: `{v['recipe']}`" if v["recipe"] != "pooled" else f"{z}: stays `pooled` (the table shows the staged `ens` for comparison, it is NOT used)"
        print(f"\n**{head}**\n")
        print(f"| | MAE gain % whole / hold-out / since Sep: pooled | {n} | regret gain % whole / hold-out: pooled | {n} | bias since Sep: pooled | {n} |")
        print("|---|---|---|---|---|---|---|")
        for h in HS:
            p, c = cells[f"{z}|pooled|{h}"], cells[f"{z}|{n}|{h}"]
            okc = min(c["gain_full"], c["gain_hold"]) >= 5
            okp = min(p["gain_full"], p["gain_hold"]) >= 5
            print(f"| D+{h} | {f(p['gain_full'])} / {f(p['gain_hold'])} / {f(p['gain_after'])}{'' if okp else ' **fails**'} | {f(c['gain_full'])} / {f(c['gain_hold'])} / {f(c['gain_after'])}{'' if okc else ' **fails**'} | "
                  f"{f(p['rg_full'])} / {f(p['rg_hold'])} | {f(c['rg_full'])} / {f(c['rg_hold'])} | {f(p['bias_after'])} | {f(c['bias_after'])} |")


if __name__ == "__main__":
    main()
