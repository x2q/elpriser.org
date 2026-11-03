"""Models of the Great Britain estimate on the rows of gbfeat.py. Pure functions (numpy / pandas, LightGBM imported where used).

  A   level + shape                      b_A (the naive method every candidate must beat; also the EU model's)
  B   intraday update                    b_A + a ridge on the realised residuals of today's hours so far (decay-weighted), per (as-of hour, day offset);
      b_simple / b_mult                  two fixed rules with no fitted number but the decay: add the mean residual of the last three hours,
                                         resp. scale the shape by the ratio of realised to expected so far, both fading with the hours ahead
  C   ridge + LightGBM on the residual   y - b_A from the full feature set (weather, calendar, lags, intraday); the EU recipe's two models (a rolling
                                         365-day ridge and LightGBM, mean of the two), retrained on Great Britain with the intraday features added
  band                                   LightGBM quantile models (P10 / P90 of y - b_A) widened by 1.2 x the rolling 10th / 90th percentile of their own miss
                                         (the EU quantile-edge recipe, scripts/forecast_model/eu/calibrate_bands.py)
"""
import os
import sys

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import gbfeat as GF                                          # noqa: E402

LGB_PARAMS = dict(objective="quantile", alpha=0.5, n_estimators=300, num_leaves=31, min_child_samples=100, learning_rate=0.06, subsample=0.6,
                  subsample_freq=1, colsample_bytree=0.8, max_bin=127, verbosity=-1)
RIDGE_ALPHA_REL = 0.005
RIDGE_WINDOW_DAYS = 365
MIN_TRAIN_ROWS = 400
BAND_SCALE = 1.2
BAND_WINDOW_DAYS = 180


# ------------------------------------------------------------------ fixed rules (candidate B, no fit)
def b_simple(df, tau=6.0):
    return df["b_A"] + df["rho3"] * np.exp(-df["ahead"] / tau)


def b_mult(df, tau=12.0):
    r = (df["known_mean"] / df["a_known_mean"]).where(df["a_known_mean"] > 20).clip(0.5, 2.0).fillna(1.0)
    return df["b_A"] * (1 + (r - 1) * np.exp(-df["ahead"] / tau))


# ------------------------------------------------------------------ ridge (the EU recipe's: standardised, alpha relative to the sample size)
def ridge_fit(X, y, alpha_rel=RIDGE_ALPHA_REL):
    mu = X.mean(axis=0)
    sd = X.std(axis=0)
    sd[sd < 1e-9] = 1.0
    Z = (X - mu) / sd
    ym = y.mean()
    A = Z.T @ Z + alpha_rel * len(y) * np.eye(X.shape[1])
    return mu, sd, np.linalg.solve(A, Z.T @ (y - ym)), ym


def ridge_predict(m, X):
    mu, sd, beta, b0 = m
    return b0 + ((X - mu) / sd) @ beta


def fit_ridges(train, design, window_days=RIDGE_WINDOW_DAYS, extra_mask=None):
    """{(a, k): model}: one ridge per as-of hour and day offset on the last `window_days` of settled targets (the residual y - b_A)."""
    models = {}
    end = train["date"].max()
    tr = train[train["date"] > end - pd.Timedelta(days=window_days)]
    for (a, k), g in tr.groupby(["a", "k"]):
        g = g.dropna(subset=["y", "b_A"])
        if len(g) < MIN_TRAIN_ROWS:
            continue
        X = design(g)
        Xv = X.to_numpy(float)
        ok = np.isfinite(Xv).all(axis=1)
        if ok.sum() < MIN_TRAIN_ROWS:
            continue
        models[(int(a), int(k))] = (list(X.columns), ridge_fit(Xv[ok], (g["y"] - g["b_A"]).to_numpy(float)[ok]))
    return models


def predict_ridges(models, df, design):
    """b_A + the ridge's correction for every row of df whose (a, k) has a model; NaN elsewhere. The as-of hour of a row without its own model uses the
    nearest trained one at or below it (a job that runs at every hour, trained at a few)."""
    out = pd.Series(np.nan, index=df.index)
    trained_a = sorted({a for a, _ in models})
    for (a, k), g in df.groupby(["a", "k"]):
        use = max([t for t in trained_a if t <= a], default=None)
        if use is None or (use, int(k)) not in models:
            continue
        cols, m = models[(use, int(k))]
        X = design(g)[cols].to_numpy(float)
        ok = np.isfinite(X).all(axis=1) & g["b_A"].notna().to_numpy()
        if ok.any():
            out.loc[g.index[ok]] = g["b_A"].to_numpy()[ok] + ridge_predict(m, X[ok])
    return out


# ------------------------------------------------------------------ LightGBM
def fit_lgb(train, alpha=0.5, jobs=8, feats=GF.LGB_FEATS, params=None):
    import lightgbm as lgb
    tr = train.dropna(subset=["y", "b_A"])
    m = lgb.LGBMRegressor(n_jobs=jobs, **{**LGB_PARAMS, "alpha": alpha, **(params or {})})
    m.fit(tr[feats], tr["y"] - tr["b_A"])
    return m


def predict_lgb(m, df, feats=GF.LGB_FEATS):
    return pd.Series(m.predict(df[feats]) + df["b_A"].to_numpy(), index=df.index)


# ------------------------------------------------------------------ bands
def lead_class(df):
    """The class a band offset belongs to: the rest of today by hours ahead (1-3, 4-8, 9-24), then the day offset k = 1 .. 7."""
    k = df["k"].to_numpy()
    ah = df["ahead"].to_numpy()
    return np.where(k == 0, np.where(ah <= 3, "r1", np.where(ah <= 8, "r2", "r3")), np.char.add("d", k.astype(str)))


def band_offsets(res, window_days=BAND_WINDOW_DAYS, scale=BAND_SCALE, min_n=200):
    """{class: {lo, hi}} from a frame with `cls`, `date` (target day), `y`, `q10`, `q90`: scale x the 10th percentile of y - q10 and the 90th of y - q90
    over the last `window_days` of target days in the frame (all settled)."""
    d = res.dropna(subset=["y", "q10", "q90"])
    if d.empty:
        return {}
    d = d[d["date"] > d["date"].max() - pd.Timedelta(days=window_days)]
    out = {}
    for c, g in d.groupby("cls"):
        if len(g) < min_n:
            continue
        out[str(c)] = {"lo": round(float(np.percentile(g["y"] - g["q10"], 10)) * scale, 2), "hi": round(float(np.percentile(g["y"] - g["q90"], 90)) * scale, 2)}
    return out


def apply_band(df, point, q10, q90, offsets):
    """Absolute P10 / P90 arrays: the quantile models' predictions moved by their class offsets and widened to contain the point estimate."""
    cls = lead_class(df)
    lo = np.array([offsets.get(c, {}).get("lo", np.nan) for c in cls])
    hi = np.array([offsets.get(c, {}).get("hi", np.nan) for c in cls])
    p = np.asarray(point, float)
    return np.minimum(np.asarray(q10, float) + lo, p), np.maximum(np.asarray(q90, float) + hi, p)
