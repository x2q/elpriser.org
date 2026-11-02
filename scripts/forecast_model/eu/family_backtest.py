#!/usr/bin/env python3
"""LEAR (rolling-window ridge / lasso) and Kalman level+shape forecasts for all 38 zones, horizons D+2..D+7, over the evaluation period
2025-04-01 .. 2026-11-02. Writes families_predictions.parquet (zone, t, h + one column per variant) that region_all.py merges with
regions_predictions.parquet.

LEAR variants (name -> window in days, recency half-life, model; `_g` adds the gas / carbon features):
    lear_r90, lear_r180, lear_r365    ridge, equal weights
    lear_r365w                        ridge, 365 days with exponential recency weights (half-life 45 days)
    lear_l180                         lasso, 180 days
Refit every --step days (default 7; the closed-form ridge also runs with --step 1 for the 'refit daily' check).
Kalman variants: k_level (local level with drift on the daily mean + the seasonal shape), k_gas (the same + an error-correction term on the
gap between the gas-plant marginal cost and the level, fitted on earlier folds).

    python3 family_backtest.py [--step 7] [--jobs 8] [--only lear|kalman]
"""
import argparse
import os
import sys
import time

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import family_models as FM          # noqa: E402
import region_backtest as RB        # noqa: E402
import region_models as RM          # noqa: E402

VARIANTS = {            # name: (window, halflife, kind)
    "lear_r90": (90, None, "ridge"),
    "lear_r180": (180, None, "ridge"),
    "lear_r365": (365, None, "ridge"),
    "lear_r365w": (365, 45, "ridge"),
    "lear_l180": (180, None, "lasso"),
}
EXTRA_LAGS = ["d_lag_last", "d_prev", "d_lag7", "d_lag14"]


def add_lear_columns(A, prices):
    """Lagged-price features relative to the 7-day level: the last known day, the day before it, and the same hour 7 and 14 days before
    the target (D-1 / D-2 / D-7 of the issue day's last known day). All are known at issue (lag >= h - 1)."""
    A["p_prev"] = np.nan
    for (z, h), idx in A.groupby(["zone", "h"]).groups.items():
        A.loc[idx, "p_prev"] = prices[z].reindex(A.loc[idx, "t"] - pd.Timedelta(days=int(h))).to_numpy()
    A["d_lag_last"] = A["lag_last"] - A["level_7d"]
    A["d_prev"] = A["p_prev"] - A["level_7d"]
    A["d_lag7"] = A["lag7"] - A["level_7d"]
    A["d_lag14"] = A["lag14"] - A["level_7d"]
    return A


def lear_zone(zone, A_z, X_z, fuel_cols, step, variants):
    """All LEAR variants for one zone: dict column -> array aligned to A_z's rows."""
    out = {}
    refits = np.arange(np.datetime64("2025-04-01"), np.datetime64("2026-11-03"), np.timedelta64(step, "D"))
    for h, g in A_z.groupby("h"):
        pos = g.index.to_numpy() - A_z.index[0]
        dates = g["date"].to_numpy().astype("datetime64[D]")
        base = g["b_lvlshape"].to_numpy()
        y_res = (g["y"] - g["b_lvlshape"]).to_numpy()
        Xg = X_z[pos]
        for name, (window, hl, kind) in variants.items():
            for gas in (False, True):
                cols = np.ones(Xg.shape[1], bool)
                if not gas:
                    cols[fuel_cols] = False
                col = name + ("_g" if gas else "")
                arr = FM.lear_block(Xg[:, cols], y_res, base, dates, int(h), refits, window, hl, kind,
                                    np.datetime64("2025-04-01"), np.datetime64("2026-11-02"), step)
                out.setdefault(col, np.full(len(A_z), np.nan))[pos] = arr
    return zone, out


def run_lear(A, step, jobs, log, variants=None, suffix=""):
    from joblib import Parallel, delayed
    extra_all = RB.NORDIC_EXTRA
    X = RM.design(A, True, extra=extra_all)
    X = X.join(A[EXTRA_LAGS].astype(np.float32))
    names = list(X.columns)
    fuel_cols = [i for i, n in enumerate(names) if n.startswith(("gap_", "mc_d7_", "mc_d28_")) or n in ("eua_d28", "gas_m1_spread")]
    log(f"LEAR design: {X.shape[1]} features ({len(fuel_cols)} fuel)")
    Xn = X.to_numpy(np.float32)
    nordic = set(RB.NORDIC)
    jobs_list = []
    for z, idx in A.groupby("zone").groups.items():
        sub = A.loc[idx, ["h", "date", "b_lvlshape", "y"]]
        Xz = Xn[idx]
        fc = fuel_cols
        jobs_list.append((z, sub, Xz, fc))
    t0 = time.time()
    res = Parallel(n_jobs=jobs, backend="loky")(delayed(lear_zone)(z, sub, Xz, fc, step, variants or VARIANTS) for z, sub, Xz, fc in jobs_list)
    cols = {}
    for (z, out), (_, sub, _, _) in zip(res, jobs_list):
        for c, arr in out.items():
            cols.setdefault(c + suffix, pd.Series(np.nan, index=A.index))
            cols[c + suffix].loc[sub.index] = arr
    log(f"LEAR done in {time.time() - t0:.0f}s: {sorted(cols)}")
    return pd.DataFrame(cols)


def run_kalman(A, prices, log):
    """k_level and k_gas columns."""
    tables = RM.day_tables(prices)
    A = A.copy()
    A["k_level_day"] = np.nan
    params = {}
    for z, idx in A.groupby("zone").groups.items():
        dm = tables[z]["day_mean"]
        dm = dm.reindex(pd.date_range(dm.index.min(), dm.index.max(), freq="D"))
        kl = FM.kalman_levels(dm, "2025-04-01")
        params[z] = kl.attrs["params"]
        last = A.loc[idx, "date"] - pd.to_timedelta(A.loc[idx, "h"] - 1, unit="D")
        mu = kl["mu"].reindex(last.to_numpy()).to_numpy()
        beta = kl["beta"].reindex(last.to_numpy()).to_numpy()
        A.loc[idx, "k_level_day"] = mu + (A.loc[idx, "h"].to_numpy() - 1) * beta
    log(f"Kalman params (q_level, q_drift) per zone: {params}")
    A["k_level"] = A["k_level_day"] + A["shape_s"]
    # gas as an exogenous driver: error correction fitted per zone and horizon on the earlier folds
    days = A.groupby(["zone", "date", "h"], observed=True, sort=False).agg(
        dm=("y", "mean"), n=("y", "count"), lvl=("k_level_day", "first"), mc=("ccgt_mc", "first"), mc_d7=("ccgt_mc_d7", "first")).reset_index()
    days["miss"] = days["dm"] - days["lvl"]
    days["gap"] = days["mc"] - days["lvl"]
    days["corr"] = 0.0
    zh = days.groupby(["zone", "h"], sort=False).indices
    dates = days["date"].to_numpy()
    for lo, hi in RB.folds():
        for (z, h), pos in zh.items():
            d = dates[pos]
            ntr = np.searchsorted(d, np.datetime64(lo), side="left")
            nte = np.searchsorted(d, np.datetime64(hi.normalize()), side="right")
            if ntr < 60 or nte <= ntr:
                continue
            tr, te = days.iloc[pos[:ntr]], days.iloc[pos[ntr:nte]]
            tr = tr[tr["n"] >= 22]
            days.loc[te.index, "corr"] = FM.error_correction(tr, te).to_numpy()
    m = A[["zone", "date", "h"]].merge(days[["zone", "date", "h", "corr"]], on=["zone", "date", "h"], how="left")
    A["k_gas"] = A["k_level"] + m["corr"].to_numpy()
    return A[["k_level", "k_gas"]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", type=int, default=7)
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--only", choices=["lear", "kalman"])
    ap.add_argument("--variants", help="comma-separated subset of the LEAR variants (default: all)")
    ap.add_argument("--suffix", default="", help="appended to the LEAR column names (e.g. _d1 for the daily-refit check)")
    ap.add_argument("--out", default="families_predictions.parquet")
    a = ap.parse_args()
    t_all = time.time()

    def log(msg):
        print(f"[{time.time() - t_all:6.0f}s] {msg}", flush=True)

    A, prices = RB.build_frame()
    A = add_lear_columns(A, prices)
    log(f"frame {len(A):,} rows")
    parts = []
    if a.only != "lear":
        parts.append(run_kalman(A, prices, log))
    if a.only != "kalman":
        chosen = {k: v for k, v in VARIANTS.items() if not a.variants or k in a.variants.split(",")}
        parts.append(run_lear(A, a.step, a.jobs, log, chosen, a.suffix))
    P = pd.concat(parts, axis=1)
    P[["zone", "t", "h", "date"]] = A[["zone", "t", "h", "date"]]
    P = P[P["date"] >= RB.EVAL_FROM].drop(columns="date")
    P.to_parquet(os.path.join(DIR, a.out), index=False)
    log(f"wrote {a.out}: {len(P):,} rows, {len(P.columns) - 3} forecast columns")
    print("FAMILY BACKTEST DONE", flush=True)


if __name__ == "__main__":
    main()
