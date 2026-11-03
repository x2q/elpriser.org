"""Markdown tables for the model cards, generated from the gate files that ship in the repo, so the numbers in a card are the numbers of the files next to it."""
import json
import os


def _load(gate_dir, name):
    with open(os.path.join(gate_dir, name), encoding="utf-8") as f:
        return json.load(f)


def _pct(x):
    return "-" if x is None else f"{x * 100:.0f} %"


def eu_zone_table(gate_dir):
    a = _load(gate_dir, "accuracy_nofuel.json")
    g = _load(gate_dir, "publish_gate.json")
    out = ["| Zone | Recipe | Published | D+2 MAE (naive) | D+2 gain, whole / since Sept | D+7 MAE (naive) | D+7 gain, whole / since Sept | Band coverage D+2, whole / since Sept |",
           "|---|---|---|---|---|---|---|---|"]
    for z, v in a["zones"].items():
        n = v["nofuel"]
        hs = g["zones"][z]["nofuel"]
        rng = "none" if not hs else (f"D+{min(hs)}..D+{max(hs)}" if hs == list(range(min(hs), max(hs) + 1)) else str(hs))

        def cell(h):
            c = n.get(str(h))
            if not c:
                return "-", "-"
            return f"{c['mae']:.1f} ({c['baseMae']:.1f})", f"{_pct(c['gain'])} / {_pct(c['gainRecent'])}"
        m2, g2 = cell(2)
        m7, g7 = cell(7)
        c2 = n.get("2")
        cov = f"{_pct(c2['coverage'])} / {_pct(c2['coverageRecent'])}" if c2 else "-"
        out.append(f"| {z.upper()} | {'LightGBM' if v['recipe'] == 'lgb' else 'ridge + LightGBM'} | {rng} | {m2} | {g2} | {m7} | {g7} | {cov} |")
    return "\n".join(out)


def gb_tables(gate_dir):
    g = _load(gate_dir, "gb_gate.json")
    rest = ["| As-of hour (London) | MAE | Naive level+shape | Persistence | Gain vs naive, whole / since Sept | P10-P90 coverage, whole / since Sept | Published |",
            "|---|---|---|---|---|---|---|"]
    for k in sorted(g["rest"], key=int):
        c = g["rest"][k]
        rest.append(f"| {int(k):02d}:00 | {c['mae']:.1f} | {c['baseMae']:.1f} | {c['persistMae']:.1f} | {_pct(c['gain'])} / {_pct(c['gainRecent'])} | "
                    f"{_pct(c['coverage'])} / {_pct(c['coverageRecent'])} | {'yes' if c['publish'] else 'no'} |")
    days = ["| Day | MAE | Naive level+shape | Persistence | Gain vs naive, whole / since Sept | Bias since Sept | P10-P90 coverage, whole / since Sept | Cheapest-hours bar (5 % on regret) | Published |",
            "|---|---|---|---|---|---|---|---|---|"]
    for k in sorted(g["days"], key=int):
        c = g["days"][k]
        days.append(f"| D+{k} | {c['mae']:.1f} | {c['baseMae']:.1f} | {c['persistMae']:.1f} | {_pct(c['gain'])} / {_pct(c['gainRecent'])} | {c['biasRecent']:+.1f} | "
                    f"{_pct(c['coverage'])} / {_pct(c['coverageRecent'])} | {'passed' if c.get('rankOk') else 'not passed'} | {'yes' if c['publish'] else 'no'} |")
    return "\n".join(rest), "\n".join(days)


def hour23_table(gate_dir):
    h = _load(gate_dir, "hour23_gate.json")
    out = ["| Zone | Method | MAE (EUR/MWh), whole / hold-out / since Sept | Mean price | Gain vs persistence, whole / hold-out / since Sept | P10-P90 coverage, whole / since Sept |",
           "|---|---|---|---|---|---|"]
    for z, c in h["zones"].items():
        out.append(f"| {z.upper()} | {c['method']} | {c['mae']:.1f} / {c['maeHold']:.1f} / {c['maeSince']:.1f} | {c['meanPrice']:.0f} | "
                   f"{_pct(c['gain'])} / {_pct(c['gainHold'])} / {_pct(c['gainRecent'])} | {_pct(c['coverage'])} / {_pct(c['coverageRecent'])} |")
    return "\n".join(out)
