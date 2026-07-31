#!/usr/bin/env python3
"""Pareto frontier over the model's two real, competing objectives.

The v3 work ran into a genuine trade-off rather than a bug: the shape blend
weight moves MAE and min-hour hit-rate in OPPOSITE directions. Leaning on the
model's own intraday shape sharpens the price level (better MAE); leaning on
the seasonal profile ranks the cheap hours better (better hit-rate). A single
number cannot express that, so this maps the whole achievable set.

Decision space swept (all from saved backtest predictions — no retraining):
  - feature variant A/B/C/D (v2-equivalent -> +spatial -> +neighbours -> +capacity)
  - shape blend weight alpha, 0.00 to 1.00 in steps of 0.05

Objectives:
  - MAE in DKK/MWh                     (minimise) — how right the numbers are
  - min-hour hit-rate, actual cheapest
    hour inside predicted top-3        (maximise) — how right the ADVICE is

A config is on the frontier when nothing else is better on one objective
without being worse on the other. Shipped v2 and v3 are marked so we can see
whether what we ship is actually on the frontier or leaving something free.
"""
import os
import numpy as np
import pandas as pd

P = os.path.dirname(os.path.abspath(__file__))
VARIANTS = ["A_v2equiv", "B_spatial", "C_neighbour", "D_congest"]
ALPHAS = np.round(np.arange(0, 1.0001, 0.05), 2)
GUARD_TRIGGER, GUARD_SLOPE = 1.15, 2.0


def load(area):
    df = pd.read_parquet(f"{P}/backtest_v3_{area.lower()}.parquet")
    df["date"] = pd.to_datetime(df["date"])
    return df.sort_values(["date", "h", "hour"]).reset_index(drop=True)


def guarded_alpha(df):
    g = df.groupby(["date", "h"], sort=False)
    dev_s = df["b_seasonal"] - g["b_seasonal"].transform("mean")
    dev_a = df["y"] - g["y"].transform("mean")
    daily = (dev_s - dev_a).abs().groupby(df["date"]).mean().sort_index()
    recent = daily.rolling(14, min_periods=7).mean().shift(10)
    norm = daily.rolling(90, min_periods=30).median().shift(10)
    ratio = (recent / norm).replace([np.inf, -np.inf], np.nan)
    a = np.where(ratio.notna() & (ratio > GUARD_TRIGGER),
                 np.clip(0.5 * (1 - (ratio - GUARD_TRIGGER) * GUARD_SLOPE), 0, 0.5), 0.5)
    return df["date"].map(pd.Series(a, index=daily.index)).fillna(0.5)


def evaluate(df, g, pm_cache, sm, y_is_min, col, alpha):
    """(MAE, hit-rate %) for one prediction column at one blend weight."""
    pm = pm_cache[col]
    a = alpha if isinstance(alpha, pd.Series) else pd.Series(alpha, index=df.index)
    pred = pm + (1 - a) * (df[col] - pm) + a * (df["b_seasonal"] - sm)
    pred = pred.where(sm.notna(), df[col])
    mae = (pred - df.y).abs().mean()
    # rank predictions inside each (date, horizon); a hit is the actual
    # cheapest hour landing in the predicted top 3
    rank = pred.groupby([df.date, df.h]).rank(method="first")
    hit = (rank[y_is_min] <= 3).mean() * 100
    return mae, hit


def pareto(points):
    """points: list of dicts with mae/hit. Returns the non-dominated subset."""
    front = []
    for p in points:
        dominated = any((q["mae"] <= p["mae"] and q["hit"] >= p["hit"] and
                         (q["mae"] < p["mae"] or q["hit"] > p["hit"])) for q in points)
        if not dominated:
            front.append(p)
    return sorted(front, key=lambda p: p["mae"])


def run(area):
    df = load(area)
    g = df.groupby(["date", "h"], sort=False)
    sm = g["b_seasonal"].transform("mean")
    y_rank = g["y"].rank(method="first")
    y_is_min = (y_rank == 1).values
    pm_cache = {f"{v}_md": g[f"{v}_md"].transform("mean") for v in VARIANTS}

    rows = []
    for v in VARIANTS:
        col = f"{v}_md"
        for a in ALPHAS:
            mae, hit = evaluate(df, g, pm_cache, sm, y_is_min, col, float(a))
            rows.append({"variant": v, "alpha": float(a), "mae": mae, "hit": hit})
    # the shipped regime-guarded configuration as a single extra point
    ga = guarded_alpha(df)
    shipped_variant = "D_congest" if area == "DK1" else "C_neighbour"
    mae, hit = evaluate(df, g, pm_cache, sm, y_is_min, f"{shipped_variant}_md", ga)
    rows.append({"variant": shipped_variant, "alpha": "guard", "mae": mae, "hit": hit})

    res = pd.DataFrame(rows)
    res.to_csv(f"{P}/pareto_{area.lower()}.csv", index=False)

    front = pareto(res.to_dict("records"))
    print(f"\n═══ {area} — Pareto frontier ({len(front)} of {len(res)} configs) ═══")
    print(f"{'variant':13} {'alpha':>6} {'MAE':>8} {'hit-rate':>9}")
    for p in front:
        print(f"{p['variant']:13} {str(p['alpha']):>6} {p['mae']:8.1f} {p['hit']:8.1f}%")

    ship = res[(res.variant == shipped_variant) & (res.alpha == "guard")].iloc[0]
    v2 = res[(res.variant == "A_v2equiv") & (res.alpha == 0.5)].iloc[0]
    on_front = any(abs(p["mae"] - ship.mae) < 1e-9 and abs(p["hit"] - ship.hit) < 1e-9
                   for p in front)
    print(f"\n  shipped v3 : MAE {ship.mae:.1f}, hit {ship.hit:.1f}%  "
          f"-> {'ON the frontier' if on_front else 'NOT on the frontier'}")
    print(f"  shipped v2 : MAE {v2.mae:.1f}, hit {v2.hit:.1f}%")
    # what the frontier offers at v2's hit-rate, and at v3's
    better = [p for p in front if p["hit"] >= v2.hit]
    if better:
        b = min(better, key=lambda p: p["mae"])
        print(f"  best config at v2's hit-rate or better: {b['variant']} a={b['alpha']} "
              f"MAE {b['mae']:.1f} ({(b['mae']/v2.mae-1)*100:+.1f}% vs v2)")
    return res, front


if __name__ == "__main__":
    for area in ["DK1", "DK2"]:
        run(area)
