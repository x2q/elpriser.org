"""The recipe that is published (docs/forecast-per-region.md, sections 1, 5 and 7), as pure functions on frames of (zone, hour, horizon h) rows.

    zones other than EE / LV / LT, fuel inputs usable   mean( LEAR-365 with fuel , LightGBM with fuel )                 `ens`
    the same zones, fuel NOT usable                      mean( LEAR-365 without fuel , LightGBM without fuel )         `ens-nofuel`
    EE, LV, LT (the Baltics: fuel does not help there)   the current LightGBM without fuel                             `lgb`

LEAR-365 = the research's `lear_r365_g` / `lear_r365`: per zone and horizon a closed-form ridge on the RESIDUAL of the naive 'level +
shape' forecast, trained on the last 365 days of settled targets (window ending the day before the last known day, exactly what was
settled when the first forecast of a block was issued), features region_models.design (110 columns: last day's shape, last week's hour,
level trend, calendar, wind/solar/temperature and their hour interactions, and - with fuel - the gas-plant cost features) plus four
price-relative lags. Refitted every day (the research refit weekly; the daily refit was 1-2 points better and costs seconds).
LightGBM = backtest.py's model: pooled over the zones, `zone` categorical, target = price - level_7d, 400 trees.

Everything here is a function of the rows only, so training rows and live rows are built and augmented by the SAME code (the leakage
rule of features.py and fuel_features.py holds for both) and the whole recipe is unit-tested without LightGBM or the network.
"""
import os
import sys

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import family_models as FM        # noqa: E402
import fuel_features as FUEL      # noqa: E402
import region_models as RM        # noqa: E402

BALTICS = ("ee", "lv", "lt")
H_MIN, H_MAX = 2, 7
LEAR_WINDOW_DAYS = 365
LEAR_MIN_ROWS = 24 * 40           # fewer training hours than this: no linear model (the zone-horizon is not published)
EXTRA_LAGS = ["d_lag_last", "d_prev", "d_lag7", "d_lag14"]
# Hourly price lags of a LIVE row can be missing where the training rows (built in hindsight) never are: the last known day of Portugal and Ireland
# has no hour 23 (it belongs to the market day that is not published yet), a zone's price feed has a hole of an hour or a day now and then. The
# LightGBM models take a missing lag as it is; the ridge cannot, so such a feature is replaced by its training-window mean (which makes its
# contribution zero) - for at most MAX_IMPUTED of these six per row, and never for weather, calendar, level or fuel features.
IMPUTABLE = ("shape_persist", "lag7_dev", "d_lag_last", "d_prev", "d_lag7", "d_lag14")
MAX_IMPUTED = 3
RECIPES = {"ens": "mean of a 365-day rolling ridge and LightGBM, with gas and carbon inputs, plus a level correction (half of the last 14 settled days' error)",
           "ens-nofuel": "mean of a 365-day rolling ridge and LightGBM, without fuel inputs, plus a level correction (half of the last 14 settled days' error)",
           "lgb": "LightGBM, plus a level correction (half of the last 14 settled days' error)"}
MODEL_NAME = "eu-ens-v2"


def recipe_for(zone, fuel_ok):
    """'lgb' for the Baltics, otherwise 'ens' when the fuel inputs are usable and 'ens-nofuel' when not."""
    if zone in BALTICS:
        return "lgb"
    return "ens" if fuel_ok else "ens-nofuel"


# ------------------------------------------------------------------ rows: fuel and the columns the linear model needs
def add_fuel_columns(df, table):
    """Rows with `date` (a normalised timestamp) and `h` -> the same rows with the leak-free fuel features and `mc_gap`
    (fuel_dataset.add_fuel, applied to a frame that already has `date`)."""
    out = FUEL.add_to_frame(df, table)
    out["mc_gap"] = out["ccgt_mc"] - out["level_7d"]
    return out


def augment(df, prices, tables=None):
    """Add what the linear model needs on top of features.make_features (+ fuel): ewm5 and the naive 'level + shape' baseline `b_lvlshape`
    (the point the ridge corrects), and the price-relative lags. `df` has zone (str), t, date, h; `prices` is {zone: hourly Series on the
    zone's clock}. Every added column uses only prices up to the row's last known day (target - (h - 1)); the lags k >= h - 1."""
    out = df.copy()
    out["zone"] = out["zone"].astype(str)
    tables = tables or RM.day_tables(prices)
    out = RM.attach_last_known(out, tables, ["ewm5"])
    out["shape_s"] = RM.shape(out)
    out["b_lvlshape"] = out["shape_s"] + out["level_7d"]
    out["p_prev"] = np.nan
    for (z, h), idx in out.groupby(["zone", "h"]).groups.items():
        out.loc[idx, "p_prev"] = prices[z].reindex(out.loc[idx, "t"] - pd.Timedelta(days=int(h))).to_numpy()
    out["d_lag_last"] = out["lag_last"] - out["level_7d"]
    out["d_prev"] = out["p_prev"] - out["level_7d"]
    out["d_lag7"] = out["lag7"] - out["level_7d"]
    out["d_lag14"] = out["lag14"] - out["level_7d"]
    return out


def lear_design(df, fuel):
    """The ridge's feature matrix (float32 frame): region_models.design + the four price-relative lags."""
    return RM.design(df, fuel).join(df[EXTRA_LAGS].astype(np.float32))


# ------------------------------------------------------------------ LEAR-365
def lear_predict(history, live, fuel, window=LEAR_WINDOW_DAYS, min_rows=LEAR_MIN_ROWS, impute=True):
    """Predict the `live` rows with one ridge per (zone, h).

    history  settled training rows (zone, h, date, y, b_lvlshape + features), already augmented
    live     rows to predict (same columns, y absent), already augmented
    For a (zone, h) group of live rows whose first target day is T, the training rows are those of the same zone and h whose target day
    lies in (T - h - window, T - h]: T - h is the day before the last known day (T - h + 1), the newest target already settled when the
    forecast is issued. Returns a Series aligned to live.index; NaN where there are too few training hours or a feature is missing -
    never a patched value. The one exception is `impute` (see IMPUTABLE): a missing hourly price lag takes the training mean. The number of
    imputed values is in the result's `.attrs["imputed"]`."""
    out = pd.Series(np.nan, index=live.index)
    out.attrs["imputed"] = 0
    if live.empty:
        return out
    Xl = lear_design(live, fuel)
    imp = [i for i, c in enumerate(Xl.columns) if c in IMPUTABLE] if impute else []
    hist = history[history["h"].isin(live["h"].unique())]
    for (z, h), g in live.groupby(["zone", "h"]):
        first = g["date"].min()
        end = first - pd.Timedelta(days=int(h))
        tr = hist[(hist["zone"] == z) & (hist["h"] == h) & (hist["date"] <= end) & (hist["date"] > end - pd.Timedelta(days=window))]
        if len(tr) < min_rows:
            continue
        Xt = lear_design(tr, fuel).to_numpy(np.float64)
        yt = (tr["y"] - tr["b_lvlshape"]).to_numpy(np.float64)
        ok = np.isfinite(Xt).all(axis=1) & np.isfinite(yt)
        if ok.sum() < min_rows:
            continue
        model = FM.ridge_fit(Xt[ok], yt[ok], np.ones(int(ok.sum())))
        Xg = Xl.loc[g.index].to_numpy(np.float64)
        if imp:
            nan = ~np.isfinite(Xg)
            fill = nan[:, imp]
            other = nan.copy()
            other[:, imp] = False
            usable = ~other.any(axis=1) & (fill.sum(axis=1) <= MAX_IMPUTED)
            for k, j in enumerate(imp):
                m = fill[:, k] & usable
                Xg[m, j] = model[0][j]
                out.attrs["imputed"] += int(m.sum())
        good = np.isfinite(Xg).all(axis=1) & g["b_lvlshape"].notna().to_numpy()
        if good.any():
            out.loc[g.index[good]] = g.loc[g.index[good], "b_lvlshape"].to_numpy() + FM.linear_predict(model, Xg[good])
    return out


# ------------------------------------------------------------------ the ensemble
MAX_FALLBACK_HOURS = 6


def point_forecast(zone, parts, fuel_ok, day_ids=None, max_fallback_hours=MAX_FALLBACK_HOURS):
    """The published central estimate of one zone from the model columns `parts` (dict name -> array/Series aligned to the zone's rows):
    lear_fuel, lgb_fuel, lear_nofuel, lgb_base. NaN wherever a needed component is NaN (the day is then dropped by the caller)...

    ... with ONE exception, for continuity: when only the ridge is missing in an hour (a gap in the price feed that imputation could not bridge) and
    `day_ids` (one id per row: the target day) is given, the LightGBM alone stands in for that hour, if at most `max_fallback_hours` hours of the same day
    need it. The API shows forecast days only without a hole after the settled days, so one lost day would hide every day after it. Each model alone was
    about as much better than level+shape as the mean at D+2 (docs/forecast-per-region.md, section 1); a day that needs it for more than a quarter of
    its hours (a zone with no ridge at all) is dropped, not published on a model the gate did not measure."""
    r = recipe_for(zone, fuel_ok)
    if r == "lgb":
        return np.asarray(parts["lgb_base"], dtype=float)
    a, b = ("lear_fuel", "lgb_fuel") if r == "ens" else ("lear_nofuel", "lgb_base")
    a, b = np.asarray(parts[a], dtype=float), np.asarray(parts[b], dtype=float)
    out = (a + b) / 2
    if day_ids is not None:
        only_tree = ~np.isfinite(a) & np.isfinite(b)
        if only_tree.any():
            n = pd.Series(only_tree).groupby(np.asarray(day_ids)).transform("sum").to_numpy()
            out = np.where(only_tree & (n <= max_fallback_hours), b, out)
    return out
