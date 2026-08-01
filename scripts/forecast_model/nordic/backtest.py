#!/usr/bin/env python3
"""Rolling-origin backtest of the pooled 13-zone model.

Reported PER ZONE, not just pooled. A pooled average is exactly the metric
that can look healthy while one zone is served badly — NO4 and NL have very
different price behaviour, and an average over 13 zones would hide either of
them going wrong. The whole point of checking is to catch that.

Baselines per zone:
  seasonal4w  — mean of the same hour on the last 4 same-weekdays
  persistence — same hour on the most recent known day

Post-processing reuses what the Danish model established: the model's daily
LEVEL with its intraday SHAPE blended 50/50 against the seasonal profile.
That was measured there to beat both parents on both metrics, and it is
carried over rather than re-derived.
"""
import os
import numpy as np
import pandas as pd
import lightgbm as lgb

P = os.path.dirname(os.path.abspath(__file__))

FEATS = ["zone", "h", "hour", "weekday", "month", "is_weekend", "doy_sin", "doy_cos",
         "lag1", "lag2", "lag3", "lag7", "lag14", "lag21", "lag28",
         "seasonal4w", "last_day_mean", "level_30d",
         "wind", "rad", "temp", "precip", "precip_24h",
         "reg_wind", "reg_temp", "hydro_precip", "hydro_precip_7d",
         "reservoir_pct", "reservoir_anom", "nordic_reservoir_anom"]
QUANTS = [(0.1, "lo"), (0.5, "md"), (0.9, "hi")]
BLEND = 0.5


def train(df):
    models = {}
    for a, name in QUANTS:
        m = lgb.LGBMRegressor(objective="quantile", alpha=a, n_estimators=500,
                              num_leaves=127, min_child_samples=40, learning_rate=0.05,
                              verbosity=-1, n_jobs=12)
        m.fit(df[FEATS], df["y"], categorical_feature=["zone"])
        models[name] = m
    return models


def blend(frame, col):
    g = frame.groupby(["zone", "date", "h"], observed=True, sort=False)
    pm = g[col].transform("mean")
    sm = g["seasonal4w"].transform("mean")
    out = pm + (1 - BLEND) * (frame[col] - pm) + BLEND * (frame["seasonal4w"] - sm)
    return out.where(sm.notna(), frame[col])


def main():
    df = pd.read_parquet(f"{P}/dataset_nordic.parquet")
    df["t"] = pd.to_datetime(df.t)
    df["date"] = df.t.dt.normalize()
    df = df.sort_values("t")

    preds = []
    for pm in pd.period_range("2025-04", "2026-07", freq="M"):
        train_df = df[df.date < pm.start_time]
        test = df[(df.date >= pm.start_time) & (df.date <= pm.end_time)].copy()
        if len(train_df) < 50_000 or not len(test):
            continue
        # Reservoir columns are legitimately empty for the non-hydro zones
        # (DK1/DK2/NL have no reservoirs), so they must stay OUT of the dropna
        # subset — including them would delete every row for those zones.
        RES = {"reservoir_pct", "reservoir_anom"}
        req = [c for c in FEATS
               if not c.startswith("lag") and c != "zone" and c not in RES]
        tr = train_df.dropna(subset=req)
        models = train(tr)
        for q in ("lo", "md", "hi"):
            test[f"p_{q}"] = models[q].predict(test[FEATS])
        preds.append(test)
        print(f"  {pm}: train {len(tr):,} test {len(test):,}", flush=True)

    out = pd.concat(preds, ignore_index=True)
    out["hyb"] = blend(out, "p_md")
    out["b_persist"] = np.where(out.h <= 4, out.lag3.fillna(out.lag7), out.lag7)
    out.to_parquet(f"{P}/backtest_nordic.parquet", index=False)

    rows = []
    for z, sub in out.groupby("zone", observed=True):
        denom = sub.y.abs().mean()
        g = sub.groupby(["date", "h"], observed=True)
        y_is_min = (g["y"].rank(method="first") == 1).values
        rank = sub.hyb.groupby([sub.date, sub.h]).rank(method="first")
        hit = (rank[y_is_min] <= 3).mean() * 100
        cov = ((sub.y >= sub.p_lo) & (sub.y <= sub.p_hi)).mean() * 100
        # Regret: what following the forecast's 3 cheapest hours costs versus
        # perfect timing. Unlike hit-rate this stays meaningful in flat zones,
        # where being "wrong" between near-identical hours costs almost nothing.
        reg_m, reg_s, reg_r = [], [], []
        for _, gg in sub.groupby(["date", "h"], observed=True):
            if gg.y.isna().all():
                continue
            lo_y = gg.y.min()
            reg_m.append(gg.nsmallest(3, "hyb").y.mean() - lo_y)
            reg_s.append(gg.nsmallest(3, "seasonal4w").y.mean() - lo_y)
            reg_r.append(gg.y.mean() - lo_y)
        rows.append({
            "zone": z, "mean_eur": denom,
            "regret": np.mean(reg_m), "regret_seasonal": np.mean(reg_s),
            "captured%": (1 - np.mean(reg_m) / np.mean(reg_r)) * 100,
            "model": (sub.hyb - sub.y).abs().mean(),
            "seasonal": (sub.seasonal4w - sub.y).abs().mean(),
            "persist": (sub.b_persist - sub.y).abs().mean(),
            "hit%": hit, "raw_cov%": cov,
        })
    r = pd.DataFrame(rows)
    r["model%"] = r.model / r.mean_eur * 100
    r["seasonal%"] = r.seasonal / r.mean_eur * 100
    r["gain%"] = (r.model / r.seasonal - 1) * 100
    print("\n═══ Per-zone MAE (EUR/MWh), test 2025-04 → 2026-07 ═══")
    r["regret_gain%"] = (r.regret / r.regret_seasonal - 1) * 100
    print(r[["zone", "mean_eur", "model", "seasonal", "model%", "gain%",
             "regret", "regret_seasonal", "regret_gain%", "captured%", "hit%"]]
          .round(1).to_string(index=False))
    print(f"\npooled MAE: model {(out.hyb-out.y).abs().mean():.1f} | "
          f"seasonal {(out.seasonal4w-out.y).abs().mean():.1f} | "
          f"persistence {(out.b_persist-out.y).abs().mean():.1f}")
    print("\nMAE by horizon:")
    print(out.assign(ae=(out.hyb-out.y).abs()).groupby("h").ae.mean().round(1).to_string())
    r.to_csv(f"{P}/backtest_by_zone.csv", index=False)
    print("BACKTEST DONE", flush=True)


if __name__ == "__main__":
    main()
