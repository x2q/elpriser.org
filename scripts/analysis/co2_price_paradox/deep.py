#!/usr/bin/env python3
"""Second pass: the first analysis raised a puzzle it did not explain.

Midday has MORE renewables than the evening (77% vs 66% of demand) yet HIGHER
CO2 (114 g vs 86 g). If the published figure simply tracked domestic renewable
share, that could not happen. So what is it actually measuring?

Candidate: Energinet's figure is the intensity of electricity CONSUMED, which
means imports carry their origin's intensity. Midday and evening may import
from different neighbours — Norwegian hydro is near-zero, German thermal is
not. This checks the exchange composition hour by hour.
"""
import os
import numpy as np
import pandas as pd

BACKUP = os.path.expanduser("~/elpriser-data-backup")
OUT = os.path.dirname(os.path.abspath(__file__))


def main():
    pc = pd.read_parquet(f"{BACKUP}/eds_productionconsumptionsettlement_dk1.parquet")
    pc["t"] = pd.to_datetime(pc.HourDK)
    pc = pc.drop_duplicates("t").set_index("t")
    pc = pc[pc.index >= "2024-01-01"]

    co2 = pd.read_parquet(f"{BACKUP}/eds_co2emis_dk1.parquet")
    co2["t"] = pd.to_datetime(co2.TimeDK)
    co2 = co2.set_index("t")["CO2Emission_g_per_kWh"]

    d = pd.DataFrame(index=pc.index)
    d["hour"] = d.index.hour
    d["co2"] = co2.reindex(pc.index)
    # Positive = import into DK1
    for k, col in (("NO", "ExchangeNO_MWh"), ("SE", "ExchangeSE_MWh"),
                   ("DE", "ExchangeGE_MWh"), ("NL", "ExchangeNL_MWh"),
                   ("GB", "ExchangeGB_MWh"), ("DK2", "ExchangeGreatBelt_MWh")):
        d[k] = pc[col].fillna(0)
    d["demand"] = pc.GrossConsumptionMWh.fillna(0)
    wind = pc[["OffshoreWindLt100MW_MWh", "OffshoreWindGe100MW_MWh",
               "OnshoreWindLt50kW_MWh", "OnshoreWindGe50kW_MWh"]].fillna(0).sum(axis=1)
    solar = pc[["SolarPowerLt10kW_MWh", "SolarPowerGe10Lt40kW_MWh",
                "SolarPowerGe40kW_MWh", "SolarPowerSelfConMWh"]].fillna(0).sum(axis=1)
    d["wind"], d["solar"] = wind, solar
    d["thermal"] = pc[["CentralPowerMWh", "LocalPowerMWh"]].fillna(0).sum(axis=1)
    d = d.dropna(subset=["co2"])

    h = d.groupby("hour").mean(numeric_only=True)
    print("UDVEKSLING PR. NABO, MWh/time (positiv = import TIL DK1)\n")
    print(f"{'time':>4} {'CO2':>5} {'NO':>7} {'SE':>7} {'DE':>7} {'NL':>7} {'GB':>7} "
          f"{'DK2':>7} {'netto':>7} {'termisk':>8}")
    for hh, r in h.iterrows():
        net = r.NO + r.SE + r.DE + r.NL + r.GB + r.DK2
        print(f"{hh:>4} {r.co2:5.0f} {r.NO:7.0f} {r.SE:7.0f} {r.DE:7.0f} {r.NL:7.0f} "
              f"{r.GB:7.0f} {r.DK2:7.0f} {net:7.0f} {r.thermal:8.0f}")

    print("\nKORRELATIONER over døgnprofilen (24 punkter):")
    h["net"] = h.NO + h.SE + h.DE + h.NL + h.GB + h.DK2
    h["fossil_import"] = h.DE + h.NL + h.GB          # overvejende termiske naboer
    h["hydro_import"] = h.NO + h.SE                   # vand/kerne-tunge naboer
    h["renew_share"] = (h.wind + h.solar) / h.demand * 100
    for name, col in [("vindandel", None), ("vedvarende andel", "renew_share"),
                      ("termisk produktion", "thermal"), ("import fra DE+NL+GB", "fossil_import"),
                      ("import fra NO+SE", "hydro_import"), ("nettoimport", "net"),
                      ("forbrug", "demand")]:
        if col is None:
            v = (h.wind / h.demand * 100)
        else:
            v = h[col]
        print(f"  CO2 vs {name:22} {h.co2.corr(v):+.2f}")

    # Direct test: does CO2 track the fossil-heavy import share?
    d["fossil_imp"] = (d.DE + d.NL + d.GB).clip(lower=0)
    d["hydro_imp"] = (d.NO + d.SE).clip(lower=0)
    d["wind_share"] = d.wind / d.demand.clip(lower=1) * 100
    print("\nKORRELATIONER time for time (alle 22.500 timer):")
    for name, col in [("vindandel", "wind_share"), ("termisk produktion", "thermal"),
                      ("import fra DE/NL/GB", "fossil_imp"), ("import fra NO/SE", "hydro_imp")]:
        print(f"  CO2 vs {name:22} {d.co2.corr(d[col]):+.2f}")

    h.to_csv(f"{OUT}/exchange_profile.csv")


if __name__ == "__main__":
    main()
