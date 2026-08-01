#!/usr/bin/env python3
"""Pooled training set for all 13 Nordic + NL bidding zones.

ONE model across every zone, with zone as a categorical feature, rather than
13 separate pipelines. Zones share almost all their structure — the same
calendar effects, the same weather physics, the same lag behaviour — so
pooling lets a quiet zone borrow strength from busy ones, and leaves a single
thing to maintain. That is the "simple" half of the brief.

The "precise" half is that pooling only works if the model can tell zones
apart on LEVEL. NO4 and NL can differ by an order of magnitude, so raw
EUR/MWh pooled blind would just learn zone means and little else. Three
features carry that: the zone id itself, `last_day_mean`, and `level_30d`
(the zone's own trailing 30-day average). The model then spends its capacity
on deviations from a level it already knows.

LEAKAGE RULES, same discipline as the Danish v3 model:
  - one row per (zone, target hour, horizon h = 2..9)
  - price lag k is populated only when k >= h-1; anything closer is not known
    at issue time
  - `level_30d` is computed over the 30 days ending at the last KNOWN day
    (target - (h-1) days), not the 30 days before the target
  - weather is the forecast as issued at lead min(h, 7), never the actual
"""
import os
import numpy as np
import pandas as pd

P = os.path.dirname(os.path.abspath(__file__))
HORIZONS = range(2, 10)
ZONES = ["dk1", "dk2", "no1", "no2", "no3", "no4", "no5",
         "se1", "se2", "se3", "se4", "fi", "nl"]
HYDRO = ["no1", "no2", "no3", "no4", "no5", "se1", "se2"]   # reservoir-driven zones
VARS = ["wind_speed_100m", "direct_radiation", "temperature_2m", "precipitation"]


def load_prices():
    df = pd.read_parquet(f"{P}/prices_all.parquet")
    df["t"] = pd.to_datetime(df["t"])
    return {z: g.set_index("t")["eur_mwh"].sort_index()
            for z, g in df.groupby("zone")}


def load_reservoir():
    """Weekly reservoir fill -> two hourly features, plus a Nordic aggregate.

    Raw MWh is not comparable across zones (SE4 holds ~0.2 TWh, NO2 ~30 TWh),
    so what goes in is the fill as a share of the zone's own maximum, and the
    deviation from that zone's median for the same week of year — "unusually
    full or empty for the season" is what actually moves water value.

    The Nordic aggregate goes to EVERY zone, including DK and NL: the market
    is coupled, so a dry Norwegian year lifts prices well beyond Norway.

    Everything is shifted 14 days, which is more conservative than ENTSO-E's
    real weekly publication lag, so no horizon can see a reading early.
    """
    path = f"{P}/reservoir_weekly.parquet"
    if not os.path.exists(path):
        return None
    r = pd.read_parquet(path)
    r["t"] = (pd.to_datetime(r.t_utc, utc=True).dt.tz_convert("Europe/Copenhagen")
                .dt.tz_localize(None) + pd.Timedelta(days=14))
    out = {}
    for z, g in r.groupby("zone"):
        g = g.sort_values("t").set_index("t")
        pct = g.mwh / g.mwh.max()
        woy = g.index.isocalendar().week.values
        med = pd.Series(pct.values, index=woy).groupby(level=0).median()
        anom = pct.values - np.array([med.get(w, np.nan) for w in woy])
        out[z] = pd.DataFrame({"reservoir_pct": pct.values,
                               "reservoir_anom": anom}, index=g.index)
    nordic = pd.concat([v["reservoir_anom"].rename(k) for k, v in out.items()],
                       axis=1).mean(axis=1).rename("nordic_reservoir_anom")
    return out, nordic


def load_weather(kind, zone):
    df = pd.read_parquet(f"{P}/w_{kind}_{zone}.parquet")
    df["t"] = pd.to_datetime(df["time"])
    return df.set_index("t").drop(columns=["time"])


def build():
    prices = load_prices()
    prev = {z: load_weather("prev", z) for z in ZONES}
    idx = prev["dk1"].index

    # Regional context, shared by every zone: the Nordic system state. Built per
    # lead so it stays consistent with the horizon being predicted.
    regional = {}
    for lead in range(1, 8):
        wind = np.nanmean([prev[z][f"wind_speed_100m_previous_day{lead}"].reindex(idx).values
                           for z in ZONES], axis=0)
        temp = np.nanmean([prev[z][f"temperature_2m_previous_day{lead}"].reindex(idx).values
                           for z in ZONES], axis=0)
        hyd = np.nanmean([prev[z][f"precipitation_previous_day{lead}"].reindex(idx).values
                          for z in HYDRO], axis=0)
        # Inflow responds to accumulated rain, not to a single hour of it.
        hyd7 = pd.Series(hyd, index=idx).rolling(24 * 7, min_periods=24).sum().values
        regional[lead] = {"reg_wind": wind, "reg_temp": temp,
                          "hydro_precip": hyd, "hydro_precip_7d": hyd7}

    res = load_reservoir()
    reservoirs, nordic_res = res if res else ({}, None)

    frames = []
    for z in ZONES:
        p = prices.get(z)
        if p is None or not len(p):
            print(f"  {z}: no prices, skipped", flush=True)
            continue
        day_mean = p.groupby(p.index.normalize()).mean()
        # trailing 30-day mean of daily means, indexed by the last day included
        lvl30 = day_mean.rolling(30, min_periods=10).mean()

        for h in HORIZONS:
            lead = min(h, 7)
            df = pd.DataFrame(index=idx)
            df["zone"] = z
            df["y"] = p.reindex(idx)
            df["h"] = h
            df["hour"] = idx.hour
            df["weekday"] = idx.weekday
            df["month"] = idx.month
            df["is_weekend"] = (idx.weekday >= 5).astype(int)
            df["doy_sin"] = np.sin(2 * np.pi * idx.dayofyear / 365.25)
            df["doy_cos"] = np.cos(2 * np.pi * idx.dayofyear / 365.25)

            for k in [1, 2, 3, 7, 14, 21, 28]:
                df[f"lag{k}"] = (p.reindex(idx - pd.Timedelta(days=k)).values
                                 if k >= h - 1 else np.nan)
            df["seasonal4w"] = df[[f"lag{k}" for k in (7, 14, 21, 28)]].mean(axis=1)
            last_known = idx.normalize() - pd.Timedelta(days=h - 1)
            df["last_day_mean"] = day_mean.reindex(last_known).values
            df["level_30d"] = lvl30.reindex(last_known).values

            w = prev[z]
            df["wind"] = w[f"wind_speed_100m_previous_day{lead}"].reindex(idx).values
            df["rad"] = w[f"direct_radiation_previous_day{lead}"].reindex(idx).values
            df["temp"] = w[f"temperature_2m_previous_day{lead}"].reindex(idx).values
            pr = w[f"precipitation_previous_day{lead}"].reindex(idx)
            df["precip"] = pr.values
            df["precip_24h"] = pr.rolling(24, min_periods=6).sum().values
            for k, v in regional[lead].items():
                df[k] = v

            # Reservoir state: own zone where it exists, Nordic aggregate always.
            # Weekly values are held until the next reading (reindex + ffill).
            rz = reservoirs.get(z)
            if rz is not None:
                rr = rz.reindex(rz.index.union(idx)).sort_index().ffill().reindex(idx)
                df["reservoir_pct"] = rr.reservoir_pct.values
                df["reservoir_anom"] = rr.reservoir_anom.values
            else:
                df["reservoir_pct"] = np.nan
                df["reservoir_anom"] = np.nan
            if nordic_res is not None:
                nr = (nordic_res.reindex(nordic_res.index.union(idx))
                      .sort_index().ffill().reindex(idx))
                df["nordic_reservoir_anom"] = nr.values
            else:
                df["nordic_reservoir_anom"] = np.nan

            frames.append(df.reset_index(names="t"))

    out = pd.concat(frames, ignore_index=True).dropna(subset=["y"])
    out["zone"] = out["zone"].astype("category")
    out.to_parquet(f"{P}/dataset_nordic.parquet", index=False)
    n_feat = len([c for c in out.columns if c not in ("t", "y")])
    print(f"saved dataset_nordic.parquet: {len(out):,} rows, {n_feat} features, "
          f"{out.zone.nunique()} zones ({out.t.min():%Y-%m-%d} -> {out.t.max():%Y-%m-%d})")
    print(out.groupby("zone", observed=True).agg(rows=("y", "size"), mean=("y", "mean")).round(1).to_string())
    return out


if __name__ == "__main__":
    build()
