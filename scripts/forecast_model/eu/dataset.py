#!/usr/bin/env python3
"""Pooled training set for the EU zones: one row per (zone, target hour, horizon h = 2..8).

The rows come from features.make_features, the same function the live scoring uses. Weather is the previous-runs
forecast as issued at lead min(h, 7); the EU-wide regional weather is built in UTC (zones sit on different clocks) and
only then moved to each zone's clock.
"""
import os
import sys

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import features as F                      # noqa: E402
import fetch_weather as W                 # noqa: E402
from zones import ZONES                   # noqa: E402


def load_prices(out_dir=DIR, zones=None):
    out = {}
    for z in zones or ZONES:
        path = os.path.join(out_dir, f"price_{z}.parquet")
        if not os.path.exists(path):
            print(f"  {z}: no price file, skipped", flush=True)
            continue
        df = pd.read_parquet(path)
        s = df.set_index(pd.to_datetime(df["t"]))["eur_mwh"].sort_index()
        out[z] = s[~s.index.duplicated(keep="last")]
    return out


def load_weather(zones, out_dir=DIR):
    """{zone: previous-runs frame on a UTC index (columns RAW_VARS_previous_dayN)}. A zone whose weather has not been
    fetched yet is absent (the caller then builds price-only rows for it)."""
    out = {}
    for z in zones:
        if all(os.path.exists(W.path(z, i, out_dir)) for i in range(len(ZONES[z][2]))):
            out[z] = W.load_zone(z, len(ZONES[z][2]), out_dir)
    return out


def build(out_dir=DIR, zones=None, save=True):
    prices = load_prices(out_dir, zones)
    zs = list(prices)
    prev = load_weather(zs, out_dir)
    days, eu = F.day_table(prices)

    # regional means per lead, in UTC (only from the zones whose weather exists)
    reg = {}
    if prev:
        for lead in range(2, 8):
            reg[lead] = F.regional({z: F.lead_columns(prev[z], lead) for z in prev})

    frames = []
    for z in zs:
        tz = ZONES[z][1]
        p = prices[z]
        if z in prev:
            wx_lead = {lead: F.to_local(F.lead_columns(prev[z], lead), tz) for lead in range(2, 8)}
            reg_lead = {lead: F.to_local(reg[lead], tz) for lead in range(2, 8)}
            # target hours: everything the zone has weather for AND a price at
            idx = wx_lead[2].dropna(subset=["wind"]).index.intersection(p.index)
        else:
            # price-only rows (weather not fetched): the weather columns are NaN. Used for the "no weather" ablation.
            nan = pd.DataFrame(np.nan, index=p.index, columns=F.WX)
            nan_r = pd.DataFrame(np.nan, index=p.index, columns=["reg_wind", "reg_rad", "reg_temp"])
            wx_lead = {lead: nan for lead in range(2, 8)}
            reg_lead = {lead: nan_r for lead in range(2, 8)}
            idx = p.index[p.index >= pd.Timestamp("2024-03-15")]
        for h in F.HORIZONS:
            lead = min(h, 7)
            df = F.make_features(z, idx, h, p, wx_lead[lead], reg_lead[lead], days[z], eu)
            df["y"] = p.reindex(idx).values
            frames.append(df.reset_index(names="t"))
        print(f"  {z}: {len(idx):,} target hours{'' if z in prev else ' (no weather)'}", flush=True)
    out = pd.concat(frames, ignore_index=True).dropna(subset=["y"])
    out["zone"] = pd.Categorical(out["zone"], categories=list(ZONES))
    if save:
        out.to_parquet(os.path.join(out_dir, "dataset_eu.parquet"), index=False)
    print(f"dataset: {len(out):,} rows, {out.zone.nunique()} zones, {out.t.min():%Y-%m-%d} -> {out.t.max():%Y-%m-%d}",
          flush=True)
    return out


if __name__ == "__main__":
    build()
