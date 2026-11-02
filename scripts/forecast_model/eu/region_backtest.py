#!/usr/bin/env python3
"""Run the per-region candidate models of region_models.py through the SAME rolling-origin folds as the EU backtest
(expanding window, retrained every 2 months, 2025-04-01 .. 2026-11-02) and write ONE frame with every candidate's forecast next
to the actual price: regions_predictions.parquet. Scoring and the tables are region_scores.py.

Inputs (all in this directory): dataset_eu_fuel.parquet and dataset_nordic_fuel.parquet (fuel_dataset.py), price_<zone>.parquet
(EU) and nprice_<zone>.parquet (Nordic), backtest_eu_rel.parquet / backtest_eu_rel_fuel.parquet / backtest_eu_rel_gasonly.parquet
(backtest.py) and backtest_nordic_base.parquet / backtest_nordic_fuel.parquet (nordic_backtest.py) for the LightGBM columns.

    python3 region_backtest.py [--jobs 8] [--skip-rank]
"""
import argparse
import os
import sys
import time

import lightgbm as lgb
import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import calendar_features as cal          # noqa: E402
import region_models as RM               # noqa: E402

NORDIC = RM.GROUPS["nordic"] + ["nl"]
EVAL_FROM = pd.Timestamp("2025-04-01")
FOLD_FIRST, FOLD_LAST, STEP = "2025-04", "2026-11", 2
NORDIC_EXTRA = ["reservoir_anom", "nordic_reservoir_anom", "hydro_precip_7d"]
REF = {                                   # zone group -> {reference zone: label}
    "cee": {"de": "de"},
    "baltics": {"fi": "fi", "se4": "se4"},
}
RANK_PARAMS = dict(objective="regression", n_estimators=300, num_leaves=63, min_child_samples=100, learning_rate=0.08,
                   subsample=0.6, subsample_freq=1, colsample_bytree=0.8, max_bin=127, verbosity=-1)


def load_prices():
    eu, nd = {}, {}
    for z in RM.ZONE_GROUP:
        src = nd if z in NORDIC else eu
        path = os.path.join(DIR, f"{'nprice' if z in NORDIC else 'price'}_{z}.parquet")
        df = pd.read_parquet(path)
        s = df.set_index(pd.to_datetime(df["t"]))["eur_mwh"].sort_index()
        src[z] = s[~s.index.duplicated(keep="last")]
    return eu, nd


def build_frame():
    """EU and Nordic rows on one frame (h 2..7) with the columns every candidate needs."""
    eu = pd.read_parquet(os.path.join(DIR, "dataset_eu_fuel.parquet"))
    nd = pd.read_parquet(os.path.join(DIR, "dataset_nordic_fuel.parquet"))
    eu = eu[eu["h"] <= 7]
    nd = nd[(nd["h"] <= 7) & nd["zone"].isin(NORDIC)]
    eu["zone"] = eu["zone"].astype(str)
    nd["zone"] = nd["zone"].astype(str)
    A = pd.concat([eu, nd], ignore_index=True)
    A["t"] = pd.to_datetime(A["t"])
    A["date"] = A["t"].dt.normalize()
    pe, pn = load_prices()
    prices = {**pe, **pn}
    tables = RM.day_tables(prices)
    A = RM.attach_last_known(A, tables, ["ewm5", "ewm7"])
    # columns the Nordic set does not have, from the price series with the same rule (last known day = date - (h - 1))
    if "level_7d" not in A:
        A["level_7d"] = np.nan
    if "last_day_std" not in A:
        A["last_day_std"] = np.nan
    tmp = RM.attach_last_known(A[["zone", "date", "h"]], {z: t.rename(columns={"level_7d": "l7", "day_std": "ds"}) for z, t in tables.items()}, ["l7", "ds"])
    A["level_7d"] = A["level_7d"].fillna(tmp["l7"])
    A["last_day_std"] = A["last_day_std"].fillna(tmp["ds"])
    # lag_last (the same hour on the last known day) and the holiday flags for the Nordic rows
    if "lag_last" not in A:
        A["lag_last"] = np.nan
    need = A["lag_last"].isna() & A["zone"].isin(NORDIC)
    for (z, h), idx in A[need].groupby(["zone", "h"]).groups.items():
        A.loc[idx, "lag_last"] = prices[z].reindex(A.loc[idx, "t"] - pd.Timedelta(days=int(h) - 1)).to_numpy()
    for c in ("is_holiday", "xmas_week"):
        if c not in A:
            A[c] = np.nan
    nd_rows = A["zone"].isin(NORDIC)
    A.loc[nd_rows, "is_holiday"] = 0
    A.loc[nd_rows, "xmas_week"] = [1 if cal.xmas_week(d.date()) else 0 for d in A.loc[nd_rows, "date"]] if nd_rows.any() else []
    for c in NORDIC_EXTRA:
        if c not in A:
            A[c] = np.nan
    A["b_lag7"], A["b_seasonal"], A["b_persist"] = A["lag7"], A["seasonal4w"], A["lag_last"]
    A["shape_s"] = RM.shape(A)
    A["b_lvlshape"] = A["shape_s"] + A["level_7d"]
    A = A.sort_values(["zone", "h", "t"], kind="stable").reset_index(drop=True)
    return A, prices


def folds():
    months = pd.period_range(FOLD_FIRST, FOLD_LAST, freq="M")
    for i in range(0, len(months), STEP):
        yield months[i].start_time, months[min(i + STEP - 1, len(months) - 1)].end_time


def run_ridge_and_daily(A, log):
    """(b) ridge without / with fuel and (d) the daily linear model, per zone and horizon, per fold."""
    A["b_ridge_nogas"] = np.nan
    A["b_ridge_gas"] = np.nan
    A["d_lin"] = np.nan
    days = RM.daily_frame(A)
    days["dm_hat"] = np.nan
    dates = A["date"].to_numpy()
    d_dates = days["date"].to_numpy()
    zh = A.groupby(["zone", "h"], sort=False).indices
    dzh = days.groupby(["zone", "h"], sort=False).indices
    for lo, hi in folds():
        t0 = time.time()
        for (z, h), pos in zh.items():
            sub_dates = dates[pos]
            ntr = np.searchsorted(sub_dates, np.datetime64(lo), side="left")
            nte = np.searchsorted(sub_dates, np.datetime64(hi.normalize()), side="right")
            if ntr < 2000 or nte <= ntr:
                continue
            train, test = A.iloc[pos[:ntr]], A.iloc[pos[ntr:nte]]
            extra = NORDIC_EXTRA if z in NORDIC else ()
            A.loc[test.index, "b_ridge_nogas"] = RM.ridge_residual(train, test, False, extra=extra).to_numpy()
            A.loc[test.index, "b_ridge_gas"] = RM.ridge_residual(train, test, True, extra=extra).to_numpy()
            dpos = dzh[(z, h)]
            dd = d_dates[dpos]
            dn = np.searchsorted(dd, np.datetime64(lo), side="left")
            dm = np.searchsorted(dd, np.datetime64(hi.normalize()), side="right")
            if dn >= 60 and dm > dn:
                dtr, dte = days.iloc[dpos[:dn]], days.iloc[dpos[dn:dm]]
                days.loc[dte.index, "dm_hat"] = RM.daily_linear(dtr, dte).to_numpy()
        log(f"  ridge+daily fold {lo:%Y-%m}..{hi:%Y-%m} in {time.time() - t0:.0f}s")
    m = A[["zone", "date", "h"]].merge(days[["zone", "date", "h", "dm_hat"]], on=["zone", "date", "h"], how="left")
    A["d_lin"] = m["dm_hat"].to_numpy() + A["shape_s"].to_numpy()
    return A


def run_rank(A, jobs, log):
    """(c) LightGBM on the within-day deviation; the forecast is ewm7 + predicted deviation (only the ORDER is the point)."""
    R = RM.rank_frame(A)
    R["zone_c"] = pd.Categorical(R["zone"], categories=sorted(R["zone"].unique()))
    feats = [("zone_c" if f == "zone" else f) for f in RM.RANK_FEATS]
    A["c_rank_dev"] = np.nan
    for lo, hi in folds():
        t0 = time.time()
        tr = R[(R["date"] < lo) & R["dev"].notna()]
        te = R[(R["date"] >= lo) & (R["date"] <= hi)]
        if len(tr) < 100_000 or te.empty:
            continue
        m = lgb.LGBMRegressor(n_jobs=jobs, **RANK_PARAMS)
        m.fit(tr[feats], tr["dev"], categorical_feature=["zone_c"])
        A.loc[te.index, "c_rank_dev"] = m.predict(te[feats])
        log(f"  rank fold {lo:%Y-%m}..{hi:%Y-%m}: train {len(tr):,} in {time.time() - t0:.0f}s")
    A["c_rank"] = A["ewm7"] + A["c_rank_dev"]
    return A


def merge_lgb(A, log):
    """The LightGBM columns from the backtest files: lgb_* = the model's median, hyb_* = the published level + 50/50 shape."""
    def read(name, cols):
        path = os.path.join(DIR, name)
        if not os.path.exists(path):
            if name.endswith("gasonly.parquet"):          # the ablation is optional
                log(f"  missing {name}")
                return None
            raise SystemExit(f"missing {name}: run backtest.py / nordic_backtest.py first")
        d = pd.read_parquet(path, columns=cols)
        d["zone"] = d["zone"].astype(str)
        d["t"] = pd.to_datetime(d["t"])
        return d.drop_duplicates(["zone", "t", "h"])

    for tag, eu_file, nd_file in (("base", "backtest_eu_rel.parquet", "backtest_nordic_base.parquet"),
                                  ("fuel", "backtest_eu_rel_fuel.parquet", "backtest_nordic_fuel.parquet")):
        e = read(eu_file, ["zone", "t", "h", "p_raw", "hyb"])
        n = read(nd_file, ["zone", "t", "h", "p_md", "hyb"])
        parts = []
        if e is not None:
            parts.append(e.rename(columns={"p_raw": f"lgb_{tag}", "hyb": f"hyb_{tag}"}))
        if n is not None:
            parts.append(n.rename(columns={"p_md": f"lgb_{tag}", "hyb": f"hyb_{tag}"}))
        if parts:
            both = pd.concat(parts, ignore_index=True)
            A = A.merge(both, on=["zone", "t", "h"], how="left")
    g = read("backtest_eu_rel_gasonly.parquet", ["zone", "t", "h", "p_raw"])
    if g is not None:
        A = A.merge(g.rename(columns={"p_raw": "lgb_gasonly"}), on=["zone", "t", "h"], how="left")
    return A


def pick_ref_col(A, ref):
    """The reference zone's forecast column: the LightGBM with fuel if it beats the one without on that zone, else the other."""
    s = A[(A["zone"] == ref) & (A["date"] >= EVAL_FROM)]
    best, best_mae = None, np.inf
    for c in ("lgb_fuel", "lgb_base"):
        if c in s and s[c].notna().any():
            mae = (s[c] - s["y"]).abs().mean()
            if mae < best_mae:
                best, best_mae = c, mae
    return best


def run_reference(A, prices, log):
    """(e) reference-zone forecast + recent spread, for the CEE/SEE zones (ref DE) and the Baltics (ref FI, SE4); (f) PT = ES copy."""
    ev = A[A["date"] >= EVAL_FROM]
    for group, refs in REF.items():
        for ref in refs:
            col = pick_ref_col(A, ref)
            log(f"  reference {ref}: forecast column {col}")
            rr = ev[ev["zone"] == ref].set_index(["h", "t"])[col]
            rr = rr[~rr.index.duplicated()]
            for z in RM.GROUPS[group]:
                if z == ref:
                    continue
                off = RM.STD_OFFSET[z] - RM.STD_OFFSET[ref]
                rows = ev[ev["zone"] == z]
                if rows.empty:
                    continue
                key = pd.MultiIndex.from_arrays([rows["h"], rows["t"] - pd.Timedelta(hours=off)])
                ref_fc = pd.Series(rr.reindex(key).to_numpy(), index=rows.index)
                sp = RM.spread_features(rows, RM.spread_series(prices[z], prices[ref], off))
                cand = RM.reference_candidates(rows, ref_fc, sp)
                for k in cand:
                    name = f"{k}_{refs[ref]}"
                    if name not in A:
                        A[name] = np.nan
                    A.loc[rows.index, name] = cand[k].to_numpy()
    # PT = the ES forecast of the same model, on PT's clock (ES is one hour ahead of PT)
    for col in ("lgb_base", "lgb_fuel", "hyb_fuel", "b_ridge_nogas", "b_ridge_gas", "a_ewm7", "d_lin", "b_lvlshape"):
        if col not in A:
            continue
        es = ev[ev["zone"] == "es"].set_index(["h", "t"])[col]
        es = es[~es.index.duplicated()]
        pt = ev[ev["zone"] == "pt"]
        off = RM.STD_OFFSET["pt"] - RM.STD_OFFSET["es"]
        key = pd.MultiIndex.from_arrays([pt["h"], pt["t"] - pd.Timedelta(hours=off)])
        name = f"f_ptes_{col}"
        A[name] = np.nan
        A.loc[pt.index, name] = es.reindex(key).to_numpy()
    return A


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--skip-rank", action="store_true")
    ap.add_argument("--out", default="regions_predictions.parquet")
    a = ap.parse_args()
    t_all = time.time()

    def log(msg):
        print(f"[{time.time() - t_all:6.0f}s] {msg}", flush=True)

    A, prices = build_frame()
    log(f"frame: {len(A):,} rows, {A['zone'].nunique()} zones")
    A["a_ewm5"] = A["shape_s"] + A["ewm5"]
    A["a_ewm7"] = A["shape_s"] + A["ewm7"]
    A = run_ridge_and_daily(A, log)
    if not a.skip_rank:
        A = run_rank(A, a.jobs, log)
    A = merge_lgb(A, log)
    A = run_reference(A, prices, log)
    keep = ["zone", "t", "date", "h", "hour", "y", "level_7d", "ewm7", "b_lag7", "b_seasonal", "b_persist", "b_lvlshape"] + \
           [c for c in A.columns if c.split("_")[0] in ("a", "lgb", "hyb", "c", "d", "e1", "e2", "e3", "f") and c not in ("c_rank_dev",)] + \
           ["b_ridge_nogas", "b_ridge_gas"]
    keep = list(dict.fromkeys(keep))
    out = A[A["date"] >= EVAL_FROM][keep]
    out.to_parquet(os.path.join(DIR, a.out), index=False)
    log(f"wrote {a.out}: {len(out):,} rows, columns {keep}")
    print("REGION BACKTEST DONE", flush=True)


if __name__ == "__main__":
    main()
