"""The per-region candidate models of docs/forecast-per-region.md, as pure functions on a frame of (zone, t, h) rows - no
files, no network - so they are unit-tested and the backtest (region_backtest.py) is only orchestration.

Every candidate is a forecast column built only from what the row's own features say was known at issue time (the dataset's
leakage rule: price lag k exists only when k >= h - 1, day statistics end at the last known day T - h + 1, fuel from the close
of the day before issue). Candidates:

  level_shape   (the naive to beat)  the seasonal4w hourly profile shifted so its daily mean = the mean of the last 7 known days
  a_ewm5/_ewm7  the same shape, level = exponentially weighted mean of the daily means, half-life 5 / 7 days
  b_ridge_*     ridge regression on a few features for the RESIDUAL y - level_shape: last known day's hourly shape, last week's
                same hour, level trend, weekday / hour / holiday, wind / solar / temperature forecasts (also times hour), and -
                in the `gas` variant - the fuel features. One model per zone and horizon.
  c_rank        a LightGBM on the within-day DEVIATION of the price (the hour ordering and nothing else); scored by regret
  d_lin         a linear model of the DAILY mean on the fuel cost (CCGT marginal cost, its 7/28-day change), the last known level
                and the day's weather, plus the seasonal shape: "a level model that knows the fuel price"
  e_ref*        reference-zone forecast + the zone's recent spread to it (weekday-hour spread of the last four weeks, and / or the
                last 7 days' level spread): for zones that follow a neighbour (CEE / SEE after DE or HU, the Baltics after FI / SE4)
  f_ptes        PT = the ES forecast (the two zones clear at one price in most hours)
"""
import numpy as np
import pandas as pd

GROUPS = {
    "nordic": ["no1", "no2", "no3", "no4", "no5", "se1", "se2", "se3", "se4", "fi", "dk1", "dk2"],
    "core": ["de", "fr", "nl", "be", "at", "ch", "cz", "pl"],
    "iberia": ["es", "pt"],
    "it-n": ["it-n"],
    "cee": ["hu", "sk", "ro", "bg", "gr", "hr", "si", "rs", "me", "mk", "al", "xk"],
    "baltics": ["ee", "lv", "lt"],
    "ie": ["ie"],
}
ZONE_GROUP = {z: g for g, zs in GROUPS.items() for z in zs}
# standard-time UTC offset of each zone's wall clock; all of Europe changes to summer time on the same two dates, so the
# difference between two zones' clocks is constant through the year
STD_OFFSET = {**{z: 1 for z in ["no1", "no2", "no3", "no4", "no5", "se1", "se2", "se3", "se4", "dk1", "dk2", "de", "fr", "nl", "be",
                                "at", "ch", "cz", "pl", "it-n", "es", "hu", "sk", "hr", "si", "rs", "me", "mk", "al", "xk"]},
              **{z: 2 for z in ["fi", "gr", "ro", "bg", "ee", "lv", "lt"]}, **{z: 0 for z in ["pt", "ie"]}}
NAIVE = ["b_lag7", "b_seasonal", "b_persist", "b_lvlshape"]
HOURS = list(range(24))
BLOCKS = {"night": range(0, 6), "morning": range(6, 11), "midday": range(11, 17), "evening": range(17, 24)}


# ------------------------------------------------------------------ levels and shapes
def day_tables(prices, halflives=(5, 7)):
    """{zone: hourly Series on the zone's local clock} -> {zone: DataFrame indexed by calendar day with
    day_mean, ewm<hl> (exponentially weighted mean of the daily means up to and including the day)}."""
    out = {}
    for z, p in prices.items():
        dm = p.groupby(p.index.normalize()).mean()
        dm = dm.reindex(pd.date_range(dm.index.min(), dm.index.max(), freq="D"))
        t = pd.DataFrame({"day_mean": dm, "day_std": p.groupby(p.index.normalize()).std().reindex(dm.index),
                          "level_7d": dm.rolling(7, min_periods=3).mean()})
        for hl in halflives:
            t[f"ewm{hl}"] = dm.ewm(halflife=hl, min_periods=3, ignore_na=False).mean()
        out[z] = t
    return out


def attach_last_known(df, tables, cols):
    """Append the columns `cols` of each zone's day table taken at the LAST KNOWN day (date - (h - 1))."""
    out = df.copy()
    for c in cols:
        out[c] = np.nan
    last = out["date"] - pd.to_timedelta(out["h"] - 1, unit="D")
    for z, idx in out.groupby("zone", observed=True).groups.items():
        t = tables.get(str(z))
        if t is None:
            continue
        sub = last.loc[idx]
        for c in cols:
            out.loc[idx, c] = t[c].reindex(sub.to_numpy()).to_numpy()
    return out


def day_mean_of(df, col):
    """The mean of `col` over each (zone, date, h) group, broadcast back to the rows."""
    return df.groupby(["zone", "date", "h"], observed=True, sort=False)[col].transform("mean")


def shape(df):
    """The seasonal hourly profile minus its own daily mean: pure shape, no level."""
    return df["seasonal4w"] - day_mean_of(df, "seasonal4w")


def level_shape(df, level_col="level_7d"):
    """Level + shape with the level taken from `level_col` (level_7d = the naive baseline of the existing backtest)."""
    return shape(df) + df[level_col]


# ------------------------------------------------------------------ (b) ridge
def _blocks(df):
    return {b: df["hour"].isin(list(r)).astype(np.float32) for b, r in BLOCKS.items()}


def design(df, fuel, extra=()):
    """The ridge's feature matrix for rows `df` (float32). `fuel` adds the gas / carbon columns; `extra` names further columns
    (the Nordic reservoir / hydro-precipitation features) that are used as they are, an empty value counting as 0."""
    X = {}
    for c in extra:
        X[c] = df[c].fillna(0).astype(np.float32)
    X["shape_persist"] = (df["lag_last"] - df["last_day_mean"]).astype(np.float32)
    X["lag7_dev"] = (df["lag7"] - df["seasonal4w"]).astype(np.float32)
    X["trend"] = (df["level_7d"] - df["level_30d"]).astype(np.float32)
    X["last_vs_lvl"] = (df["last_day_mean"] - df["level_7d"]).astype(np.float32)
    X["ewm_vs_lvl"] = (df["ewm5"] - df["level_7d"]).astype(np.float32)
    X["is_weekend"] = df["is_weekend"].astype(np.float32)
    X["is_holiday"] = df["is_holiday"].astype(np.float32)
    X["xmas_week"] = df["xmas_week"].astype(np.float32)
    for d in range(1, 7):
        X[f"wd{d}"] = (df["weekday"] == d).astype(np.float32)
    hd = {k: (df["hour"] == k).astype(np.float32) for k in HOURS}
    for k in HOURS[1:]:
        X[f"hr{k}"] = hd[k]
    for v in ("wind", "rad", "temp", "reg_wind"):
        x = df[v].astype(np.float32)
        X[v] = x
    for k in HOURS:                       # wind and solar act differently by hour of the day
        X[f"wind_x_h{k}"] = df["wind"].astype(np.float32) * hd[k]
        X[f"rad_x_h{k}"] = df["rad"].astype(np.float32) * hd[k]
    if fuel:
        blocks = _blocks(df)
        gap = (df["ccgt_mc"] - df["level_7d"]).astype(np.float32)
        for name, v in (("gap", gap), ("mc_d7", df["ccgt_mc_d7"]), ("mc_d28", df["ccgt_mc_d28"])):
            for b, m in blocks.items():
                X[f"{name}_{b}"] = (v * m).astype(np.float32)
        X["eua_d28"] = df["eua_d28"].astype(np.float32)
        X["gas_m1_spread"] = df["gas_m1_spread"].astype(np.float32)
    return pd.DataFrame(X, index=df.index)


def ridge_residual(train, test, fuel, alpha=50.0, base="b_lvlshape", extra=()):
    """Fit y - base on `train`, return base + prediction on `test` (NaN where a feature is missing). Features are standardised on
    the training rows; the intercept is free."""
    from sklearn.linear_model import Ridge
    Xtr, Xte = design(train, fuel, extra), design(test, fuel, extra)
    ok = Xtr.notna().all(axis=1) & train[base].notna() & train["y"].notna()
    if ok.sum() < 500:
        return pd.Series(np.nan, index=test.index)
    mu, sd = Xtr[ok].mean(), Xtr[ok].std().replace(0, 1.0)
    m = Ridge(alpha=alpha).fit(((Xtr[ok] - mu) / sd).to_numpy(np.float32), (train.loc[ok, "y"] - train.loc[ok, base]).to_numpy())
    good = Xte.notna().all(axis=1) & test[base].notna()
    out = pd.Series(np.nan, index=test.index)
    if good.any():
        out[good] = test.loc[good, base].to_numpy() + m.predict(((Xte[good] - mu) / sd).to_numpy(np.float32))
    return out


# ------------------------------------------------------------------ (d) daily linear model on the fuel cost
DAILY_FEATS = ["mc_gap", "ccgt_mc_d7", "ccgt_mc_d28", "last_vs_ewm", "trend", "wind_day", "rad_day", "temp_day", "is_weekend", "is_holiday"]


def daily_frame(df):
    """One row per (zone, date, h): the day's mean price and the day-level features of the linear model."""
    d = df.assign(wind_day=df["wind"], rad_day=df["rad"], temp_day=df["temp"], dm=df["y"])
    g = d.groupby(["zone", "date", "h"], observed=True, sort=False)
    agg = g.agg(dm=("dm", "mean"), n=("dm", "count"), wind_day=("wind_day", "mean"), rad_day=("rad_day", "mean"),
                temp_day=("temp_day", "mean"), is_weekend=("is_weekend", "first"), is_holiday=("is_holiday", "first"),
                ewm7=("ewm7", "first"), level_7d=("level_7d", "first"), level_30d=("level_30d", "first"),
                last_day_mean=("last_day_mean", "first"), ccgt_mc=("ccgt_mc", "first"), ccgt_mc_d7=("ccgt_mc_d7", "first"),
                ccgt_mc_d28=("ccgt_mc_d28", "first")).reset_index()
    agg["mc_gap"] = agg["ccgt_mc"] - agg["ewm7"]
    agg["last_vs_ewm"] = agg["last_day_mean"] - agg["ewm7"]
    agg["trend"] = agg["level_7d"] - agg["level_30d"]
    return agg


def daily_linear(train_days, test_days, alpha=5.0):
    """Ridge on day-level features for (daily mean - ewm7); returns the predicted daily mean for each test day (NaN if a
    feature is missing). Fitted on one zone and one horizon at a time by the caller."""
    from sklearn.linear_model import Ridge
    ok = train_days[DAILY_FEATS + ["dm", "ewm7"]].notna().all(axis=1) & (train_days["n"] >= 22)
    if ok.sum() < 60:
        return pd.Series(np.nan, index=test_days.index)
    X = train_days.loc[ok, DAILY_FEATS]
    mu, sd = X.mean(), X.std().replace(0, 1.0)
    m = Ridge(alpha=alpha).fit(((X - mu) / sd).to_numpy(), (train_days.loc[ok, "dm"] - train_days.loc[ok, "ewm7"]).to_numpy())
    good = test_days[DAILY_FEATS + ["ewm7"]].notna().all(axis=1)
    out = pd.Series(np.nan, index=test_days.index)
    if good.any():
        out[good] = test_days.loc[good, "ewm7"].to_numpy() + m.predict(((test_days.loc[good, DAILY_FEATS] - mu) / sd).to_numpy())
    return out


# ------------------------------------------------------------------ (c) rank features
RANK_FEATS = ["zone", "h", "hour", "weekday", "month", "is_weekend", "is_holiday", "doy_sin", "doy_cos",
              "wind", "rad", "temp", "precip", "wind_dev", "rad_dev", "temp_dev", "wind_day", "rad_day",
              "shape_s", "shape_persist", "lag7_dev", "last_day_std", "level_7d", "mc_gap", "ccgt_mc"]


def rank_frame(df):
    """Add the within-day deviation features and the target `dev` (price minus the day's mean price)."""
    d = df.copy()
    for v in ("wind", "rad", "temp"):
        dm = day_mean_of(d, v)
        d[f"{v}_day"] = dm
        d[f"{v}_dev"] = d[v] - dm
    d["shape_s"] = shape(d)
    d["shape_persist"] = d["lag_last"] - d["last_day_mean"]
    d["lag7_dev"] = d["lag7"] - d["seasonal4w"]
    d["dev"] = d["y"] - day_mean_of(d, "y")
    return d


# ------------------------------------------------------------------ (e) reference-zone model
def spread_series(p_zone, p_ref, offset_hours):
    """Hourly spread zone - reference on the ZONE's clock. `offset_hours` = the zone's standard-time offset minus the
    reference's: the reference's local timestamp t_r is the zone's t_r + offset."""
    ref = p_ref.copy()
    ref.index = ref.index + pd.Timedelta(hours=int(offset_hours))
    return (p_zone - ref.reindex(p_zone.index)).dropna()


def spread_features(rows, spread):
    """For rows (zone, t, date, h): sp_wdh = the mean of the spread at t - 7k days, k = 1..4 (all >= h - 1 for h <= 8, so known
    at issue); sp_lvl = the mean of the daily mean spread over the 7 days ending at the last known day (date - (h-1))."""
    lags = [spread.reindex(rows["t"] - pd.Timedelta(days=7 * k)).to_numpy() for k in range(1, 5)]
    sp_wdh = np.nanmean(np.vstack(lags), axis=0) if len(rows) else np.array([])
    dmean = spread.groupby(spread.index.normalize()).mean()
    dmean = dmean.reindex(pd.date_range(dmean.index.min(), dmean.index.max(), freq="D"))
    lvl7 = dmean.rolling(7, min_periods=3).mean()
    last = rows["date"] - pd.to_timedelta(rows["h"] - 1, unit="D")
    return pd.DataFrame({"sp_wdh": sp_wdh, "sp_lvl": lvl7.reindex(last.to_numpy()).to_numpy()}, index=rows.index)


def reference_candidates(rows, ref_fc, sp):
    """The three reference-zone forecasts for `rows` given the reference's forecast on the zone's clock (`ref_fc`, aligned to
    rows) and the spread features `sp` (spread_features)."""
    g = pd.DataFrame({"zone": rows["zone"], "date": rows["date"], "h": rows["h"], "w": sp["sp_wdh"]})
    wdm = g.groupby(["zone", "date", "h"], observed=True, sort=False)["w"].transform("mean")
    return pd.DataFrame({"e1": ref_fc + sp["sp_wdh"],                                  # ref + the weekday-hour spread
                         "e2": ref_fc + sp["sp_lvl"] + (sp["sp_wdh"] - wdm),           # ref + level spread + spread SHAPE
                         "e3": ref_fc + sp["sp_lvl"]}, index=rows.index)               # ref + level spread only
