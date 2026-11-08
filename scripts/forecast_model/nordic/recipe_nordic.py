"""The Nordic ENSEMBLE recipe (docs/forecast-nordic-no.md), as pure functions on frames of (zone, hour, horizon h) rows, no network, no files except what is passed in.

    published = hybrid( mean( 730-day ridge on the residual of level+shape , LightGBM on price - level_7d ) )

* the ridge is the EU recipe's linear half (eu/recipe.py: eu/region_models.design with the gas / carbon features, price-relative lags) with the Nordic extras
  (reservoir anomaly, Nordic reservoir anomaly, 7-day regional rain), one ridge per zone and horizon on the last 730 days of settled targets;
* the tree is the EU recipe's tree (target = price - level_7d, 400 trees x 63 leaves, `zone` categorical) pooled over the 13 zones, on the Nordic features + fuel;
* the reservoir features are the LEAK-FREE ones (reservoir_lf): the dataset's own columns normalise with the whole series' maximum and weekly medians, which
  contain the future; these use an expanding maximum and the medians of earlier years only, and a reading is used 14 days after the week it describes;
* hybrid = the model's daily level, intraday shape half its own and half the seasonal profile (the Nordic job's post-processing, unchanged: 50/50).
It is used for the zones whose gate entry names a recipe in VARIANTS (publish_gate_nordic.json); the other zones keep the pooled model of train_daily.py.
The variants are the ones declared before scoring in docs/forecast-nordic-ens.md (research_no/decide_recipe.py picks one per zone by a mechanical rule):
`ens` (the Norway recipe above), `ens365` (365-day ridge window), `ens_nr` (no reservoir feature in either model), `ens_b25` (25 % seasonal profile in the intraday shape).

Imports from the EU job's modules (flat next to this file on the Spark, see the rollout in the doc): region_models, family_models, fuel_features, calendar_features.
"""
import os
import sys

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
sys.path.append(os.path.join(DIR, "..", "eu"))                 # the EU modules, from the repo layout; flat copies next to this file win on the Spark
import calendar_features as cal        # noqa: E402
import family_models as FM             # noqa: E402
import fuel_features as FUEL           # noqa: E402
import region_models as RM             # noqa: E402

ZONES = ["dk1", "dk2", "no1", "no2", "no3", "no4", "no5", "se1", "se2", "se3", "se4", "fi", "nl"]
NO = ["no1", "no2", "no3", "no4", "no5"]
H_MIN, H_MAX = 2, 8
LEAR_WINDOW_DAYS = 730
LEAR_MIN_ROWS = 24 * 40
BLEND = 0.5
MODEL_NAME = "nordic-ens-v1"
# the recipe variants (gate entry `recipe`): ridge window in days, reservoir features in the models, share of the seasonal profile in the intraday shape
VARIANTS = {"ens": {"window": LEAR_WINDOW_DAYS, "reservoir": True, "blend": BLEND},
            "ens365": {"window": 365, "reservoir": True, "blend": BLEND},
            "ens_nr": {"window": LEAR_WINDOW_DAYS, "reservoir": False, "blend": BLEND},
            "ens_b25": {"window": LEAR_WINDOW_DAYS, "reservoir": True, "blend": 0.25}}

NORDIC_BASE = ["zone", "h", "hour", "weekday", "month", "is_weekend", "doy_sin", "doy_cos",
               "lag1", "lag2", "lag3", "lag7", "lag14", "lag21", "lag28", "seasonal4w", "last_day_mean", "level_30d",
               "wind", "rad", "temp", "precip", "precip_24h", "reg_wind", "reg_temp", "hydro_precip", "hydro_precip_7d"]
RES_LF = ["res_pct_lf", "res_anom_lf", "nres_anom_lf"]
FUEL_FEATS = ["gas", "gas_d7", "gas_d28", "gas_m1_spread", "eua", "eua_d7", "eua_d28", "ccgt_mc", "ccgt_mc_d7", "ccgt_mc_d28", "mc_gap"]
LGB_FEATS = NORDIC_BASE + RES_LF + FUEL_FEATS
LGB_FEATS_NR = NORDIC_BASE + FUEL_FEATS                       # the `ens_nr` tree: no reservoir feature at all
LGB_NULLABLE = set(RES_LF)
RIDGE_EXTRA = ["res_anom_lf", "nres_anom_lf", "hydro_precip_7d"]
RIDGE_EXTRA_NR = ["hydro_precip_7d"]
EXTRA_LAGS = ["d_lag_last", "d_prev", "d_lag7", "d_lag14"]
LGB_PARAMS = dict(objective="quantile", alpha=0.5, n_estimators=400, num_leaves=63, min_child_samples=60, learning_rate=0.06,
                  subsample=0.6, subsample_freq=1, colsample_bytree=0.8, max_bin=127, verbosity=-1)
RES_LAG_DAYS = 14
HYDRO_POINTS = ["no1", "no2", "no3", "no4", "no5", "se1", "se2"]      # the zones whose rain feeds the regional hydro features (dataset.HYDRO)
LAGS = (1, 2, 3, 7, 14, 21, 28)


# ------------------------------------------------------------------ leak-free reservoir
def reservoir_lf(r):
    """r: the weekly table (columns t_utc, mwh, zone; reservoir_weekly.parquet) -> {zone: daily DataFrame(res_pct_lf, res_anom_lf, res_chg4w, nres_anom_lf)}.
    Share of the maximum SO FAR, deviation from the median of the same ISO week in EARLIER years only, 4-week change; each reading is dated 14 days after
    the week it describes (so nothing is seen early) and held until the next one; the Nordic aggregate is the mean anomaly of the zones present."""
    r = r.copy()
    r["t"] = pd.to_datetime(r["t_utc"], utc=True).dt.tz_convert("Europe/Copenhagen").dt.tz_localize(None).dt.normalize()
    days = pd.date_range("2022-01-01", pd.Timestamp.today().normalize() + pd.Timedelta(days=12), freq="D")
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


def add_reservoir_lf(df, res):
    """The three leak-free reservoir columns at the last known day L = date - (h - 1) for rows with zone, date, h."""
    out = df.copy()
    for c in RES_LF:
        out[c] = np.nan
    L = out["date"] - pd.to_timedelta(out["h"] - 1, unit="D")
    for z, idx in out.groupby("zone").groups.items():
        if z in res:
            for c in RES_LF:
                out.loc[idx, c] = res[z][c].reindex(L.loc[idx].to_numpy()).to_numpy()
    return out


# ------------------------------------------------------------------ rows: the columns the recipe needs, for history and live rows alike
def augment(df, prices, tables=None):
    """Rows (zone str, t, date, h, the dataset's columns) -> the same rows with level_7d, ewm5, lag_last, p_prev, calendar flags, the naive baseline `b_lvlshape`
    and the price-relative lags. Every column uses only prices up to the row's last known day (target - (h - 1)); lags k >= h - 1. Used by the training set
    and by the live rows, so the two cannot drift apart."""
    out = df.copy()
    out["zone"] = out["zone"].astype(str)
    tables = tables or RM.day_tables(prices)
    out = RM.attach_last_known(out, tables, ["ewm5", "level_7d"])
    out["lag_last"] = np.nan
    out["p_prev"] = np.nan
    for (z, h), idx in out.groupby(["zone", "h"]).groups.items():
        t = out.loc[idx, "t"]
        out.loc[idx, "lag_last"] = prices[z].reindex(t - pd.Timedelta(days=int(h) - 1)).to_numpy()
        out.loc[idx, "p_prev"] = prices[z].reindex(t - pd.Timedelta(days=int(h))).to_numpy()
    out["is_holiday"] = 0
    xm = {d: (1 if cal.xmas_week(d.date()) else 0) for d in out["date"].unique()}
    out["xmas_week"] = out["date"].map(xm)
    out["shape_s"] = RM.shape(out)
    out["b_lvlshape"] = out["shape_s"] + out["level_7d"]
    out["d_lag_last"] = out["lag_last"] - out["level_7d"]
    out["d_prev"] = out["p_prev"] - out["level_7d"]
    out["d_lag7"] = out["lag7"] - out["level_7d"]
    out["d_lag14"] = out["lag14"] - out["level_7d"]
    return out


def add_fuel(df, table):
    """The leak-free fuel columns (fuel_features) and mc_gap = CCGT marginal cost - the 30-day level (what the research's Nordic fuel dataset used)."""
    out = FUEL.add_to_frame(df, table)
    out["mc_gap"] = out["ccgt_mc"] - out["level_30d"]
    return out


# ------------------------------------------------------------------ the ridge
def ridge_design(df, fuel=True, reservoir=True):
    return RM.design(df, fuel, extra=RIDGE_EXTRA if reservoir else RIDGE_EXTRA_NR).join(df[EXTRA_LAGS].astype(np.float32))


def lear_predict(history, live, fuel=True, window=LEAR_WINDOW_DAYS, min_rows=LEAR_MIN_ROWS, reservoir=True):
    """One ridge per (zone, h) of the live rows, trained on the settled rows of the same zone and h whose target day lies in (T - h - window, T - h], T = the
    first target day of that group (T - h is the day before the last known day: the newest target settled at issue). NaN where there are too few training
    hours or a feature is missing: never a patched value. history / live: augmented rows (zone, h, date, y / b_lvlshape + features)."""
    out = pd.Series(np.nan, index=live.index)
    if live.empty:
        return out
    Xl = ridge_design(live, fuel, reservoir)
    for (z, h), g in live.groupby(["zone", "h"]):
        first = g["date"].min()
        end = first - pd.Timedelta(days=int(h))
        tr = history[(history["zone"] == z) & (history["h"] == h) & (history["date"] <= end) & (history["date"] > end - pd.Timedelta(days=window))]
        if len(tr) < min_rows:
            continue
        Xt = ridge_design(tr, fuel, reservoir).to_numpy(np.float64)
        yt = (tr["y"] - tr["b_lvlshape"]).to_numpy(np.float64)
        ok = np.isfinite(Xt).all(axis=1) & np.isfinite(yt)
        if ok.sum() < min_rows:
            continue
        model = FM.ridge_fit(Xt[ok], yt[ok], np.ones(int(ok.sum())))
        Xg = Xl.loc[g.index].to_numpy(np.float64)
        good = np.isfinite(Xg).all(axis=1) & g["b_lvlshape"].notna().to_numpy()
        if good.any():
            out.loc[g.index[good]] = g.loc[g.index[good], "b_lvlshape"].to_numpy() + FM.linear_predict(model, Xg[good])
    return out


# ------------------------------------------------------------------ the tree
def lgb_feats(reservoir=True):
    return LGB_FEATS if reservoir else LGB_FEATS_NR


def lgb_required(feats=LGB_FEATS):
    return [c for c in feats if not c.startswith("lag") and c not in ("zone", "seasonal4w") and c not in LGB_NULLABLE]


def lgb_fit(train, jobs=8, alpha=0.5, reservoir=True):
    """The pooled tree on price - level_7d. train: augmented rows with fuel and reservoir columns. Returns (model, rows used)."""
    import lightgbm as lgb
    feats = lgb_feats(reservoir)
    tr = train.dropna(subset=lgb_required(feats) + ["y", "level_7d"])
    tr = tr.assign(zone=pd.Categorical(tr["zone"], categories=ZONES))
    m = lgb.LGBMRegressor(n_jobs=jobs, **{**LGB_PARAMS, "alpha": alpha})
    m.fit(tr[feats], tr["y"] - tr["level_7d"], categorical_feature=["zone"])
    return m, tr


def lgb_predict(model, rows, reservoir=True):
    X = rows.assign(zone=pd.Categorical(rows["zone"], categories=ZONES))
    return model.predict(X[lgb_feats(reservoir)]) + rows["level_7d"].to_numpy()


# ------------------------------------------------------------------ the point forecast
def point_forecast(ridge, tree):
    """The mean of the two models; NaN where either is NaN (the day is then not published: no stand-in, the gate measured the mean)."""
    return (np.asarray(ridge, dtype=float) + np.asarray(tree, dtype=float)) / 2


def hybrid(rows, point, blend=BLEND):
    """The Nordic job's shape blend per (zone, date, h): the model's daily mean, (1 - blend) of its own intraday shape plus `blend` of the seasonal4w profile's
    (shape = deviation from the day's mean; blend 0.5 is the production post-processing). Falls back to the model's own hours where there is no seasonal profile."""
    f = rows[["zone", "date", "h", "seasonal4w"]].copy()
    f["p"] = np.asarray(point, dtype=float)
    g = f.groupby(["zone", "date", "h"], sort=False)
    pm, sm = g["p"].transform("mean"), g["seasonal4w"].transform("mean")
    out = pm + (1 - blend) * (f["p"] - pm) + blend * (f["seasonal4w"] - sm)
    return out.where(sm.notna(), f["p"]).to_numpy()


# ------------------------------------------------------------------ live rows
def regional_weather(live, hist, today):
    """Regional context on an hourly index from today - 8 days to today + 10 days: the Nordic mean wind and temperature, the hydro zones' mean rain and its
    trailing 7-day sum. `hist` = {zone: observed weather frame (index = hour)} for the days before today (its rain makes the 7-day sum complete from the first day:
    train_daily.score() summed from today 00:00 only, so a window shorter than the training rows' for the first days)."""
    idx = pd.date_range(pd.Timestamp(today) - pd.Timedelta(days=8), periods=18 * 24, freq="h")

    def series(z, col):
        parts = []
        if z in hist:
            parts.append(hist[z][col])
        parts.append(live[z][col])
        s = pd.concat(parts)
        s = s[~s.index.duplicated(keep="last")]           # the live forecast wins where both exist
        return s.reindex(idx).to_numpy()

    wind = np.nanmean([series(z, "wind_speed_100m") for z in ZONES], axis=0)
    temp = np.nanmean([series(z, "temperature_2m") for z in ZONES], axis=0)
    hyd = np.nanmean([series(z, "precipitation") for z in HYDRO_POINTS], axis=0)
    out = pd.DataFrame({"reg_wind": wind, "reg_temp": temp, "hydro_precip": hyd}, index=idx)
    out["hydro_precip_7d"] = out["hydro_precip"].rolling(24 * 7, min_periods=24).sum()
    return out


def live_rows(zone, p, live_z, reg, today, last_known, h_max=H_MAX):
    """The feature rows (24 hours per day) of every forecast day of one zone after its last known price day `last_known` (a date; never later than today + 1),
    up to today + 8 and h <= h_max. h = days from the last known day to the target + 1, as in training. Same columns as dataset.build (without the
    reservoir and fuel columns, added by add_reservoir_lf / add_fuel afterwards) plus `date`, `t`, `zone`."""
    day_mean = p.groupby(p.index.normalize()).mean()
    lvl30 = day_mean.rolling(30, min_periods=10).mean()
    parts = []
    d = pd.Timestamp(last_known) + pd.Timedelta(days=1)
    while d <= pd.Timestamp(today) + pd.Timedelta(days=8):
        h = (d - pd.Timestamp(last_known)).days + 1
        if H_MIN <= h <= h_max:
            idx = pd.date_range(d, periods=24, freq="h")
            row = pd.DataFrame({"t": idx, "date": d, "zone": zone, "h": h, "hour": range(24)})
            row["weekday"], row["month"] = d.weekday(), d.month
            row["is_weekend"] = int(d.weekday() >= 5)
            doy = d.timetuple().tm_yday
            row["doy_sin"], row["doy_cos"] = np.sin(2 * np.pi * doy / 365.25), np.cos(2 * np.pi * doy / 365.25)
            for k in LAGS:
                row[f"lag{k}"] = p.reindex(idx - pd.Timedelta(days=k)).to_numpy() if k >= h - 1 else np.nan
            row["seasonal4w"] = row[[f"lag{k}" for k in (7, 14, 21, 28)]].mean(axis=1)
            lk = d - pd.Timedelta(days=h - 1)
            row["last_day_mean"] = day_mean.get(lk, np.nan)
            row["level_30d"] = lvl30.get(lk, np.nan)
            w = live_z.reindex(idx)
            row["wind"], row["rad"] = w["wind_speed_100m"].to_numpy(), w["direct_radiation"].to_numpy()
            row["temp"], row["precip"] = w["temperature_2m"].to_numpy(), w["precipitation"].to_numpy()
            row["precip_24h"] = live_z["precipitation"].rolling(24, min_periods=6).sum().reindex(idx).to_numpy()
            r = reg.reindex(idx)
            for c in ("reg_wind", "reg_temp", "hydro_precip", "hydro_precip_7d"):
                row[c] = r[c].to_numpy()
            parts.append(row)
        d += pd.Timedelta(days=1)
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()


def last_known_day(p, today, min_hours=12):
    """The newest date with at least `min_hours` priced hours, never later than today + 1 (the information state of the backtest), or None."""
    s = p.dropna()
    n = s.groupby(s.index.normalize()).size()
    n = n[n >= min_hours]
    if not len(n):
        return None
    return min(n.index.max(), pd.Timestamp(today) + pd.Timedelta(days=1)).date()
