#!/usr/bin/env python3
"""Tables of docs/forecast-nordic-ens.md from decision_ens.json (written by decide_recipe.py): per zone and horizon the chosen recipe against the pooled model
(MAE gain over level+shape whole / hold-out / since 2026-09-01, regret gain whole / hold-out / since September, bias since September), and the cell counts
(improve = both whole and hold-out gain higher, worse = both lower, mixed = one each; lose = the recipe passes the gate and the pooled model does not, or the reverse).

    python3 report_ens.py [decision_ens.json] [--cand ens]      --cand: show this candidate for EVERY zone instead of the decision (e.g. the staged `ens` for FI)
"""
import json
import sys

HS = range(2, 9)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    cand = sys.argv[sys.argv.index("--cand") + 1] if "--cand" in sys.argv else None
    if cand in args:
        args.remove(cand)
    d = json.load(open(args[0] if args else "decision_ens.json"))
    cells, zones = d["cells"], d["zones"]
    tot = {"improve": 0, "worse": 0, "mixed": 0, "lose": 0, "gain_gate": 0, "same": 0}
    thin, rank = [], {"lost": [], "gained": []}
    for z, v in zones.items():
        n = cand or v["recipe"]
        if n == "pooled":
            print(f"\n{z}: pooled (no switch)")
            continue
        print(f"\n{z}: {n} vs pooled   MAE gain % over level+shape  whole / hold-out / since Sep   |  regret gain %  whole / hold-out / since Sep  |  bias since Sep (EUR/MWh)")
        for h in HS:
            p, c = cells[f"{z}|pooled|{h}"], cells[f"{z}|{n}|{h}"]
            pg, cg = (min(p["gain_full"], p["gain_hold"]) >= 5), (min(c["gain_full"], c["gain_hold"]) >= 5)
            if pg and not cg:
                kind = "lose"
            elif cg and not pg:
                kind = "gain_gate"
            elif c["gain_full"] > p["gain_full"] and c["gain_hold"] > p["gain_hold"]:
                kind = "improve"
            elif c["gain_full"] < p["gain_full"] and c["gain_hold"] < p["gain_hold"]:
                kind = "worse"
            else:
                kind = "mixed"
            tot[kind] += 1
            pr, cr = min(p["rg_full"], p["rg_hold"]) >= 5, min(c["rg_full"], c["rg_hold"]) >= 5
            if pr and not cr:
                rank["lost"].append(f"{z} D+{h}")
            if cr and not pr:
                rank["gained"].append(f"{z} D+{h}")
            if cg and min(c["gain_full"], c["gain_hold"]) < 8:
                thin.append(f"{z} D+{h} {min(c['gain_full'], c['gain_hold']):.1f}")
            f = lambda x: f"{x:5.1f}"
            print(f"  D+{h}  pooled {f(p['gain_full'])}/{f(p['gain_hold'])}/{f(p['gain_after'])}  {n} {f(c['gain_full'])}/{f(c['gain_hold'])}/{f(c['gain_after'])}  |  "
                  f"pooled {f(p['rg_full'])}/{f(p['rg_hold'])}/{f(p['rg_after'])}  {n} {f(c['rg_full'])}/{f(c['rg_hold'])}/{f(c['rg_after'])}  |  "
                  f"{p['bias_after']:6.1f} -> {c['bias_after']:6.1f}   {kind}")
    print("\ncell counts:", tot, " thin passes (< 8 % on the weaker period):", thin or "none")
    print("rankOk (regret gain >= 5 % whole AND hold-out; the page may claim hour ranking) lost:", rank["lost"] or "none", " gained:", rank["gained"] or "none")


if __name__ == "__main__":
    main()
