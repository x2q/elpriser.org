#!/usr/bin/env python3
"""Pareto frontier: visualise it, and test whether moving along it is real.

The sweep in pareto.py maps the achievable (MAE, hit-rate) set. But picking
the best-looking point from that same backtest is selection on the test set —
the exact mistake this project has been careful to avoid elsewhere. So before
recommending any move along the frontier, this bootstraps the difference
between candidate points over DAYS (paired: every config sees the same
resampled days), and reports confidence intervals.

If the interval for a difference straddles zero, the two configs are
indistinguishable on this evidence and preferring one is noise-chasing.
"""
import os
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

P = os.path.dirname(os.path.abspath(__file__))
N_BOOT = 400
RNG = np.random.default_rng(12345)


def guard_alpha(df, sm, g, base):
    dev_s = df["b_seasonal"] - sm
    dev_a = df["y"] - g["y"].transform("mean")
    daily = (dev_s - dev_a).abs().groupby(df["date"]).mean().sort_index()
    recent = daily.rolling(14, min_periods=7).mean().shift(10)
    norm = daily.rolling(90, min_periods=30).median().shift(10)
    ratio = (recent / norm).replace([np.inf, -np.inf], np.nan)
    a = np.where(ratio.notna() & (ratio > 1.15),
                 np.clip(base * (1 - (ratio - 1.15) * 2.0), 0, base), base)
    return df["date"].map(pd.Series(a, index=daily.index)).fillna(base)


def predict(df, g, sm, col, alpha):
    pm = g[col].transform("mean")
    a = alpha if isinstance(alpha, pd.Series) else pd.Series(alpha, index=df.index)
    p = pm + (1 - a) * (df[col] - pm) + a * (df["b_seasonal"] - sm)
    return p.where(sm.notna(), df[col])


def per_day(df, g, pred, y_is_min):
    """Per-day AE mean and per-day hit flag, so the bootstrap can resample days."""
    ae = (pred - df.y).abs().groupby(df.date).mean()
    rank = pred.groupby([df.date, df.h]).rank(method="first")
    hits = pd.DataFrame({"date": df.date[y_is_min].values,
                         "hit": (rank[y_is_min] <= 3).values}).groupby("date").hit.mean()
    return ae, hits


def run(area, variant):
    df = pd.read_parquet(f"{P}/backtest_v3_{area.lower()}.parquet")
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["date", "h", "hour"]).reset_index(drop=True)
    g = df.groupby(["date", "h"], sort=False)
    sm = g["b_seasonal"].transform("mean")
    y_is_min = (g["y"].rank(method="first") == 1).values
    col = f"{variant}_md"

    cands = {f"guard base {b:.2f}": guard_alpha(df, sm, g, b) for b in (0.50, 0.55, 0.60, 0.70)}
    cands["fixed 0.50 (v2 style)"] = 0.5
    stats = {}
    for name, a in cands.items():
        ae, hits = per_day(df, g, predict(df, g, sm, col, a), y_is_min)
        stats[name] = (ae, hits)

    days = stats["guard base 0.50"][0].index.to_numpy()
    base_name = "guard base 0.50"
    print(f"\n═══ {area} ({variant}) — paired bootstrap vs shipped ({base_name}), "
          f"{N_BOOT} resamples over {len(days)} days ═══")
    print(f"{'config':24} {'MAE':>7} {'hit':>7}   {'ΔMAE 95% CI':>22} {'Δhit 95% CI':>22}")
    b_ae, b_hit = stats[base_name]
    for name, (ae, hits) in stats.items():
        d_mae, d_hit = [], []
        for _ in range(N_BOOT):
            s = RNG.choice(days, size=len(days), replace=True)
            d_mae.append(ae.reindex(s).mean() - b_ae.reindex(s).mean())
            d_hit.append((hits.reindex(s).mean() - b_hit.reindex(s).mean()) * 100)
        lo_m, hi_m = np.percentile(d_mae, [2.5, 97.5])
        lo_h, hi_h = np.percentile(d_hit, [2.5, 97.5])
        sig = "" if (lo_h <= 0 <= hi_h) else "  *"
        print(f"{name:24} {ae.mean():7.1f} {hits.mean()*100:6.1f}%   "
              f"[{lo_m:+7.2f},{hi_m:+7.2f}]   [{lo_h:+6.2f},{hi_h:+6.2f}]{sig}")
    print("  * = hit-rate difference excludes zero; otherwise the configs are "
          "indistinguishable on this evidence")
    return stats


def plot():
    fig, axes = plt.subplots(1, 2, figsize=(13, 5))
    for ax, (area, shipped) in zip(axes, (("DK1", "D_congest"), ("DK2", "C_neighbour"))):
        res = pd.read_csv(f"{P}/pareto_{area.lower()}.csv")
        sweep = res[res.alpha != "guard"].copy()
        sweep["alpha"] = sweep.alpha.astype(float)
        colors = {"A_v2equiv": "#999999", "B_spatial": "#8e44ad",
                  "C_neighbour": "#0e9888", "D_congest": "#1b57f5"}
        for v, sub in sweep.groupby("variant"):
            sub = sub.sort_values("alpha")
            ax.plot(sub.mae, sub.hit, "-o", ms=3, lw=1.2, color=colors[v], alpha=.75, label=v)
        pts = res.to_dict("records")
        front = [p for p in pts if not any(
            (q["mae"] <= p["mae"] and q["hit"] >= p["hit"] and
             (q["mae"] < p["mae"] or q["hit"] > p["hit"])) for q in pts)]
        front = sorted(front, key=lambda p: p["mae"])
        ax.plot([p["mae"] for p in front], [p["hit"] for p in front],
                "-", color="k", lw=2.2, alpha=.55, label="Pareto frontier", zorder=1)
        gp = res[res.alpha == "guard"].iloc[0]
        ax.scatter([gp.mae], [gp.hit], s=190, marker="*", color="#d02b22",
                   zorder=5, label="shipped v3 (regime guard)")
        v2 = res[(res.variant == "A_v2equiv") & (res.alpha.astype(str) == "0.5")].iloc[0]
        ax.scatter([v2.mae], [v2.hit], s=110, marker="X", color="#555", zorder=5, label="v2")
        ax.set(title=f"{area}", xlabel="MAE, DKK/MWh  (lower is better)",
               ylabel="min-hour hit-rate %  (higher is better)")
        ax.grid(alpha=.25)
        ax.legend(fontsize=7.5, loc="lower right")
    fig.suptitle("Pareto frontier: price accuracy vs. usefulness of the advice", fontsize=12.5)
    fig.tight_layout()
    fig.savefig(f"{P}/pareto_frontier.png", dpi=130)
    print("\nsaved pareto_frontier.png")


if __name__ == "__main__":
    run("DK1", "D_congest")
    run("DK2", "C_neighbour")
    plot()
