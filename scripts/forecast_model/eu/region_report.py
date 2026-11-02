#!/usr/bin/env python3
"""Markdown tables for docs/forecast-per-region.md from region_scores.csv / region_winners_*.csv (region_scores.py).

    python3 region_report.py > region_tables.md
"""
import os
import sys

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import region_models as RM      # noqa: E402
import region_scores as RS      # noqa: E402

EU25 = [z for g in ("core", "iberia", "it-n", "cee", "baltics", "ie") for z in RM.GROUPS[g] if z != "nl"]
NORDIC13 = RM.GROUPS["nordic"] + ["nl"]
H = range(2, 8)


def md(df, floatfmt=1):
    cols = list(df.columns)
    out = ["| " + " | ".join(str(c) for c in cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    for _, r in df.iterrows():
        cells = []
        for c in cols:
            v = r[c]
            cells.append("" if (isinstance(v, float) and np.isnan(v)) else (f"{v:.{floatfmt}f}" if isinstance(v, (float, np.floating)) else str(v)))
        out.append("| " + " | ".join(cells) + " |")
    return "\n".join(out)


def fuel_pooled(sc, zones, label):
    cols = ["b_lvlshape", "lgb_base", "lgb_gasonly", "lgb_fuel"]
    out = []
    for period in ("full", "before", "after"):
        mae = RS.pooled(sc, zones, cols, period, "mae")
        reg = RS.pooled(sc, zones, cols, period, "regret")
        bias = RS.pooled(sc, zones, cols, period, "bias")
        t = pd.DataFrame({"h": [f"D+{h}" for h in mae.index],
                          "level+shape": mae["b_lvlshape"].to_numpy(),
                          "LGB now": mae["lgb_base"].to_numpy(),
                          "LGB +gas": mae.get("lgb_gasonly", pd.Series(np.nan, index=mae.index)).to_numpy(),
                          "LGB +gas+EUA": mae["lgb_fuel"].to_numpy()})
        t["gain MAE"] = (1 - t["LGB +gas+EUA"] / t["LGB now"]) * 100
        t["bias now"] = bias["lgb_base"].to_numpy()
        t["bias +fuel"] = bias["lgb_fuel"].to_numpy()
        t["regret now"] = reg["lgb_base"].to_numpy()
        t["regret +fuel"] = reg["lgb_fuel"].to_numpy()
        t["regret l+s"] = reg["b_lvlshape"].to_numpy()
        out.append(f"**{label}, period `{period}`** (MAE and regret in EUR/MWh, gain in %)\n\n" + md(t))
    return "\n\n".join(out)


def per_zone_fuel(sc, zones, hs=(2, 5, 7)):
    rows = []
    for z in zones:
        r = {"zone": z}
        for h in hs:
            for p in ("full", "after"):
                s = sc[(sc.zone == z) & (sc.h == h) & (sc.period == p)].set_index("col")["mae"]
                if "lgb_base" in s and "lgb_fuel" in s:
                    r[f"D+{h} {p}"] = (1 - s["lgb_fuel"] / s["lgb_base"]) * 100
        rows.append(r)
    return md(pd.DataFrame(rows))


def group_compare(sc, hs=(2, 4, 7)):
    """Mean over a group's zones of MAE(candidate) / MAE(level+shape) - 1, in per cent, for select / hold / after."""
    rows = []
    for g, zs in RM.GROUPS.items():
        for h in hs:
            for p in ("select", "hold", "after"):
                s = sc[sc.zone.isin(zs) & (sc.h == h) & (sc.period == p)]
                base = s[s.col == RS.BASELINE].set_index("zone")["mae"]
                for c, x in s.groupby("col"):
                    if c in RS.NAIVE or c == "lgb_gasonly" or c.startswith("f_ptes"):
                        continue
                    x = x.set_index("zone")["mae"]
                    if set(zs) - set(x.dropna().index):
                        continue
                    rows.append({"group": g, "h": h, "period": p, "model": c, "rel": ((x[zs] / base[zs]).mean() - 1) * 100})
    d = pd.DataFrame(rows)
    out = []
    for g in RM.GROUPS:
        t = d[(d.group == g)].pivot_table(index="model", columns=["h", "period"], values="rel")
        if t.empty:
            continue
        t.columns = [f"D+{h} {p}" for h, p in t.columns]
        t = t.reset_index()
        out.append(f"**{g}** (MAE vs level+shape, %; negative = better)\n\n" + md(t))
    return "\n\n".join(out)


def winners_md(w, metric):
    t = w.copy()
    t["h"] = "D+" + t["h"].astype(str)
    keep = ["zone", "h", "model", f"{metric}_full", f"{metric}_before", f"{metric}_after", "lvl_full", "gain_lvl_full", "gain_lvl_hold",
            "gain_lvl_before", "gain_lvl_after", "gain_naive_full", "publish"]
    t = t[[c for c in keep if c in t]]
    for c in t.columns:
        if c.startswith("gain"):
            t[c] = t[c] * 100
    t["publish"] = np.where(t["publish"], "PUBLISH", "no")
    return md(t)


def condensed_md(wm, wr, hs=(2, 4, 7)):
    """One row per zone and horizon in `hs`: the MAE winner (model, MAE before / after 2026-09 next to level+shape's, gains), the verdict,
    and the regret of the regret-winner next to level+shape's with its own verdict."""
    rows = []
    for z in RM.ZONE_GROUP:
        for h in hs:
            a = wm[(wm.zone == z) & (wm.h == h)]
            b = wr[(wr.zone == z) & (wr.h == h)]
            if a.empty or b.empty:
                continue
            a, b = a.iloc[0], b.iloc[0]
            rows.append({"zone": z, "h": f"D+{h}", "model": a["model"], "MAE bef": a["mae_before"], "l+s bef": a["lvl_before"],
                         "MAE aft": a["mae_after"], "l+s aft": a["lvl_after"], "vs l+s %": a["gain_lvl_full"] * 100,
                         "hold %": a["gain_lvl_hold"] * 100, "vs naive %": a["gain_naive_full"] * 100,
                         "publish": "PUBLISH" if a["publish"] else "no", "rank model": b["model"],
                         "regret": b["regret_full"], "regret l+s": b["lvl_full"], "rank gain %": b["gain_lvl_full"] * 100,
                         "rank publish": "PUBLISH" if b["publish"] else "no"})
    return md(pd.DataFrame(rows))


def publish_matrix(w):
    """Zones x horizons matrix of the verdicts."""
    m = w.pivot(index="zone", columns="h", values="publish").reindex(list(RM.ZONE_GROUP))
    m.columns = [f"D+{h}" for h in m.columns]
    m = m.map(lambda v: "yes" if v is True else ("-" if v is False else ""))
    m.insert(0, "group", [RM.ZONE_GROUP[z] for z in m.index])
    return md(m.reset_index())


ALL38 = EU25 + NORDIC13


def families_md(sc):
    """Pooled (all 38 zones, hour-weighted) MAE by horizon for every model family, relative to level+shape, plus the bias after the shift."""
    present = set(sc["col"].unique())
    fam = [c for c in ["b_lvlshape", "a_ewm7", "b_ridge_nogas", "b_ridge_gas", "d_lin", "k_level", "k_gas",
                       "lear_r90", "lear_r90_g", "lear_r180", "lear_r180_g", "lear_r365", "lear_r365_g", "lear_r365w", "lear_r365w_g",
                       "lear_l180", "lear_l180_g", "lear_r180_d1", "lear_r365w_d1", "lear_r365w_g_d1",
                       "lgb_base", "lgb_fuel", "hyb_fuel", "cb_base", "cb_fuel", "ens_lt", "ens_lb"] if c in present]
    zs = [z for z in ALL38 if all(((sc.zone == z) & (sc.col == c)).any() for c in fam)]
    out = []
    for period in ("full", "before", "after"):
        mae = RS.pooled(sc, zs, fam, period, "mae")
        base = mae["b_lvlshape"]
        rel = mae.div(base, axis=0).sub(1).mul(100)
        t = rel.T.reset_index().rename(columns={"col": "model", "index": "model"})
        t.columns = ["model"] + [f"D+{h}" for h in rel.index]
        t.insert(1, "MAE D+2 (EUR)", mae.iloc[0].to_numpy())
        out.append(f"**{len(zs)} zones pooled, `{period}`: MAE vs level+shape (%; negative = better)**\n\n" + md(t))
    bias = RS.pooled(sc, zs, fam, "after", "bias")
    tb = bias.loc[[2, 4, 7]].T.reset_index()
    tb.columns = ["model", "bias D+2", "bias D+4", "bias D+7"]
    out.append("**Bias after 2026-09-01 (EUR/MWh; forecast minus actual, negative = too low)**\n\n" + md(tb))
    return "\n\n".join(out)


def main():
    sc = pd.read_csv(os.path.join(DIR, "region_scores.csv"))
    wm = pd.read_csv(os.path.join(DIR, "region_winners_mae.csv"))
    wr = pd.read_csv(os.path.join(DIR, "region_winners_regret.csv"))
    print("## FUEL ABLATION, EU 25 zones\n\n" + fuel_pooled(sc, EU25, "EU 25 zones"))
    print("\n\n## FUEL ABLATION, Nordic 13 zones (incl. NL)\n\n" + fuel_pooled(sc, NORDIC13, "Nordic 13 (DK1 DK2 NO1-5 SE1-4 FI NL)"))
    print("\n\n## PER ZONE gain of LGB+fuel over LGB now (MAE, %)\n\n" + per_zone_fuel(sc, EU25 + NORDIC13))
    print("\n\n## MODEL FAMILIES\n\n" + families_md(sc))
    print("\n\n## CANDIDATES BY GROUP\n\n" + group_compare(sc))
    print("\n\n## CONDENSED PER ZONE\n\n" + condensed_md(wm, wr))
    print("\n\n## WINNERS (MAE)\n\n" + winners_md(wm, "mae"))
    print("\n\n## PUBLISH MATRIX (MAE rule)\n\n" + publish_matrix(wm))
    print("\n\n## WINNERS (regret)\n\n" + winners_md(wr, "regret"))
    print("\n\n## PUBLISH MATRIX (regret rule)\n\n" + publish_matrix(wr))


if __name__ == "__main__":
    main()
