#!/usr/bin/env python3
"""Add the leak-free fuel features (fuel_features.py) to a training set of (zone, t, h) rows - the EU one or the Nordic one -
and write it next to the original. Nothing else in the rows changes, so a backtest on the new file differs from the old one
ONLY by the fuel columns.

    python3 fuel_dataset.py --in dataset_eu.parquet --out dataset_eu_fuel.parquet [--fuel fuel_daily.csv]
    python3 fuel_dataset.py --in ../nordic/dataset_nordic.parquet --out dataset_nordic_fuel.parquet

`mc_gap` = the gas-plant marginal cost minus the zone's recent price level (level_7d where the set has it, else level_30d): how far
the fuel market says the price should be from where it has been. It is the one feature that lets a model see "the level is about
to catch up with gas" directly.
"""
import argparse
import os
import sys

import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import fetch_fuel as FF          # noqa: E402
import fuel_features as FUEL     # noqa: E402


def add_fuel(df, fuel):
    """df with t and h (and zone) -> df with the fuel columns, date and mc_gap."""
    df = df.copy()
    df["t"] = pd.to_datetime(df["t"])
    df["date"] = df["t"].dt.normalize()
    table = FUEL.daily_table(fuel)
    out = FUEL.add_to_frame(df, table)
    lvl = "level_7d" if "level_7d" in out else "level_30d"
    out["mc_gap"] = out["ccgt_mc"] - out[lvl]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", default=os.path.join(DIR, "dataset_eu.parquet"))
    ap.add_argument("--out", default=os.path.join(DIR, "dataset_eu_fuel.parquet"))
    ap.add_argument("--fuel", default=os.path.join(DIR, "fuel_daily.csv"))
    a = ap.parse_args()
    df = pd.read_parquet(a.inp)
    out = add_fuel(df, FF.load(a.fuel))
    out.to_parquet(a.out, index=False)
    miss = out[FUEL.BASE[:-1] + ["mc_gap"]].isna().mean().round(4).to_dict()
    print(f"{a.out}: {len(out):,} rows; share of rows without a fuel value: {miss}")


if __name__ == "__main__":
    main()
