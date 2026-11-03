#!/usr/bin/env python3
"""Backtest of the hour-23 estimate for Portugal and Ireland -> hour23_gate.json.

    python3 backtest_hour23.py --pt price_pt.parquet --ie price_ie.parquet [--out hour23_gate.json]

The price files are the EU job's ENTSO-E caches (hourly, the zone's own clock). For every day with hours 0..22 priced, the estimate of hour 23 is made from
that and the days before only, and scored against the price that was then settled. Window: 2025-04-01 .. the end; hold-out 2026-07-01 ..; since the price shift
2026-09-01 ... Publishing rule (the EU model's, with the same bar for the naive method): the chosen method must not be worse than the best naive method (persistence of
hour 22, yesterday's hour 23, last week's hour 23) on the whole backtest AND the hold-out, and must be the better of the two methods on the part before the hold-out
(chosen there, so the hold-out is untouched); if the chosen one fails the rule the zone publishes the naive persistence itself, which claims no gain. The band is rolling out of sample: offsets from the residuals of the 180 days that ended 2 days before each month.
"""
import argparse
import json
import os
import sys
from datetime import date

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import hour23 as H                                      # noqa: E402

START = pd.Timestamp("2025-04-01")
HOLD = pd.Timestamp("2026-07-01")
SINCE = pd.Timestamp("2026-09-01")


def matrix(path):
    d = pd.read_parquet(path)
    s = d.set_index(pd.to_datetime(d["t"]))["eur_mwh"].sort_index()
    s = s[~s.index.duplicated()]
    days = pd.date_range(s.index.min().normalize(), s.index.max().normalize())
    full = pd.date_range(days[0], days[-1] + pd.Timedelta(hours=23), freq="h")
    return days, s.reindex(full).to_numpy(float).reshape(len(days), 24)


def frame(path):
    days, P = matrix(path)
    rows = []
    for i in range(40, len(days)):
        if not (np.isfinite(P[i, 23]) and np.isfinite(P[i, :23]).all()):
            continue
        r = {"date": days[i], "y": P[i, 23]}
        r.update({f"n_{k}": v for k, v in H.naive(P, i).items()})
        r.update({f"m_{m}": H.estimate(P, i, m) for m in H.METHODS})
        rows.append(r)
    return pd.DataFrame(rows)


def window(df, name):
    return {"all": df[df["date"] >= START], "pre": df[(df["date"] >= START) & (df["date"] < HOLD)], "hold": df[df["date"] >= HOLD], "since": df[df["date"] >= SINCE]}[name]


def mae(df, c):
    s = df.dropna(subset=["y", c])
    return float((s[c] - s["y"]).abs().mean()) if len(s) else np.nan


def rolling_band(df, col):
    """Coverage of the rolling band: for each calendar month from START + 180 days on, offsets from the residuals of the 180 days ending 2 days before it."""
    out = []
    for lo in pd.date_range(START + pd.Timedelta(days=180), df["date"].max(), freq="MS"):
        hi = lo + pd.offsets.MonthBegin(1)
        tr = df[(df["date"] < lo - pd.Timedelta(days=2)) & (df["date"] >= lo - pd.Timedelta(days=182))]
        off = H.band_offsets(tr["y"] - tr[col])
        te = df[(df["date"] >= lo) & (df["date"] < hi)].dropna(subset=["y", col]).copy()
        if off is None or te.empty:
            continue
        te["lo"], te["hi"] = np.minimum(te[col] + off[0], te[col]), np.maximum(te[col] + off[1], te[col])
        out.append(te)
    return pd.concat(out) if out else pd.DataFrame()


def zone_report(z, path):
    df = frame(path)
    nv = ["n_persist", "n_yday", "n_lag7"]
    cells = {}
    for name in ("all", "pre", "hold", "since"):
        w = window(df, name)
        cells[name] = {c: mae(w, c) for c in nv + ["m_persist", "m_med28"]} | {"n": len(w), "meanPrice": float(w["y"].mean()) if len(w) else None}
    pre = {m: cells["pre"][f"m_{m}"] for m in H.METHODS}
    method = min(pre, key=lambda m: (np.nan_to_num(pre[m], nan=1e9), m != "persist"))
    best_naive = lambda name: min(cells[name][c] for c in nv)
    ok = lambda m: all(cells[n][f"m_{m}"] <= best_naive(n) * (1 + 1e-9) for n in ("all", "hold"))
    if not ok(method):                  # the chosen method is not good enough: the naive method itself (publishing it claims no gain: gain 0)
        method = "persist"
    col = f"m_{method}"
    passes = ok(method)
    band = rolling_band(df, col)
    cov = float(((band["y"] >= band["lo"]) & (band["y"] <= band["hi"])).mean()) if len(band) else None
    covs = band[band["date"] >= SINCE]
    cov_since = float(((covs["y"] >= covs["lo"]) & (covs["y"] <= covs["hi"])).mean()) if len(covs) else None
    last = df[df["date"] >= df["date"].max() - pd.Timedelta(days=BAND_DAYS_)]
    off = H.band_offsets(last["y"] - last[col])
    return {"method": method, "publish": bool(passes), "mae": cells["all"][col], "baseMae": cells["all"]["n_persist"], "bestNaiveMae": best_naive("all"),
            "gain": 1 - cells["all"][col] / cells["all"]["n_persist"], "gainHold": 1 - cells["hold"][col] / cells["hold"]["n_persist"],
            "gainRecent": 1 - cells["since"][col] / cells["since"]["n_persist"], "maeHold": cells["hold"][col], "maeSince": cells["since"][col],
            "coverage": cov, "coverageRecent": cov_since, "bandLo": off[0] if off else None, "bandHi": off[1] if off else None,
            "days": cells["all"]["n"], "meanPrice": cells["all"]["meanPrice"], "windows": cells}


BAND_DAYS_ = H.BAND_DAYS


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pt", required=True)
    ap.add_argument("--ie", required=True)
    ap.add_argument("--out", default=os.path.join(DIR, "hour23_gate.json"))
    a = ap.parse_args()
    zones = {}
    for z, path in (("pt", a.pt), ("ie", a.ie)):
        r = zone_report(z, path)
        zones[z] = r
        print(f"{z}: method {r['method']} publish={r['publish']} days {r['days']} mean price {r['meanPrice']:.0f}")
        for name in ("all", "pre", "hold", "since"):
            c = r["windows"][name]
            print(f"   {name:5s} n={c['n']:4d}  " + "  ".join(f"{k}:{c[k]:.2f}" for k in ("n_persist", "n_yday", "n_lag7", "m_persist", "m_med28")))
        print(f"   gain vs persistence: all {r['gain']:+.1%} hold {r['gainHold']:+.1%} since Sept {r['gainRecent']:+.1%}; band coverage {r['coverage']:.3f} (since Sept {r['coverageRecent']:.3f}); offsets {r['bandLo']}, {r['bandHi']}")
    slim = {z: {k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items() if k != "windows"} for z, r in zones.items()}
    doc = {"version": 1, "built": date.today().isoformat(), "period": f"{START:%Y-%m-%d}..", "holdOut": f"{HOLD:%Y-%m-%d}..", "recent": f"{SINCE:%Y-%m-%d}",
           "model": "hour23-v1", "baseline": "persistence of hour 22",
           "rule": "published only if the method's MAE is not worse than the best naive method (hour 22, yesterday's hour 23, last week's hour 23) on the whole backtest and on the hold-out; the method is chosen before the hold-out",
           "zones": slim}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1)
        f.write("\n")
    print("wrote", a.out)


if __name__ == "__main__":
    main()
