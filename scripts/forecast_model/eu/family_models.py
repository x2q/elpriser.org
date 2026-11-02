"""Model FAMILIES of the bake-off in docs/forecast-per-region.md, section 'model families': a rolling-window LEAR (lasso / ridge), a
Kalman local-level model, interval scores for the quantile models, and the simple ensembles. Pure functions on arrays / frames - no
files, no network - so they are unit-tested; family_backtest.py, catboost_backtest.py and quantile_backtest.py are the orchestration.

LEAR here is the pooled-over-hours form: one model per (zone, horizon) with hour dummies and hour x wind / solar interactions
(region_models.design), not 24 separate hourly models - 24 models of ~30 features on 90 days of one row each would have had
more parameters than rows in the shortest window. Its target is the residual of the naive 'level + shape' baseline, so the level
enters through the baseline and the regression only has to explain the deviation. The training window of a refit on day r holds
the targets of days r-W-h+1 .. r-h only: exactly what was settled when the first forecast of the block was issued (the 2-month folds
of the other models let up to h-1 days of newer targets into training at a fold boundary; for a refit every few days that would
matter, so it is closed here).
"""
import numpy as np
import pandas as pd


# ------------------------------------------------------------------ LEAR: weighted ridge / lasso on a rolling window
def standardise(X, w):
    mu = np.average(X, axis=0, weights=w)
    sd = np.sqrt(np.average((X - mu) ** 2, axis=0, weights=w))
    sd[sd < 1e-9] = 1.0
    return mu, sd


def ridge_fit(X, y, w, alpha_rel=0.005):
    """Weighted ridge on standardised X with a free intercept. alpha is relative to the effective sample size (alpha_rel x sum of
    weights), so a 90-day and a 365-day window shrink alike. Returns (mu, sd, beta, intercept)."""
    mu, sd = standardise(X, w)
    Z = (X - mu) / sd
    ym = np.average(y, weights=w)
    A = Z.T @ (Z * w[:, None]) + alpha_rel * w.sum() * np.eye(X.shape[1])
    b = Z.T @ (w * (y - ym))
    return mu, sd, np.linalg.solve(A, b), ym


def lasso_fit(X, y, w, alpha=0.3):
    """Lasso (coordinate descent) on standardised X; alpha is in EUR/MWh per standardised unit - fixed, not tuned."""
    from sklearn.linear_model import Lasso
    mu, sd = standardise(X, w)
    m = Lasso(alpha=alpha, max_iter=3000, tol=1e-3).fit((X - mu) / sd, y, sample_weight=w)
    return mu, sd, m.coef_, float(m.intercept_)


def linear_predict(model, X):
    mu, sd, beta, b0 = model
    return b0 + ((X - mu) / sd) @ beta


def recency_weights(dates, last, halflife_days):
    """Exponential sample weights by age in days relative to `last` (None = equal weights)."""
    if not halflife_days:
        return np.ones(len(dates))
    age = (np.datetime64(last) - dates).astype("timedelta64[D]").astype(float)
    return 0.5 ** (age / halflife_days)


def lear_block(X, y_res, base, dates, h, refit_days, window, halflife, kind, test_from, test_to, step):
    """Rolling LEAR predictions for ONE (zone, horizon).

    X, y_res, base, dates   aligned arrays over the zone-horizon's rows sorted by time (X float, y_res = y - base)
    refit_days              np.datetime64 array of refit days r; a refit on r predicts the rows dated r .. r + step - 1
    window                  training window in days, ending at r - h (the newest target settled when the block's first forecast is issued)
    Returns an array (len(dates)) of base + predicted residual, NaN outside the test period or where a feature is missing."""
    out = np.full(len(dates), np.nan)
    ok = np.isfinite(X).all(axis=1) & np.isfinite(y_res)
    for r in refit_days:
        if r < test_from or r > test_to:
            continue
        te_lo = np.searchsorted(dates, r, side="left")
        te_hi = np.searchsorted(dates, r + np.timedelta64(step, "D"), side="left")
        end = r - np.timedelta64(h, "D")
        tr_hi = np.searchsorted(dates, end, side="right")
        tr_lo = np.searchsorted(dates, end - np.timedelta64(window, "D"), side="right")
        if te_hi <= te_lo or tr_hi - tr_lo < 24 * 40:
            continue
        sel = ok[tr_lo:tr_hi]
        Xtr, ytr = X[tr_lo:tr_hi][sel].astype(np.float64), y_res[tr_lo:tr_hi][sel]
        if len(ytr) < 24 * 40:
            continue
        w = recency_weights(dates[tr_lo:tr_hi][sel], end, halflife)
        model = lasso_fit(Xtr, ytr, w) if kind == "lasso" else ridge_fit(Xtr, ytr, w)
        te = np.arange(te_lo, te_hi)
        te = te[np.isfinite(X[te]).all(axis=1)]
        if len(te):
            out[te] = base[te] + linear_predict(model, X[te].astype(np.float64))
    return out


# ------------------------------------------------------------------ Kalman local level with drift
GRID_LEVEL = (0.005, 0.02, 0.05, 0.1, 0.5, 2.0)   # level innovation variance / observation variance
GRID_DRIFT = (0.0, 0.001, 0.01)            # drift innovation variance / observation variance


def kalman_filter(y, q_level, q_drift):
    """Filtered level and drift of a local-linear-trend model (random walk with drift) on a daily series with gaps (NaN = no
    update that day). Variances are relative to the observation variance, which cancels out of the gain. Returns (mu, beta) arrays,
    the state AFTER observing each day: causal, nothing from later days enters."""
    n = len(y)
    mu, beta = np.full(n, np.nan), np.full(n, np.nan)
    first = np.flatnonzero(np.isfinite(y))
    if not len(first):
        return mu, beta
    x = np.array([y[first[0]], 0.0])
    P = np.diag([1e3, 1e1])
    F = np.array([[1.0, 1.0], [0.0, 1.0]])
    Q = np.diag([q_level, q_drift])
    for t in range(first[0], n):
        x = F @ x
        P = F @ P @ F.T + Q
        if np.isfinite(y[t]):
            S = P[0, 0] + 1.0
            K = P[:, 0] / S
            x = x + K * (y[t] - x[0])
            P = P - np.outer(K, P[0, :])
        mu[t], beta[t] = x
    return mu, beta


def fit_kalman_params(y, train_until, h=4):
    """Pick (q_level, q_drift) from the grids by the h-step-ahead MAE of mu + (h-1) beta on the days BEFORE `train_until` (an index
    position into y). One choice per zone, made on pre-evaluation data only."""
    best, best_mae = (GRID_LEVEL[1], 0.0), np.inf
    for ql in GRID_LEVEL:
        for qd in GRID_DRIFT:
            mu, beta = kalman_filter(y[:train_until], ql, qd)
            pred = mu[:-(h - 1) or None] + (h - 1) * beta[:-(h - 1) or None]
            actual = y[:train_until][h - 1:]
            m = np.isfinite(pred) & np.isfinite(actual)
            m[:30] = False                                   # warm-up
            if m.sum() < 60:
                continue
            mae = float(np.abs(pred[m] - actual[m]).mean())
            if mae < best_mae:
                best, best_mae = (ql, qd), mae
    return best


def kalman_levels(day_means, eval_from):
    """day_means: Series indexed by calendar day (gapless, NaN allowed). Returns DataFrame mu, beta (filtered state per day) and
    the chosen (q_level, q_drift) in .attrs."""
    y = day_means.to_numpy(dtype=float)
    split = int(np.searchsorted(day_means.index.values, np.datetime64(eval_from)))
    ql, qd = fit_kalman_params(y, split) if split > 120 else (GRID_LEVEL[1], 0.0)
    mu, beta = kalman_filter(y, ql, qd)
    out = pd.DataFrame({"mu": mu, "beta": beta}, index=day_means.index)
    out.attrs["params"] = (ql, qd)
    return out


def error_correction(train, test, cols=("gap", "mc_d7"), alpha=1.0):
    """Gas as an exogenous driver of the level: regress the miss of the Kalman level forecast (dm - lvl) on the gap between the fuel
    cost and that level (and the fuel's 7-day change); returns the correction to add for each test row (0 if there is too little data)."""
    from sklearn.linear_model import Ridge
    tr = train.dropna(subset=list(cols) + ["miss"])
    if len(tr) < 60:
        return pd.Series(0.0, index=test.index)
    mu, sd = tr[list(cols)].mean(), tr[list(cols)].std().replace(0, 1.0)
    m = Ridge(alpha=alpha).fit(((tr[list(cols)] - mu) / sd).to_numpy(), tr["miss"].to_numpy())
    good = test[list(cols)].notna().all(axis=1)
    out = pd.Series(0.0, index=test.index)
    if good.any():
        out[good] = m.predict(((test.loc[good, list(cols)] - mu) / sd).to_numpy())
    return out


# ------------------------------------------------------------------ quantile bands
def interval_score(y, lo, hi, alpha=0.2):
    """Winkler / interval score of a central (1 - alpha) interval: width + (2/alpha) x the miss distance. Lower is better."""
    y, lo, hi = (np.asarray(v, dtype=float) for v in (y, lo, hi))
    return (hi - lo) + (2 / alpha) * (np.maximum(lo - y, 0) + np.maximum(y - hi, 0))


def coverage(y, lo, hi):
    y, lo, hi = (np.asarray(v, dtype=float) for v in (y, lo, hi))
    ok = np.isfinite(y) & np.isfinite(lo) & np.isfinite(hi)
    return float(((y >= lo) & (y <= hi))[ok].mean()) if ok.any() else np.nan


def rolling_residual_band(frame, point_col, window_days=180, scale=1.2, settle_days=8, block_days=30, y_col="y"):
    """The CURRENT recipe (calibrate.py) applied to any point forecast: for each block of `block_days`, the band is the 10th / 90th
    percentile of (actual - forecast) of the same zone and horizon over the `window_days` ending `settle_days` before the block, times
    `scale`. Returns (lo, hi) as Series aligned to `frame`; NaN before the first full window."""
    d = frame[["zone", "h", "date", y_col, point_col]].copy()
    d["resid"] = d[y_col] - d[point_col]
    lo = pd.Series(np.nan, index=frame.index)
    hi = pd.Series(np.nan, index=frame.index)
    t0 = d["date"].min() + pd.Timedelta(days=window_days)
    start = t0
    while start <= d["date"].max():
        stop = start + pd.Timedelta(days=block_days)
        end = start - pd.Timedelta(days=settle_days)
        hist = d[(d["date"] < end) & (d["date"] >= end - pd.Timedelta(days=window_days))]
        q = hist.groupby(["zone", "h"], observed=True)["resid"].quantile([0.1, 0.9]).unstack()
        blk = d[(d["date"] >= start) & (d["date"] < stop)]
        key = pd.MultiIndex.from_frame(blk[["zone", "h"]])
        q = q.reindex(key)
        lo.loc[blk.index] = blk[point_col].to_numpy() + scale * q.iloc[:, 0].to_numpy()
        hi.loc[blk.index] = blk[point_col].to_numpy() + scale * q.iloc[:, 1].to_numpy()
        start = stop
    return lo, hi


# ------------------------------------------------------------------ ensembles
LINEAR = ("b_ridge_nogas", "b_ridge_gas", "d_lin", "k_level", "k_gas", "a_ewm5", "a_ewm7") + tuple(
    f"lear_{k}{g}{d}" for k in ("r90", "r180", "r365", "r365w", "l180") for g in ("", "_g") for d in ("", "_d1"))
TREE = ("lgb_base", "lgb_fuel", "hyb_base", "hyb_fuel", "cb_base", "cb_fuel")
