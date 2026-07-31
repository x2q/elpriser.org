#!/usr/bin/env python3
"""v3 backtest with incremental ablation, so each change has to earn its place.

Variants (each adds to the previous):
  A  v2-equivalent      single mean weather point, fixed 0.5 shape blend
  B  + spatial          individual weather points + wind_spread
  C  + neighbours       NO2/SE3/SE4/NL weather at correct lead
  D  + congestion       month-ahead transfer capacity per border
  E  + adaptive blend   full v3

THE ADAPTIVE BLEND, and why it is not just another hand-tuned constant:
v2 fixed the model/seasonal shape blend at 0.5, which is exactly the
assumption that breaks during a regime shift. Here the weight is FITTED at
every retrain: the last 30 days of training data are held out, a model is
trained on the remainder and used to predict that slice, and the blend weight
is grid-searched on it per horizon. The held-out slice is essential — scoring
the blend on rows the model trained on would make the model's own shape look
artificially good and drive the weight to 0. Because the fit repeats monthly
on recent data, a regime shift shows up as the seasonal profile doing badly
on the recent slice, and the weight drops on its own.
"""
import os, json
import numpy as np
import pandas as pd
import lightgbm as lgb

P = os.path.dirname(os.path.abspath(__file__))

BASE = ["h", "hour", "weekday", "month", "is_weekend", "doy_sin", "doy_cos",
        "lag1", "lag2", "lag3", "lag7", "lag14", "lag21", "lag28",
        "seasonal4w", "last_day_mean"]
V2_WEATHER = ["wind", "rad", "wind_de", "rad_de", "temp", "est_prod", "est_prod_de"]
SPATIAL = ([f"wind_p{i}" for i in range(4)] + [f"rad_p{i}" for i in range(4)] +
           [f"temp_p{i}" for i in range(4)] + ["wind_spread"] +
           [f"wind_de{i}" for i in range(3)] + [f"rad_de{i}" for i in range(3)])
NEIGH = [f"{v}_{n}" for n in ("no2", "se3", "se4", "nl") for v in ("wind", "rad")]

ALPHAS = [0.0, 0.2, 0.35, 0.5, 0.65, 0.8, 1.0]
QUANTS = [(0.1, "lo"), (0.5, "md"), (0.9, "hi")]


def train_q(df, feats, alphas=QUANTS):
    out = {}
    for a, name in alphas:
        m = lgb.LGBMRegressor(objective="quantile", alpha=a, n_estimators=400,
                              num_leaves=63, min_child_samples=30, learning_rate=0.05,
                              verbosity=-1, n_jobs=10)
        m.fit(df[feats], df["y"])
        out[name] = m
    return out


def blend(pred, seasonal, alpha):
    """Model day level + shape mixed (1-alpha) model / alpha seasonal."""
    pm, sm = pred.mean(), seasonal.mean()
    if np.isnan(sm):
        return pred
    return pm + (1 - alpha) * (pred - pm) + alpha * (seasonal - sm)


def apply_blend(frame, pred_col, alpha):
    """Vectorised per (date, horizon) group. `alpha` is either a dict keyed by
    horizon or a per-row Series — the latter matters for the adaptive variant,
    whose weight is refitted every month and so differs row to row."""
    g = frame.groupby(["date", "h"], sort=False)
    pm = g[pred_col].transform("mean")
    sm = g["b_seasonal"].transform("mean")
    a = alpha if isinstance(alpha, pd.Series) else frame["h"].map(alpha)
    a = pd.Series(a, index=frame.index).astype(float)
    out = pm + (1 - a) * (frame[pred_col] - pm) + a * (frame["b_seasonal"] - sm)
    return out.where(sm.notna(), frame[pred_col])


def hit_rate(sub, pred):
    """Share of days where the actual cheapest hour lands in the predicted
    top-3 — the thing the page is actually used for."""
    d = sub.assign(_p=pred.values)
    hits = []
    for _, day in d.groupby("date"):
        if day.y.isna().all():
            continue
        hits.append(day.loc[day.y.idxmin(), "hour"] in set(day.nsmallest(3, "_p").hour))
    return float(np.mean(hits)) if hits else 0.0


def fit_alpha(train, feats):
    """Grid-search the blend weight per horizon on a held-out recent slice.

    Objective note — this is the part that matters. Fitting purely on MAE
    picks low weights (trusting the model's own intraday shape) and measurably
    DAMAGES the min-hour hit-rate: in the first ablation run the MAE-optimal
    adaptive weight cut DK1 MAE by 5.5% while dropping hit-rate 69.3% -> 66.1%.
    That is a regression in exactly what the forecast is used for. So the
    search is constrained: among the weights that do not lose hit-rate versus
    the fixed 0.5 blend on the same holdout, take the one with the lowest MAE.
    Adaptivity is kept where it is free, and the product metric is protected.
    """
    cut = train.date.max() - pd.Timedelta(days=30)
    inner, holdout = train[train.date <= cut], train[train.date > cut].copy()
    if len(holdout) < 2000 or len(inner) < 5000:
        return {h: 0.5 for h in train.h.unique()}
    m = train_q(inner, feats, alphas=[(0.5, "md")])["md"]
    holdout["p"] = m.predict(holdout[feats])
    holdout["b_seasonal"] = holdout["seasonal4w"]
    best = {}
    for h, sub in holdout.groupby("h"):
        cands = []
        for a in ALPHAS:
            pred = apply_blend(sub, "p", {h: a})
            cands.append((a, (pred - sub.y).abs().mean(), hit_rate(sub, pred)))
        base_hit = next(c[2] for c in cands if c[0] == 0.5)
        ok = [c for c in cands if c[2] >= base_hit - 0.005]   # 0.5pp tolerance for noise
        best[int(h)] = min(ok or cands, key=lambda c: c[1])[0]
    return best


def run(area):
    df = pd.read_parquet(f"{P}/dataset_v3_{area.lower()}.parquet")
    df["t"] = pd.to_datetime(df.t)
    df["date"] = df.t.dt.normalize()
    df = df.sort_values("t")
    cong = [c for c in df.columns if c.startswith("ntc_")]

    variants = {
        "A_v2equiv":   BASE + V2_WEATHER,
        "B_spatial":   BASE + V2_WEATHER + SPATIAL,
        "C_neighbour": BASE + V2_WEATHER + SPATIAL + NEIGH,
        "D_congest":   BASE + V2_WEATHER + SPATIAL + NEIGH + cong,
    }

    preds, alpha_log = [], []
    for pm in pd.period_range("2025-04", "2026-07", freq="M"):
        train = df[df.date < pm.start_time]
        test = df[(df.date >= pm.start_time) & (df.date <= pm.end_time)].copy()
        if len(train) < 5000 or not len(test):
            continue
        test["b_seasonal"] = test["seasonal4w"]
        for vname, feats in variants.items():
            # DK2 has three weather points, not four, so the padded p3 columns
            # are entirely empty there — dropna on them would delete every row.
            req = [c for c in feats if not c.startswith("lag") and train[c].notna().any()]
            tr = train.dropna(subset=req)
            models = train_q(tr, feats)
            for q in ("lo", "md", "hi"):
                test[f"{vname}_{q}"] = models[q].predict(test[feats])
        # adaptive alpha fitted on the richest feature set only
        a_by_h = fit_alpha(train, variants["D_congest"])
        alpha_log.append({"month": str(pm), **{f"h{k}": v for k, v in a_by_h.items()}})
        test["_alpha_map"] = test.h.map(a_by_h)
        preds.append(test)
        print(f"  {area} {pm}: train {len(train):,} test {len(test):,} alpha={a_by_h}", flush=True)

    out = pd.concat(preds, ignore_index=True)
    out.to_parquet(f"{P}/backtest_v3_{area.lower()}.parquet", index=False)
    pd.DataFrame(alpha_log).to_csv(f"{P}/alpha_log_{area.lower()}.csv", index=False)

    # ── scoring ──
    fixed = {h: 0.5 for h in out.h.unique()}
    res = {}
    for vname in variants:
        out[f"{vname}_hyb"] = apply_blend(out, f"{vname}_md", fixed)
        res[vname] = out[f"{vname}_hyb"]
    out["E_adaptive_hyb"] = apply_blend(out, "D_congest_md", out["_alpha_map"])
    res["E_adaptive"] = out["E_adaptive_hyb"]

    print(f"\n═══ {area} — MAE DKK/MWh (hybrid-post-processed) ═══")
    tbl = pd.DataFrame({k: (v - out.y).abs() for k, v in res.items()}).assign(h=out.h.values)
    print(tbl.groupby("h").mean().round(1).to_string())
    print("\noverall:")
    overall = tbl.drop(columns="h").mean()
    for k, v in overall.items():
        delta = (v / overall["A_v2equiv"] - 1) * 100
        print(f"  {k:14} {v:7.1f}  ({delta:+5.1f}% vs v2-equivalent)")

    # min-hour hit-rate — the metric the seasonal blend exists to protect
    g = out.groupby(["date", "h"])
    amin = g.apply(lambda x: x.loc[x.y.idxmin(), "hour"], include_groups=False)
    print("\nmin-hour hit-rate % (actual cheapest hour in predicted top-3):")
    for k in res:
        col = f"{k}_hyb" if k != "E_adaptive" else "E_adaptive_hyb"
        top3 = g.apply(lambda x: set(x.nsmallest(3, col).hour), include_groups=False)
        hit = np.mean([a in t for a, t in zip(amin, top3)]) * 100
        print(f"  {k:14} {hit:5.1f}")
    return out


if __name__ == "__main__":
    for a in ["DK1", "DK2"]:
        run(a)
    print("BACKTEST DONE", flush=True)
