#!/usr/bin/env python3
"""v3 training-set builder — adds spatial coverage and congestion signals.

Same leakage discipline as v2 (see the TIME CONVENTION note there): one row
per (area, target hour, horizon 2-9); price lag k only populated when
k >= h-1; weather taken from the previous-runs archive at lead min(h, 7).

What is new versus v2, and why:

  SPATIAL — v2 used one coordinate per area. Wind in Denmark is dominated by
  offshore farms that sit well away from any inland point, and German solar
  sits far south of German wind. v3 feeds the individual points as separate
  features (plus a mean and a spread) rather than hand-picking weights: the
  Phase 0 lesson on this project was that hand-picked constants are worse
  than fitted ones, so the model is left to learn the weighting.
  `wind_spread` (max-min across an area's points) is a genuine extra signal,
  not just noise — a large spread means a weather front is crossing the area,
  which is when production forecasts are least reliable.

  CONGESTION — two complementary signals, since JAO's own congestion figures
  are unusable here (redistribution prohibited, and only ~1 day ahead):
    1. Neighbour-zone weather (NO2/SE3/SE4/NL) at the same forecast leads.
       Congestion binds when a large price spread pushes flow past what the
       border can carry, and those spreads are driven by neighbours' weather
       — which IS available 10 days out.
    2. Month-ahead forecast transfer capacity (ENTSO-E A61/A03). This is the
       capacity side of the same coin: scheduled maintenance and derating
       that physically limit how much can flow, published a month out and so
       legitimately available at every horizon here. (A first attempt used
       A78 outage records instead; see fetch_ntc.py for why that was wrong.)
"""
import os
import numpy as np
import pandas as pd

P = os.path.dirname(os.path.abspath(__file__))
BACKUP = os.path.expanduser("~/elpriser-data-backup")
HORIZONS = range(2, 10)

POINTS = {
    "dk1_inland": (56.0, 9.5), "dk1_hornsrev": (55.5, 7.8),
    "dk1_anholt": (56.6, 11.2), "dk1_south": (55.3, 9.2),
    "dk2_zealand": (55.5, 12.0), "dk2_rodsand": (54.55, 11.7), "dk2_north": (56.0, 12.3),
    "de_north": (54.0, 9.5), "de_central": (51.5, 10.0), "de_south": (48.5, 11.0),
    "no2": (58.5, 7.0), "se3": (59.3, 17.0), "se4": (56.0, 14.0), "nl": (52.5, 5.0),
}

AREA_POINTS = {
    "DK1": ["dk1_inland", "dk1_hornsrev", "dk1_anholt", "dk1_south"],
    "DK2": ["dk2_zealand", "dk2_rodsand", "dk2_north"],
}
DE_POINTS = ["de_north", "de_central", "de_south"]
NEIGHBOURS = ["no2", "se3", "se4", "nl"]
AREA_BORDERS = {
    "DK1": ["dk1_delu", "dk1_no2", "dk1_se3", "dk1_nl"],
    "DK2": ["dk2_delu", "dk2_se4"],
}


def load_prices(area):
    old = pd.read_parquet(f"{BACKUP}/eds_elspotprices_{area.lower()}.parquet")
    old["t"] = pd.to_datetime(old["HourDK"])
    old = old[["t", "SpotPriceDKK"]].rename(columns={"SpotPriceDKK": "p"})
    new = pd.read_parquet(f"{BACKUP}/eds_dayaheadprices_{area.lower()}.parquet")
    new["t"] = pd.to_datetime(new["TimeDK"]).dt.floor("h")
    new = new.groupby("t", as_index=False)["DayAheadPriceDKK"].mean().rename(
        columns={"DayAheadPriceDKK": "p"})
    df = pd.concat([old[old.t < "2025-10-01"], new[new.t >= "2025-10-01"]])
    return df.drop_duplicates("t").sort_values("t").set_index("t")["p"]


def load_production(area):
    df = pd.read_parquet(f"{BACKUP}/eds_productionconsumptionsettlement_{area.lower()}.parquet")
    df["t"] = pd.to_datetime(df["HourDK"])
    wind = ["OffshoreWindLt100MW_MWh", "OffshoreWindGe100MW_MWh",
            "OnshoreWindLt50kW_MWh", "OnshoreWindGe50kW_MWh"]
    sol = ["SolarPowerLt10kW_MWh", "SolarPowerGe10Lt40kW_MWh",
           "SolarPowerGe40kW_MWh", "SolarPowerSelfConMWh"]
    for c in wind + sol:
        if c not in df.columns:
            df[c] = 0.0
    df["prod"] = df[wind + sol].fillna(0).sum(axis=1)
    return df.drop_duplicates("t").set_index("t")["prod"]


def w(kind, name):
    df = pd.read_parquet(f"{P}/w_{kind}_{name}.parquet")
    df["t"] = pd.to_datetime(df["time"])
    return df.set_index("t").drop(columns=["time"])


def fit_estimator(weather_actual_points, target):
    """Weather -> production, now on the multi-point mean (a better physical
    proxy than a single site). Fitting on actuals is fine: the mapping is
    static physics, and both training and inference rows feed it FORECAST
    weather, so train/serve stay consistent."""
    import lightgbm as lgb
    X = pd.concat([w("actual", n)[["wind_speed_100m", "direct_radiation"]]
                   for n in weather_actual_points]).groupby(level=0).mean()
    df = X.join(target.rename("prod"), how="inner").dropna()
    df["month"] = df.index.month
    m = lgb.LGBMRegressor(n_estimators=150, num_leaves=31, learning_rate=0.08, verbosity=-1)
    m.fit(df[["wind_speed_100m", "direct_radiation", "month"]], df["prod"])
    return m


def de_actual_production():
    dp = pd.read_parquet(f"{BACKUP}/entsoe_delu_generation_per_type.parquet")
    dp = dp[dp.psr_type.isin(["B16", "B18", "B19"])]
    dp["t"] = (pd.to_datetime(dp.datetime_utc, utc=True)
                 .dt.tz_convert("Europe/Copenhagen").dt.tz_localize(None).dt.floor("h"))
    return dp.groupby(["t", "psr_type"]).quantity_mw.mean().groupby("t").sum()


def load_capacity(area, index):
    """Month-ahead forecast transfer capacity per border and direction, scaled
    by that border's own maximum so borders of very different sizes (Germany
    ~1200 MW vs Sweden ~150 MW) are on one scale. 1.0 = full capacity.

    Month-ahead rather than week-ahead deliberately: it is published far
    enough out to be legitimately available at h = 9, whereas week-ahead
    would leak at the longest horizons. See fetch_ntc.py for why this
    replaced an earlier attempt built on A78 outage records."""
    path = f"{P}/ntc_daily.parquet"
    days = pd.Series(index.normalize(), index=index)
    cols = {}
    if not os.path.exists(path):
        for b in AREA_BORDERS[area]:
            for d in ("export", "import"):
                cols[f"ntc_{b.split('_')[1]}_{d[:3]}"] = pd.Series(1.0, index=index)
        return pd.DataFrame(cols, index=index)
    n = pd.read_parquet(path)
    n["date"] = pd.to_datetime(n["date"])
    for b in AREA_BORDERS[area]:
        for d in ("export", "import"):
            sub = n[(n.border == b) & (n.direction == d)]
            key = f"ntc_{b.split('_')[1]}_{d[:3]}"
            if not len(sub):
                cols[key] = pd.Series(np.nan, index=index)
                continue
            byday = sub.set_index("date").mw
            mx = byday.max()
            scaled = (byday / mx) if mx > 0 else byday
            cols[key] = days.map(scaled).astype(float).values
    df = pd.DataFrame(cols, index=index)
    exp = [c for c in df.columns if c.endswith("_exp")]
    imp = [c for c in df.columns if c.endswith("_imp")]
    df["ntc_exp_mean"] = df[exp].mean(axis=1)
    df["ntc_imp_mean"] = df[imp].mean(axis=1)
    df["ntc_min"] = df[exp + imp].min(axis=1)   # tightest border — congestion bites here first
    return df


def build(area):
    print(f"=== {area} ===", flush=True)
    prices = load_prices(area)
    prod = load_production(area)
    pts = AREA_POINTS[area]

    est = fit_estimator(pts, prod)
    est_de = fit_estimator(DE_POINTS, de_actual_production())
    print("  estimators fitted", flush=True)

    prev = {n: w("prev", n) for n in pts + DE_POINTS + NEIGHBOURS}
    target_hours = prev[pts[0]].index
    capacity = load_capacity(area, target_hours)

    rows = []
    for h in HORIZONS:
        lead = min(h, 7)
        df = pd.DataFrame(index=target_hours)
        df["y"] = prices.reindex(target_hours)
        df["h"] = h
        df["hour"] = df.index.hour
        df["weekday"] = df.index.weekday
        df["month"] = df.index.month
        df["doy_sin"] = np.sin(2 * np.pi * df.index.dayofyear / 365.25)
        df["doy_cos"] = np.cos(2 * np.pi * df.index.dayofyear / 365.25)
        df["is_weekend"] = (df.weekday >= 5).astype(int)

        for k in [1, 2, 3, 7, 14, 21, 28]:
            col = prices.reindex(target_hours - pd.Timedelta(days=k)).values
            df[f"lag{k}"] = col if k >= h - 1 else np.nan
        last_known_day = df.index.normalize() - pd.Timedelta(days=1) * (h - 1)
        day_mean = prices.groupby(prices.index.normalize()).mean()
        df["last_day_mean"] = day_mean.reindex(last_known_day).values
        df["seasonal4w"] = df[[f"lag{k}" for k in (7, 14, 21, 28)]].mean(axis=1)

        # own-area points, individually + aggregates
        winds, rads = [], []
        for i, n in enumerate(pts):
            pw = prev[n][f"wind_speed_100m_previous_day{lead}"].reindex(target_hours)
            pr = prev[n][f"direct_radiation_previous_day{lead}"].reindex(target_hours)
            pt_ = prev[n][f"temperature_2m_previous_day{lead}"].reindex(target_hours)
            df[f"wind_p{i}"] = pw.values
            df[f"rad_p{i}"] = pr.values
            df[f"temp_p{i}"] = pt_.values
            winds.append(pw.values); rads.append(pr.values)
        for i in range(len(pts), 4):          # pad so DK1/DK2 share a feature list
            df[f"wind_p{i}"] = np.nan; df[f"rad_p{i}"] = np.nan; df[f"temp_p{i}"] = np.nan
        W = np.vstack(winds); R = np.vstack(rads)
        df["wind"] = W.mean(axis=0)
        df["rad"] = R.mean(axis=0)
        df["wind_spread"] = W.max(axis=0) - W.min(axis=0)
        df["temp"] = df[[f"temp_p{i}" for i in range(len(pts))]].mean(axis=1)

        for i, n in enumerate(DE_POINTS):
            df[f"wind_de{i}"] = prev[n][f"wind_speed_100m_previous_day{lead}"].reindex(target_hours).values
            df[f"rad_de{i}"] = prev[n][f"direct_radiation_previous_day{lead}"].reindex(target_hours).values
        df["wind_de"] = df[[f"wind_de{i}" for i in range(3)]].mean(axis=1)
        df["rad_de"] = df[[f"rad_de{i}" for i in range(3)]].mean(axis=1)

        for n in NEIGHBOURS:
            df[f"wind_{n}"] = prev[n][f"wind_speed_100m_previous_day{lead}"].reindex(target_hours).values
            df[f"rad_{n}"] = prev[n][f"direct_radiation_previous_day{lead}"].reindex(target_hours).values

        df["est_prod"] = est.predict(pd.DataFrame({
            "wind_speed_100m": df.wind, "direct_radiation": df.rad, "month": df.month}))
        df["est_prod_de"] = est_de.predict(pd.DataFrame({
            "wind_speed_100m": df.wind_de, "direct_radiation": df.rad_de, "month": df.month}))

        for c in capacity.columns:
            df[c] = capacity[c].values

        rows.append(df.reset_index(names="t"))

    out = pd.concat(rows, ignore_index=True).dropna(subset=["y"])
    out.to_parquet(f"{P}/dataset_v3_{area.lower()}.parquet", index=False)
    print(f"  saved dataset_v3_{area.lower()}.parquet: {len(out):,} rows, "
          f"{len([c for c in out.columns if c not in ('t','y')])} features "
          f"({out.t.min():%Y-%m-%d} -> {out.t.max():%Y-%m-%d})", flush=True)
    return out


if __name__ == "__main__":
    for a in ["DK1", "DK2"]:
        build(a)
    print("DATASET DONE", flush=True)
