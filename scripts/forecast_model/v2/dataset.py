#!/usr/bin/env python3
"""Bygger træningsdatasæt til prognosemodel v2 (time-horisonten, T+2..T+9).

TIDSKONVENTION (den leakage-kritiske del):
  - "Udgivelsesdag" D = dagen modellen kører (14:00 UTC, efter day-ahead-
    auktionen). På det tidspunkt kendes spotpriser til og med D+1.
  - Modellen forudsiger måldage D+2..D+9, dvs. horisont h = 2..9
    (h = måldag − D).
  - For en måldag T med horisont h gælder:
      * seneste kendte prisdag = T − (h−1)
      * lag k (samme time, k dage tilbage) er KUN kendt hvis k >= h−1
      * vejret kendes som prognose med lead ≈ h−? : previous_dayN-arkivet
        er indekseret efter "N døgn før leveringstimen". Kørslen kl. ~15
        dansk tid på dag D ser for måldag D+h en prognose der er ca. h døgn
        gammel ved midt på måldagen → vi bruger previous_day{min(h,7)}.
        Det er konservativt (den operationelle kørsel har adgang til en
        friskere run end backtestens), så backtest-tallene er et gulv.

Én række pr. (område, måldag, time, horisont). Samme måltime optræder altså
op til 8 gange med forskellige feature-øjebliksbilleder — præcis som den
opererende model ser verden.
"""
import os
import numpy as np
import pandas as pd

P = os.path.dirname(os.path.abspath(__file__))
BACKUP = os.path.expanduser("~/elpriser-data-backup")
HORIZONS = range(2, 10)


def load_prices(area):
    """Samlet timeserie DKK/MWh: elspot (→2025-09-30) + dayahead (2025-10-01→)."""
    old = pd.read_parquet(f"{BACKUP}/eds_elspotprices_{area.lower()}.parquet")
    old["t"] = pd.to_datetime(old["HourDK"])
    old = old[["t", "SpotPriceDKK"]].rename(columns={"SpotPriceDKK": "p"})
    new = pd.read_parquet(f"{BACKUP}/eds_dayaheadprices_{area.lower()}.parquet")
    new["t"] = pd.to_datetime(new["TimeDK"]).dt.floor("h")
    new = new.groupby("t", as_index=False)["DayAheadPriceDKK"].mean().rename(columns={"DayAheadPriceDKK": "p"})
    df = pd.concat([old[old.t < "2025-10-01"], new[new.t >= "2025-10-01"]])
    return df.drop_duplicates("t").sort_values("t").set_index("t")["p"]


def load_weather(name):
    """{ 'actual': df, 'prev': df } med DatetimeIndex (dansk tid)."""
    actual = pd.read_parquet(f"{P}/weather_actual_{name}.parquet")
    actual["t"] = pd.to_datetime(actual["time"])
    prev = pd.read_parquet(f"{P}/weather_prev_{name}.parquet")
    prev["t"] = pd.to_datetime(prev["time"])
    return actual.set_index("t").drop(columns=["time"]), prev.set_index("t").drop(columns=["time"])


def load_production(area):
    """Faktisk vind+sol-produktion MWh pr. time (til estimator-fit)."""
    df = pd.read_parquet(f"{BACKUP}/eds_productionconsumptionsettlement_{area.lower()}.parquet")
    df["t"] = pd.to_datetime(df["HourDK"])
    wind_cols = ["OffshoreWindLt100MW_MWh", "OffshoreWindGe100MW_MWh",
                 "OnshoreWindLt50kW_MWh", "OnshoreWindGe50kW_MWh"]
    sol_cols = ["SolarPowerLt10kW_MWh", "SolarPowerGe10Lt40kW_MWh",
                "SolarPowerGe40kW_MWh", "SolarPowerSelfConMWh"]
    for c in wind_cols + sol_cols:
        if c not in df.columns:
            df[c] = 0.0
    df["prod"] = df[wind_cols + sol_cols].fillna(0).sum(axis=1)
    return df.drop_duplicates("t").set_index("t")["prod"]


def fit_production_estimator(weather_actual, production):
    """prod ~ vind + sol + måned. Statisk fysisk mapping — fit på facit er ok,
    for både trænings- og inferensrækker får den PROGNOSE-vejr som input."""
    import lightgbm as lgb
    df = weather_actual.join(production.rename("prod"), how="inner").dropna()
    df["month"] = df.index.month
    m = lgb.LGBMRegressor(n_estimators=150, num_leaves=31, learning_rate=0.08, verbosity=-1)
    m.fit(df[["wind_speed_100m", "direct_radiation", "month"]], df["prod"])
    return m


def estimate_production(est, wind, radiation, month):
    X = pd.DataFrame({"wind_speed_100m": wind, "direct_radiation": radiation, "month": month})
    ok = X.notna().all(axis=1)
    out = np.full(len(X), np.nan)
    if ok.any():
        out[ok.values] = est.predict(X[ok])
    return out


def fit_de_estimator():
    """Tysk vind+sol-estimator fra lokal ENTSO-E-backup (B16 sol, B18/B19 vind;
    15-min UTC → time, dansk tid). Statisk fysisk mapping ligesom DK-estimatoren."""
    import lightgbm as lgb
    wa_de = pd.read_parquet(f"{P}/weather_actual_de.parquet")
    wa_de["t"] = pd.to_datetime(wa_de["time"]); wa_de = wa_de.set_index("t").drop(columns=["time"])
    dp = pd.read_parquet(f"{BACKUP}/entsoe_delu_generation_per_type.parquet")
    dp = dp[dp.psr_type.isin(["B16", "B18", "B19"])]
    dp["t"] = (pd.to_datetime(dp.datetime_utc, utc=True)
                 .dt.tz_convert("Europe/Copenhagen").dt.tz_localize(None).dt.floor("h"))
    de_ws = dp.groupby(["t", "psr_type"]).quantity_mw.mean().groupby("t").sum()
    j = wa_de.join(de_ws.rename("prod"), how="inner").dropna()
    j["month"] = j.index.month
    est_de = lgb.LGBMRegressor(n_estimators=150, num_leaves=31, learning_rate=0.08, verbosity=-1)
    est_de.fit(j[["wind_speed_100m", "direct_radiation", "month"]], j["prod"])
    print(f"  DE-estimator fit på {len(j):,} timer")
    return est_de


def build(area):
    print(f"=== {area} ===")
    prices = load_prices(area)
    prod = load_production(area)
    wa, wp = load_weather(area.lower())
    wa_de, wp_de = load_weather("de")
    est_de = fit_de_estimator()

    est = fit_production_estimator(wa, prod)
    print(f"  DK-estimator fit")

    # målrækker: alle timer hvor previous-runs-arkivet dækker
    target_hours = wp.index
    price_by_t = prices

    rows = []
    for h in HORIZONS:
        lead = min(h, 7)
        w_wind = wp[f"wind_speed_100m_previous_day{lead}"]
        w_rad = wp[f"direct_radiation_previous_day{lead}"]
        de_wind = wp_de[f"wind_speed_100m_previous_day{lead}"]
        de_rad = wp_de[f"direct_radiation_previous_day{lead}"]

        df = pd.DataFrame(index=target_hours)
        df["y"] = price_by_t.reindex(target_hours)
        df["h"] = h
        df["hour"] = df.index.hour
        df["weekday"] = df.index.weekday
        df["month"] = df.index.month
        df["doy_sin"] = np.sin(2 * np.pi * df.index.dayofyear / 365.25)
        df["doy_cos"] = np.cos(2 * np.pi * df.index.dayofyear / 365.25)
        df["is_weekend"] = (df.weekday >= 5).astype(int)

        # prislags — kun dem der er kendte ved horisont h (k >= h-1).
        # NB: k < h-1 ville være LEAKAGE.
        for k in [1, 2, 3, 7, 14, 21, 28]:
            col = price_by_t.reindex(target_hours - pd.Timedelta(days=k)).values
            df[f"lag{k}"] = col if k >= h - 1 else np.nan
        # seneste kendte døgns-gennemsnit (dag T-(h-1)) — altid kendt
        last_known_day = pd.Series(df.index.normalize() - pd.Timedelta(days=1) * (h - 1), index=df.index)
        day_mean = price_by_t.groupby(price_by_t.index.normalize()).mean()
        df["last_day_mean"] = day_mean.reindex(last_known_day.values).values
        # 4-ugers sæsonprofil af kendte lags
        df["seasonal4w"] = df[[f"lag{k}" for k in (7, 14, 21, 28)]].mean(axis=1)

        # råt vejr ved korrekt lead — lader modellen lære vejr→pris direkte
        df["wind"] = w_wind.reindex(target_hours).values
        df["rad"] = w_rad.reindex(target_hours).values
        df["wind_de"] = de_wind.reindex(target_hours).values
        df["rad_de"] = de_rad.reindex(target_hours).values
        # temperatur (efterspørgsel) hvis cachen findes
        tp = f"{P}/temp_prev_{area.lower()}.parquet"
        if os.path.exists(tp):
            tprev = pd.read_parquet(tp)
            tprev["t"] = pd.to_datetime(tprev["time"])
            tprev = tprev.set_index("t")
            df["temp"] = tprev[f"temperature_2m_previous_day{lead}"].reindex(target_hours).values
        else:
            df["temp"] = np.nan

        # vejrafledt produktion ved korrekt lead
        df["est_prod"] = estimate_production(est, w_wind.reindex(target_hours).values,
                                             w_rad.reindex(target_hours).values, df.month.values)
        df["est_prod_de"] = estimate_production(est_de, de_wind.reindex(target_hours).values,
                                                de_rad.reindex(target_hours).values, df.month.values)
        # samme features fra FAKTISK vejr — bruges kun til at simulere Phase 1's
        # træn-på-facit/forudsig-på-prognose-mismatch som baseline, aldrig i v2
        df["est_prod_act"] = estimate_production(est, wa["wind_speed_100m"].reindex(target_hours).values,
                                                 wa["direct_radiation"].reindex(target_hours).values, df.month.values)
        df["est_prod_de_act"] = estimate_production(est_de, wa_de["wind_speed_100m"].reindex(target_hours).values,
                                                    wa_de["direct_radiation"].reindex(target_hours).values, df.month.values)
        rows.append(df.reset_index(names="t"))

    out = pd.concat(rows, ignore_index=True)
    out = out.dropna(subset=["y"])
    out.to_parquet(f"{P}/dataset_{area.lower()}.parquet", index=False)
    print(f"  gemt dataset_{area.lower()}.parquet: {len(out):,} rækker "
          f"({out.t.min():%Y-%m-%d} → {out.t.max():%Y-%m-%d})")
    return out


if __name__ == "__main__":
    for area in ["DK1", "DK2"]:
        build(area)
