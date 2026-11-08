#!/usr/bin/env python3
"""Research frame and candidate runners for the Nordic gate (docs/forecast-nordic-no.md). Research only: run in a COPY of the job directory on the Spark
(~/nordic-no-research), never in ~/nordic.

    python3 nfr.py frame                              nfr_frame.parquet: the 13 Nordic zones, h 2..9, every feature any candidate uses
    python3 nfr.py lgb  <name> [--jobs 10]            one LightGBM candidate (CANDS_LGB) through the EU backtest's folds -> cand_<name>.parquet
    python3 nfr.py ridge <name> ...                   LEAR (rolling ridge on the residual of level+shape) candidates (CANDS_RIDGE) -> cand_<name>.parquet
    python3 nfr.py merge                              nfr_all.parquet: frame keys + y + baselines + every cand_*.parquet column

Protocol = the EU gate's (build_gate.py / region_scores.py): rolling origin from 2025-04, 2-month folds (LightGBM) or weekly refits (ridge), the target of a
fold is never in its training set, baseline = level + shape (level_7d + the seasonal4w profile), periods full / select (..2026-06-30) / hold-out (2026-07-01..).
Leakage rule of the dataset (features.py): a row is (zone, target hour, h); price lag k exists only when k >= h-1; every day-level statistic ends at the last known
day L = target day - (h-1); weather is the forecast as issued at lead min(h, 7).
"""
import argparse
import glob
import os
import sys
import time

import lightgbm as lgb
import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import calendar_features as cal        # noqa: E402
import family_models as FM             # noqa: E402
import region_models as RM             # noqa: E402

NORDIC = ["dk1", "dk2", "no1", "no2", "no3", "no4", "no5", "se1", "se2", "se3", "se4", "fi", "nl"]
NO = ["no1", "no2", "no3", "no4", "no5"]
HYDRO_PT = NO + ["se1", "se2"]
EVAL_FROM = pd.Timestamp("2025-04-01")
EVAL_TO = pd.Timestamp("2026-11-02")
POINTS_LAST = "2026-10-31"
NORDIC_BASE = ["zone", "h", "hour", "weekday", "month", "is_weekend", "doy_sin", "doy_cos",
               "lag1", "lag2", "lag3", "lag7", "lag14", "lag21", "lag28", "seasonal4w", "last_day_mean", "level_30d",
               "wind", "rad", "temp", "precip", "precip_24h", "reg_wind", "reg_temp", "hydro_precip", "hydro_precip_7d",
               "reservoir_pct", "reservoir_anom", "nordic_reservoir_anom"]
FUEL = ["gas", "gas_d7", "gas_d28", "gas_m1_spread", "eua", "eua_d7", "eua_d28", "ccgt_mc", "ccgt_mc_d7", "ccgt_mc_d28", "mc_gap"]
NORDIC_EXTRA = ["reservoir_anom", "nordic_reservoir_anom", "hydro_precip_7d"]
EXTRA_LAGS = ["d_lag_last", "d_prev", "d_lag7", "d_lag14"]
# cross-zone context (declared a priori, not chosen from results): the level of the continental neighbours, of the Norwegian zones and of the Swedish zones
GROUP_LEVEL = {"cont": ["dk1", "dk2", "nl"], "no": NO, "se": ["se1", "se2", "se3", "se4"]}
XZ = ["gap_cont", "gap_no", "gap_se", "cont_last", "no_last_vs_lvl"]
# physical neighbours (declared a priori from the grid map, not from results): the mean level of the zones a zone shares a border with
NEIGHBOURS = {"no1": ["no2", "no3", "no5", "se3"], "no2": ["no1", "no5", "dk1", "nl"], "no3": ["no1", "no4", "no5", "se2"], "no4": ["no3", "se1", "se2"],
              "no5": ["no1", "no2", "no3"], "dk1": ["dk2", "se3", "no2", "nl"], "dk2": ["dk1", "se4"], "se1": ["se2", "no4", "fi"], "se2": ["se1", "se3", "no3", "no4"],
              "se3": ["se2", "se4", "no1", "dk1", "fi"], "se4": ["se3", "dk2", "nl"], "fi": ["se1", "se3"], "nl": ["dk1", "no2"]}
XNB = ["gap_nb", "nb_last"]
# hydrology proxies from the weather AS ISSUED (previous_day1, one point per zone), a degree-day snow store; parameters fixed a priori
HYD = ["swe", "swe_d14", "p30", "t30"]
RES = ["res_pct_lf", "res_anom_lf", "res_chg4w", "nres_anom_lf"]
RES_LAG_DAYS = 14
RES_SKIP_DAYS = 3          # extra margin: a reading is used only RES_LAG_DAYS after the week it describes (the dataset's rule)
DDF, T_SNOW = 3.0, 0.0     # mm of melt per degree-day, snow below this temperature


def load_prices():
    out = {}
    for z in NORDIC:
        df = pd.read_parquet(os.path.join(DIR, f"nprice_{z}.parquet"))
        s = df.set_index(pd.to_datetime(df["t"]))["eur_mwh"].sort_index()
        out[z] = s[~s.index.duplicated(keep="last")]
    return out


def hydrology(zone):
    """Daily snow store (mm water equivalent), its 14-day change, trailing 30-day precipitation and mean temperature of a zone's weather point,
    from previous_day1 (the forecast one day ahead, as issued). Spin-up from 2024-03-15: values before 2024-10-15 are NaN (the pack is not built yet)."""
    w = pd.read_parquet(os.path.join(DIR, f"w_prev_{zone}.parquet"))
    w["t"] = pd.to_datetime(w["time"])
    w = w.set_index("t")
    p = w["precipitation_previous_day1"].groupby(w.index.normalize()).sum(min_count=18)
    T = w["temperature_2m_previous_day1"].groupby(w.index.normalize()).mean()
    swe, s = [], 0.0
    for pr, te in zip(p.fillna(0).to_numpy(), T.ffill().fillna(0).to_numpy()):
        if te < T_SNOW:
            s += pr
        else:
            s = max(0.0, s - DDF * te)
        swe.append(s)
    d = pd.DataFrame({"swe": swe}, index=p.index)
    d["swe_d14"] = d["swe"] - d["swe"].shift(14)
    d["p30"] = p.rolling(30, min_periods=20).sum()
    d["t30"] = T.rolling(30, min_periods=20).mean()
    d.loc[d.index < "2024-10-15"] = np.nan
    return d


def reservoir_lf():
    """Leak-free reservoir features per zone on a daily index: share of the maximum SO FAR, deviation from the median of the same ISO week in EARLIER
    years only, 4-week change, each used only 14 days after the week it describes (the dataset's lag). The Nordic aggregate is the mean anomaly of the
    zones present. (The dataset's own columns normalise by the whole-series maximum and median, which includes the future: a small look-ahead.)"""
    r = pd.read_parquet(os.path.join(DIR, "reservoir_weekly.parquet"))
    r["t"] = pd.to_datetime(r["t_utc"], utc=True).dt.tz_convert("Europe/Copenhagen").dt.tz_localize(None).dt.normalize()
    days = pd.date_range("2022-01-01", "2026-11-10", freq="D")
    out, anoms = {}, {}
    for z, g in r.groupby("zone"):
        g = g.sort_values("t").drop_duplicates("t").set_index("t")
        pct = g["mwh"] / g["mwh"].cummax()
        wk, yr = g.index.isocalendar().week.to_numpy(), g.index.year.to_numpy()
        anom = np.full(len(g), np.nan)
        for i in range(len(g)):
            prior = pct.to_numpy()[(wk == wk[i]) & (yr < yr[i])]
            if len(prior):
                anom[i] = pct.iloc[i] - np.median(prior)
        f = pd.DataFrame({"res_pct_lf": pct.to_numpy(), "res_anom_lf": anom, "res_chg4w": pct.diff(4).to_numpy()}, index=g.index + pd.Timedelta(days=RES_LAG_DAYS))
        out[z] = f.reindex(days.union(f.index)).sort_index().ffill().reindex(days)
        anoms[z] = out[z]["res_anom_lf"]
    nres = pd.concat(anoms, axis=1).mean(axis=1)
    for z in out:
        out[z]["nres_anom_lf"] = nres
    return out


def build():
    """nfr_frame.parquet"""
    t0 = time.time()
    nd = pd.read_parquet(os.path.join(DIR, "dataset_nordic_fuel.parquet"))
    nd = nd[nd["zone"].isin(NORDIC)]
    nd["zone"] = nd["zone"].astype(str)
    nd["t"] = pd.to_datetime(nd["t"])
    nd["date"] = nd["t"].dt.normalize()
    prices = load_prices()
    tables = RM.day_tables(prices)
    A = RM.attach_last_known(nd, tables, ["ewm5", "ewm7", "level_7d", "day_std"]).rename(columns={"day_std": "last_day_std"})
    A["lag_last"] = np.nan
    A["p_prev"] = np.nan
    for (z, h), idx in A.groupby(["zone", "h"]).groups.items():
        A.loc[idx, "lag_last"] = prices[z].reindex(A.loc[idx, "t"] - pd.Timedelta(days=int(h) - 1)).to_numpy()
        A.loc[idx, "p_prev"] = prices[z].reindex(A.loc[idx, "t"] - pd.Timedelta(days=int(h))).to_numpy()
    A["is_holiday"] = 0
    A["xmas_week"] = A["date"].map({d: (1 if cal.xmas_week(d.date()) else 0) for d in A["date"].unique()})
    A["b_lag7"], A["b_seasonal"], A["b_persist"] = A["lag7"], A["seasonal4w"], A["lag_last"]
    A["shape_s"] = RM.shape(A)
    A["b_lvlshape"] = A["shape_s"] + A["level_7d"]
    A["d_lag_last"] = A["lag_last"] - A["level_7d"]
    A["d_prev"] = A["p_prev"] - A["level_7d"]
    A["d_lag7"] = A["lag7"] - A["level_7d"]
    A["d_lag14"] = A["lag14"] - A["level_7d"]
    L = A["date"] - pd.to_timedelta(A["h"] - 1, unit="D")
    # cross-zone context at the last known day
    lv = pd.DataFrame({z: tables[z]["level_7d"] for z in NORDIC})
    dm = pd.DataFrame({z: tables[z]["day_mean"] for z in NORDIC})
    for g, zs in GROUP_LEVEL.items():
        A[f"{g}_level_7d"] = lv[zs].mean(axis=1).reindex(L.to_numpy()).to_numpy()
        A[f"{g}_last"] = dm[zs].mean(axis=1).reindex(L.to_numpy()).to_numpy()
    for g in GROUP_LEVEL:
        A[f"gap_{g}"] = A[f"{g}_level_7d"] - A["level_7d"]
    A["gap_nb"], A["nb_last"] = np.nan, np.nan
    for z, idx in A.groupby("zone").groups.items():
        Lz = L.loc[idx].to_numpy()
        A.loc[idx, "gap_nb"] = lv[NEIGHBOURS[z]].mean(axis=1).reindex(Lz).to_numpy() - A.loc[idx, "level_7d"].to_numpy()
        A.loc[idx, "nb_last"] = dm[NEIGHBOURS[z]].mean(axis=1).reindex(Lz).to_numpy() - A.loc[idx, "level_7d"].to_numpy()
    A["cont_last"] = A["cont_last"] - A["level_7d"]
    A["no_last_vs_lvl"] = A["no_last"] - A["no_level_7d"]
    # hydrology proxy and leak-free reservoir, per zone, at L
    for c in HYD + RES:
        A[c] = np.nan
    res = reservoir_lf()
    for z, idx in A.groupby("zone").groups.items():
        Lz = L.loc[idx].to_numpy()
        if z in HYDRO_PT:
            hy = hydrology(z)
            for c in HYD:
                A.loc[idx, c] = hy[c].reindex(Lz).to_numpy()
        if z in res:
            for c in RES:
                A.loc[idx, c] = res[z][c].reindex(Lz).to_numpy()
    # a Nordic hydro balance seen from every zone: the mean snow store / 30-day rain of the Norwegian points
    hyno = pd.concat({z: hydrology(z) for z in NO}).groupby(level=1).mean()
    for c in ("swe", "p30"):
        A[f"no_{c}"] = hyno[c].reindex(L.to_numpy()).to_numpy()
    A = A.sort_values(["zone", "h", "t"], kind="stable").reset_index(drop=True)
    A["zone"] = A["zone"].astype(str)
    A.to_parquet(os.path.join(DIR, "nfr_frame.parquet"), index=False)
    print(f"nfr_frame.parquet: {len(A):,} rows, {A.shape[1]} columns, zones {A.zone.nunique()}, h {A.h.min()}..{A.h.max()}, t {A.t.min()} .. {A.t.max()} in {time.time() - t0:.0f}s", flush=True)
    print(A[HYD + RES + XZ + ["no_swe", "no_p30"]].describe().T.round(2).to_string())


# ------------------------------------------------------------------ LightGBM candidates
PARAMS_EU = dict(objective="quantile", alpha=0.5, n_estimators=400, num_leaves=63, min_child_samples=60, learning_rate=0.06,
                 subsample=0.6, subsample_freq=1, colsample_bytree=0.8, max_bin=127, verbosity=-1)
PARAMS_PROD = dict(objective="quantile", alpha=0.5, n_estimators=500, num_leaves=127, min_child_samples=40, learning_rate=0.05, verbosity=-1)
PARAMS_SMALL = dict(PARAMS_EU, num_leaves=31, min_child_samples=200, n_estimators=300)
DROP_CALENDAR = ["month", "doy_sin", "doy_cos"]
# name: (features, zones the model is trained on and predicts, target, params)
CANDS_LGB = {
    # the production model: raw price target, pooled over the 13 zones, 30 features, 500 trees x 127 leaves (nordic/train_daily.py), trained on h 2..9
    "p0": (NORDIC_BASE, NORDIC, "raw", PARAMS_PROD),
    # the EU recipe's tree: target = price - level_7d, EU parameters, pooled over the 13 zones, the Nordic features + fuel
    "lrel13": (NORDIC_BASE + FUEL, NORDIC, "rel", PARAMS_EU),
    # the same, one model for the five Norwegian zones only ("Norway group")
    "lrelno": (NORDIC_BASE + FUEL, NO, "rel", PARAMS_EU),
    # the same pooled model without the calendar-date features (month, doy): the tree cannot memorise last year's price on the same date
    "lrel13nc": ([f for f in NORDIC_BASE if f not in DROP_CALENDAR] + FUEL, NORDIC, "rel", PARAMS_EU),
    # + cross-zone level context, hydrology proxy, leak-free reservoir
    "lrel13x": (NORDIC_BASE + FUEL + XZ + HYD + RES, NORDIC, "rel", PARAMS_EU),
    "lrelnox": (NORDIC_BASE + FUEL + XZ + HYD + RES + ["no_swe", "no_p30"], NO, "rel", PARAMS_EU),
    # + cross-zone context only
    "lrel13z": (NORDIC_BASE + FUEL + XZ, NORDIC, "rel", PARAMS_EU),
    "lrel13lf_s7": ([f for f in NORDIC_BASE if f not in ("reservoir_pct", "reservoir_anom", "nordic_reservoir_anom")] + ["res_pct_lf", "res_anom_lf", "nres_anom_lf"] + FUEL, NORDIC, "rel", dict(PARAMS_EU, random_state=7)),
    "lrel13nb": (NORDIC_BASE + FUEL + XNB, NORDIC, "rel", PARAMS_EU),
    # look-ahead check: the dataset's reservoir columns are normalised with the whole series' maximum and weekly medians (they include the future);
    # these use only what was known (expanding maximum, medians of earlier years, 14 days after the week they describe)
    "lrel13lf": ([f for f in NORDIC_BASE if f not in ("reservoir_pct", "reservoir_anom", "nordic_reservoir_anom")] + ["res_pct_lf", "res_anom_lf", "nres_anom_lf"] + FUEL, NORDIC, "rel", PARAMS_EU),
    "lrelnonb": (NORDIC_BASE + FUEL + XNB, NO, "rel", PARAMS_EU),
    # declared for docs/forecast-nordic-ens.md (before any scoring): the same tree WITHOUT any reservoir feature (DK1, DK2, NL have no reservoir series of their own)
    "lrel13nr": ([f for f in NORDIC_BASE if f not in ("reservoir_pct", "reservoir_anom", "nordic_reservoir_anom")] + FUEL, NORDIC, "rel", PARAMS_EU),
}


def folds(first="2025-04", last="2026-10", step=2):
    months = pd.period_range(first, last, freq="M")
    for i in range(0, len(months), step):
        yield months[i].start_time, months[min(i + step - 1, len(months) - 1)].end_time


def run_lgb(name, jobs):
    feats, zones, target, params = CANDS_LGB[name]
    A = pd.read_parquet(os.path.join(DIR, "nfr_frame.parquet"))
    A = A[A["zone"].isin(zones)].copy()
    nullable = {"reservoir_pct", "reservoir_anom"} | set(RES) | set(HYD)
    A["zone_c"] = pd.Categorical(A["zone"], categories=sorted(zones))
    fts = [("zone_c" if f == "zone" else f) for f in feats]
    req = [c for c in fts if not c.startswith("lag") and c != "zone_c" and c != "seasonal4w" and c not in nullable]
    hmax_train = 9 if name == "p0" else 8
    out = []
    for lo, hi in folds():
        t0 = time.time()
        tr = A[(A["date"] < lo) & (A["h"] <= hmax_train)].dropna(subset=req + ["y"] + (["level_7d"] if target == "rel" else []))
        te = A[(A["date"] >= lo) & (A["date"] <= hi) & (A["h"] <= 8)].copy()
        if len(tr) < 50_000 or te.empty:
            continue
        m = lgb.LGBMRegressor(n_jobs=jobs, **params)
        yt = tr["y"] - tr["level_7d"] if target == "rel" else tr["y"]
        m.fit(tr[fts], yt, categorical_feature=["zone_c"])
        p = m.predict(te[fts])
        te[name] = p + te["level_7d"].to_numpy() if target == "rel" else p
        out.append(te[["zone", "t", "h", name]])
        print(f"  {name} fold {lo:%Y-%m}..{hi:%Y-%m}: train {len(tr):,} test {len(te):,} in {time.time() - t0:.0f}s", flush=True)
    res = pd.concat(out, ignore_index=True)
    if name == "p0":                                   # what the Nordic job publishes: the model's level with a 50/50 seasonal shape
        B = A[["zone", "t", "h", "date", "seasonal4w"]].merge(res, on=["zone", "t", "h"])
        g = B.groupby(["zone", "date", "h"], sort=False)
        pm, sm = g[name].transform("mean"), g["seasonal4w"].transform("mean")
        hyb = (pm + 0.5 * (B[name] - pm) + 0.5 * (B["seasonal4w"] - sm)).where(sm.notna(), B[name])
        res = B[["zone", "t", "h"]].assign(p0_hyb=hyb.to_numpy(), p0=B[name].to_numpy())
    res.to_parquet(os.path.join(DIR, f"cand_{name}.parquet"), index=False)
    print(f"cand_{name}.parquet {len(res):,} rows", flush=True)


# ------------------------------------------------------------------ ridge (LEAR) candidates
# name: (window days, feature set, recency halflife)   sets: base = region_models.design + fuel + Nordic extras + price-relative lags (= the research's lear_r365_g)
RIDGE_SETS = {"base": [], "nb": XNB, "xz": XZ, "xzh": XZ + HYD, "xzhr": XZ + HYD + RES, "hr": HYD + RES}
CANDS_RIDGE = {
    "r365": (365, "base", None),
    "r730": (730, "base", None),
    "r365xz": (365, "xz", None),
    "r730xz": (730, "xz", None),
    "r365xzh": (365, "xzh", None),
    "r730xzh": (730, "xzh", None),
    "r365xzhr": (365, "xzhr", None),
    "r365hr": (365, "hr", None),
    "r365nofuel": (365, "nofuel", None),
    "r365nb": (365, "nb", None),
    "r730lf": (730, "lf", None),
    "r730nb": (730, "nb", None),
    # declared for docs/forecast-nordic-ens.md (before any scoring): the leak-free ridge with a 365-day window, and the 730-day ridge without reservoir features
    "r365lf": (365, "lf", None),
    "r730nr": (730, "nr", None),
}


def lear_zone(zone, A_z, X_z, step, window, hl):
    out = {}
    refits = np.arange(np.datetime64("2025-04-01"), np.datetime64("2026-11-03"), np.timedelta64(step, "D"))
    res = np.full(len(A_z), np.nan)
    for h, g in A_z.groupby("h"):
        pos = g.index.to_numpy() - A_z.index[0]
        dates = g["date"].to_numpy().astype("datetime64[D]")
        arr = FM.lear_block(X_z[pos], (g["y"] - g["b_lvlshape"]).to_numpy(), g["b_lvlshape"].to_numpy(), dates, int(h), refits, window, hl, "ridge",
                            np.datetime64("2025-04-01"), np.datetime64("2026-11-02"), step)
        res[pos] = arr
    return zone, res


def run_ridge(names, jobs):
    from joblib import Parallel, delayed
    A = pd.read_parquet(os.path.join(DIR, "nfr_frame.parquet"))
    A = A[A["h"] <= 8].reset_index(drop=True)
    cols = {}
    for name in names:
        window, fset, hl = CANDS_RIDGE[name]
        if fset == "nofuel":
            X = RM.design(A, False, extra=NORDIC_EXTRA)
        elif fset == "lf":
            X = RM.design(A, True, extra=["res_anom_lf", "nres_anom_lf", "hydro_precip_7d"])
        elif fset == "nr":
            X = RM.design(A, True, extra=["hydro_precip_7d"])
        else:
            X = RM.design(A, True, extra=NORDIC_EXTRA)
        X = X.join(A[EXTRA_LAGS].astype(np.float32))
        for c in RIDGE_SETS.get(fset, []):
            X[c] = A[c].astype(np.float32)           # NaN stays NaN: such rows are not used for training (lear_block drops them) nor predicted
        Xn = X.to_numpy(np.float32)
        t0 = time.time()
        jl = [(z, A.loc[idx, ["h", "date", "b_lvlshape", "y"]], Xn[idx]) for z, idx in A.groupby("zone").groups.items()]
        res = Parallel(n_jobs=jobs, backend="loky")(delayed(lear_zone)(z, sub, Xz, 7, window, hl) for z, sub, Xz in jl)
        col = pd.Series(np.nan, index=A.index)
        for (z, arr), (_, sub, _) in zip(res, jl):
            col.loc[sub.index] = arr
        cols[name] = col
        print(f"  {name}: {X.shape[1]} features in {time.time() - t0:.0f}s, non-null {col.notna().mean():.3f}", flush=True)
        pd.concat([A[["zone", "t", "h"]], col.rename(name)], axis=1).dropna(subset=[name]).to_parquet(os.path.join(DIR, f"cand_{name}.parquet"), index=False)


def merge():
    A = pd.read_parquet(os.path.join(DIR, "nfr_frame.parquet"), columns=["zone", "t", "date", "h", "hour", "y", "level_7d", "ewm7", "b_lag7", "b_seasonal", "b_persist", "b_lvlshape", "seasonal4w", "lag_last"])
    A = A[(A["h"] <= 8) & (A["date"] >= EVAL_FROM) & (A["date"] <= EVAL_TO)]
    for f in sorted(glob.glob(os.path.join(DIR, "cand_*.parquet"))):
        c = pd.read_parquet(f)
        A = A.merge(c, on=["zone", "t", "h"], how="left")
    A.to_parquet(os.path.join(DIR, "nfr_all.parquet"), index=False)
    print(f"nfr_all.parquet {len(A):,} rows; columns {[c for c in A.columns if c not in ('zone', 't', 'date', 'h', 'hour', 'y')]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["frame", "lgb", "ridge", "merge"])
    ap.add_argument("names", nargs="*")
    ap.add_argument("--jobs", type=int, default=10)
    a = ap.parse_args()
    if a.cmd == "frame":
        build()
    elif a.cmd == "lgb":
        for n in a.names:
            run_lgb(n, a.jobs)
    elif a.cmd == "ridge":
        run_ridge(a.names or list(CANDS_RIDGE), a.jobs)
    else:
        merge()


if __name__ == "__main__":
    main()
