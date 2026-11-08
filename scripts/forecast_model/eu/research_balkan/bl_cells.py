"""Cell-by-cell comparison of the accuracy / gate files: production (prod_files/), control (gate_ctrl/: production recipe rebuilt on today's 26-zone frame) and candidate (gate_cand/).
python3 research_balkan/bl_cells.py out.csv [prod_dir ctrl_dir cand_dir]   -> prints the summary, writes one row per zone, mode and horizon."""
import json, sys
import numpy as np, pandas as pd

def load(d):
    return json.load(open(f"{d}/publish_gate.json")), json.load(open(f"{d}/accuracy_eu.json"))

dirs = sys.argv[2:5] if len(sys.argv) > 4 else ["prod_files", "gate_ctrl", "gate_cand"]
sets = {"prod": load(dirs[0]), "ctrl": load(dirs[1]), "cand": load(dirs[2])}
rows = []
for zone in sets["prod"][0]["zones"]:
    for mode in ("fuel", "nofuel"):
        for h in range(2, 8):
            r = {"zone": zone, "mode": mode, "h": h}
            for tag, (g, a) in sets.items():
                pub = h in g["zones"][zone][mode]
                c = a["zones"][zone][mode].get(str(h)) if pub else None
                r[f"{tag}_pub"] = pub
                for k, name in (("gain", "gain"), ("gainHold", "hold"), ("gainRecent", "recent"), ("bias", "bias"), ("mae", "mae"), ("coverage", "cov"), ("coverageRecent", "covRecent"), ("low", "low")):
                    r[f"{tag}_{name}"] = c.get(k) if c else np.nan
            rows.append(r)
D = pd.DataFrame(rows)
D.to_csv(sys.argv[1] if len(sys.argv) > 1 else "bl_cells.csv", index=False)
for mode in ("fuel", "nofuel"):
    d = D[D["mode"] == mode]
    print(f"\n=== {mode} mode: published prod {int(d.prod_pub.sum())}, ctrl {int(d.ctrl_pub.sum())}, cand {int(d.cand_pub.sum())} of 156")
    for ref in ("prod", "ctrl"):
        both = d[d[f"{ref}_pub"] & d["cand_pub"]]
        print(f"  cand vs {ref}: cells published in both {len(both)}; gained {int((~d[f'{ref}_pub'] & d['cand_pub']).sum())}, lost {int((d[f'{ref}_pub'] & ~d['cand_pub']).sum())}")
        for m in ("gain", "hold", "recent"):
            dl = 100 * (both[f"cand_{m}"] - both[f"{ref}_{m}"])
            print(f"     {m:6s} better {int((dl > 0.05).sum())} / worse {int((dl < -0.05).sum())} / same {int((dl.abs() <= 0.05).sum())}; mean {dl.mean():+.2f} pts, best {dl.max():+.1f}, worst {dl.min():+.1f}")
    both = d[d.ctrl_pub & d.cand_pub]
    for z in ("balkan", "all"):
        s = both if z == "all" else both[both.zone.isin(["me", "mk", "rs", "xk", "al", "gr"])]
        print(f"  {z}: mean gain ctrl -> cand: whole {100*s.ctrl_gain.mean():.2f} -> {100*s.cand_gain.mean():.2f}, hold {100*s.ctrl_hold.mean():.2f} -> {100*s.cand_hold.mean():.2f}, since 2026-09-01 {100*s.ctrl_recent.mean():.2f} -> {100*s.cand_recent.mean():.2f}; coverage whole {s.ctrl_cov.mean():.3f} -> {s.cand_cov.mean():.3f}, since Sept {s.ctrl_covRecent.mean():.3f} -> {s.cand_covRecent.mean():.3f}")
