#!/usr/bin/env python3
"""Score the candidate forecasts of region_backtest.py (regions_predictions.parquet) and apply the publish rule.

Scoring. Per (zone, horizon, period) and per forecast column: MAE and bias (EUR/MWh) over the hours and regret (metrics.regret: what
the forecast's 3 cheapest hours cost against the best 3, EUR/MWh) over the complete days. All columns of one zone are scored on the
SAME rows (those where every column that exists for the zone has a value), so a number is never better because it was measured
on easier hours.

Periods: full 2025-04-01..2026-11-02, before / after 2026-09-01 (the price-level shift), select 2025-04-01..2026-06-30 and
hold 2026-07-01.. (the hold-out the winners are NOT chosen on).

Publish rule (the task's): a forecast is published for a zone and horizon only if it is at least 5 % better (MAE) than the naive
'level + shape' baseline out of sample. To keep the "winner" from being picked on the very data it is judged on, the model per
(region group, horizon) is chosen on the SELECT period only, and published only if the 5 % holds on the HOLD-OUT as well as on
the full period.

    python3 region_scores.py [--pred regions_predictions.parquet]
"""
import argparse
import os
import sys

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import metrics as M            # noqa: E402
import region_models as RM     # noqa: E402

T_EVAL = pd.Timestamp("2025-04-01")
T_SHIFT = pd.Timestamp("2026-09-01")
T_HOLD = pd.Timestamp("2026-07-01")
PERIODS = {"full": (T_EVAL, None), "before": (T_EVAL, T_SHIFT), "after": (T_SHIFT, None),
           "select": (T_EVAL, T_HOLD), "hold": (T_HOLD, None)}
NAIVE = RM.NAIVE
BASELINE = "b_lvlshape"
MIN_GAIN = 0.05
NOT_CANDIDATES = set(NAIVE) | {"lgb_gasonly", "y", "zone", "t", "date", "h", "hour", "level_7d", "ewm7"}


def candidate_columns(df):
    return [c for c in df.columns if c not in NOT_CANDIDATES]


def _in_period(dates, period):
    lo, hi = PERIODS[period]
    m = dates >= lo
    return m & (dates < hi) if hi is not None else m


def score_zone_h(sub, cols, period):
    """Metrics of `cols` on one (zone, h) frame sorted by t, restricted to a period, rows where every col in `cols` is present."""
    s = sub[_in_period(sub["date"], period)]
    s = s[s[cols + ["y"]].notna().all(axis=1)]
    if s.empty:
        return []
    out = {c: {"n_hours": len(s), "mae": float(np.abs(s[c] - s["y"]).mean()), "bias": float((s[c] - s["y"]).mean())} for c in cols}
    cnt = s.groupby("date")["y"].transform("size")
    full = s[cnt == 24]
    nd = len(full) // 24
    if nd:
        Y = full["y"].to_numpy().reshape(nd, 24)
        for c in cols:
            out[c]["regret"] = float(np.nanmean(M.regret(Y, full[c].to_numpy().reshape(nd, 24))))
        out["_avg_hour"] = float(np.mean(Y.mean(axis=1) - np.sort(Y, axis=1)[:, :3].mean(axis=1)))
    for c in cols:
        out[c]["n_days"] = nd
        out[c].setdefault("regret", np.nan)
    return [{"col": c, **v} for c, v in out.items() if not c.startswith("_")]


def score(df, cols=None):
    """Long table: zone, h, period, col, n_hours, n_days, mae, bias, regret."""
    cols = cols or (NAIVE + candidate_columns(df) + ["lgb_gasonly"])
    cols = [c for c in dict.fromkeys(cols) if c in df]
    rows = []
    for (z, h), sub in df.groupby(["zone", "h"], sort=True):
        sub = sub.sort_values("t")
        applicable = [c for c in cols if sub[c].notna().any()]
        for p in PERIODS:
            for r in score_zone_h(sub, applicable, p):
                rows.append({"zone": z, "h": int(h), "period": p, **r})
    return pd.DataFrame(rows)


def pooled(scores, zones, cols, period, metric="mae"):
    """Hour- (or day-) weighted pooled metric by horizon over `zones`, for columns defined in all of them."""
    s = scores[scores["zone"].isin(zones) & scores["col"].isin(cols) & (scores["period"] == period)]
    w = "n_hours" if metric in ("mae", "bias") else "n_days"
    g = s.groupby(["h", "col"]).apply(lambda x: np.average(x[metric], weights=x[w]), include_groups=False).unstack("col")
    return g[[c for c in cols if c in g]]


# ------------------------------------------------------------------ winners
def group_scores(scores, group, h, period, metric="mae"):
    """col -> mean over the group's zones of metric(col) / metric(baseline), for columns defined in EVERY zone of the group."""
    zs = RM.GROUPS[group]
    s = scores[scores["zone"].isin(zs) & (scores["h"] == h) & (scores["period"] == period)]
    base = s[s["col"] == BASELINE].set_index("zone")[metric]
    out = {}
    for c, g in s.groupby("col"):
        if c in NAIVE or c == "lgb_gasonly" or c.startswith("f_ptes"):
            continue
        g = g.set_index("zone")[metric]
        if set(zs) - set(g.dropna().index):
            continue
        out[c] = float((g[zs] / base[zs]).mean())
    return out


def pick_winners(scores, metric="mae"):
    """{(group, h): column} chosen on the SELECT period only; the baseline itself if no candidate beats it there."""
    win = {}
    for group in RM.GROUPS:
        for h in range(2, 8):
            gs = group_scores(scores, group, h, "select", metric)
            win[(group, h)] = min(gs, key=gs.get) if gs else BASELINE
    return win


def rel_gain(scores, zone, h, col, period, metric="mae"):
    """1 - metric(col) / metric(baseline) for a zone, horizon and period; NaN if either is missing."""
    s = scores[(scores["zone"] == zone) & (scores["h"] == h) & (scores["period"] == period)].set_index("col")[metric]
    if col not in s or BASELINE not in s or pd.isna(s[col]) or not s[BASELINE]:
        return np.nan
    return float(1 - s[col] / s[BASELINE])


def winners_table(scores, metric="mae"):
    """One row per zone and horizon: the chosen model, its numbers, gains vs 'level+shape' and vs the best naive in every period, and
    the publish verdict (>= 5 % on the hold-out AND on the full period)."""
    win = pick_winners(scores, metric)
    rows = []
    for z, group in RM.ZONE_GROUP.items():
        for h in range(2, 8):
            col = win[(group, h)]
            if z == "pt" and col != BASELINE:                                  # PT may copy the ES forecast of the same model
                own, copy = col, "f_ptes_" + col
                if (scores["col"] == copy).any():
                    g_own, g_cp = (rel_gain(scores, "pt", h, c, "select", metric) for c in (own, copy))
                    if not pd.isna(g_cp) and (pd.isna(g_own) or g_cp > g_own):
                        col = copy
            s = scores[(scores["zone"] == z) & (scores["h"] == h)]
            if s.empty:
                continue
            row = {"zone": z, "group": group, "h": h, "model": col}
            for p in PERIODS:
                sp = s[s["period"] == p].set_index("col")
                if col not in sp.index:
                    continue
                naive = sp.loc[[c for c in NAIVE if c in sp.index], metric]
                row[f"{metric}_{p}"] = sp.loc[col, metric]
                row[f"lvl_{p}"] = sp.loc[BASELINE, metric] if BASELINE in sp.index else np.nan
                row[f"best_naive_{p}"] = naive.min()
                row[f"gain_lvl_{p}"] = 1 - sp.loc[col, metric] / row[f"lvl_{p}"]
                row[f"gain_naive_{p}"] = 1 - sp.loc[col, metric] / row[f"best_naive_{p}"]
            row["bias_after"] = s[(s["period"] == "after") & (s["col"] == col)]["bias"].mean()
            row["publish"] = bool(row.get("gain_lvl_hold", -1) >= MIN_GAIN and row.get("gain_lvl_full", -1) >= MIN_GAIN and col != BASELINE)
            rows.append(row)
    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pred", default="regions_predictions.parquet")
    a = ap.parse_args()
    df = pd.read_parquet(os.path.join(DIR, a.pred))
    df["date"] = pd.to_datetime(df["date"])
    df = df[df["h"].between(2, 7)]
    sc = score(df)
    sc.to_csv(os.path.join(DIR, "region_scores.csv"), index=False)
    wm = winners_table(sc, "mae")
    wm.to_csv(os.path.join(DIR, "region_winners_mae.csv"), index=False)
    wr = winners_table(sc, "regret")
    wr.to_csv(os.path.join(DIR, "region_winners_regret.csv"), index=False)
    print(f"scores: {len(sc):,} rows -> region_scores.csv; winners: region_winners_mae.csv ({int(wm.publish.sum())} publish of {len(wm)}), "
          f"region_winners_regret.csv ({int(wr.publish.sum())} of {len(wr)})")


if __name__ == "__main__":
    main()
