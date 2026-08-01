#!/usr/bin/env python3
"""Why is 20:00 both the greenest and the most expensive hour?

Tests four candidate explanations against real data rather than assuming:
  H1  CO2 falls in the evening because wind's SHARE of production rises
  H2  Price rises because Danish demand peaks
  H3  Price rises because the German/European price peaks and DK is coupled
  H4  Denmark EXPORTS at that hour — selling clean power into an expensive market

The key structural point to verify: price is set by the MARGINAL unit and by
the coupled European market, while the published CO2 figure is an AVERAGE over
everything consumed. Those two numbers answer different questions, so nothing
stops them moving in opposite directions.
"""
import os
import numpy as np
import pandas as pd

BACKUP = os.path.expanduser("~/elpriser-data-backup")
OUT = os.path.dirname(os.path.abspath(__file__))
AREA = "dk1"


def load():
    co2 = pd.read_parquet(f"{BACKUP}/eds_co2emis_{AREA}.parquet")
    co2["t"] = pd.to_datetime(co2.TimeDK)
    co2 = co2.set_index("t")["CO2Emission_g_per_kWh"]

    pr = pd.read_parquet(f"{BACKUP}/eds_dayaheadprices_{AREA}.parquet")
    pr["t"] = pd.to_datetime(pr.TimeDK).dt.floor("h")
    pr = pr.groupby("t").DayAheadPriceDKK.mean()
    old = pd.read_parquet(f"{BACKUP}/eds_elspotprices_{AREA}.parquet")
    old["t"] = pd.to_datetime(old.HourDK)
    old = old.set_index("t").SpotPriceDKK
    price = pd.concat([old[old.index < "2025-10-01"], pr[pr.index >= "2025-10-01"]])
    price = price[~price.index.duplicated()]

    pc = pd.read_parquet(f"{BACKUP}/eds_productionconsumptionsettlement_{AREA}.parquet")
    pc["t"] = pd.to_datetime(pc.HourDK)
    pc = pc.drop_duplicates("t").set_index("t")
    wind = pc[["OffshoreWindLt100MW_MWh", "OffshoreWindGe100MW_MWh",
               "OnshoreWindLt50kW_MWh", "OnshoreWindGe50kW_MWh"]].fillna(0).sum(axis=1)
    solar = pc[["SolarPowerLt10kW_MWh", "SolarPowerGe10Lt40kW_MWh",
                "SolarPowerGe40kW_MWh", "SolarPowerSelfConMWh"]].fillna(0).sum(axis=1)
    thermal = pc[["CentralPowerMWh", "LocalPowerMWh"]].fillna(0).sum(axis=1)
    demand = pc["GrossConsumptionMWh"].fillna(0)
    # Exchange columns are positive when importing into DK
    exch = pc[["ExchangeNO_MWh", "ExchangeSE_MWh", "ExchangeGE_MWh",
               "ExchangeNL_MWh", "ExchangeGB_MWh", "ExchangeGreatBelt_MWh"]].fillna(0).sum(axis=1)

    de = pd.read_parquet(f"{BACKUP}/entsoe_delu_dayahead_prices.parquet")
    de["t"] = (pd.to_datetime(de.datetime_utc, utc=True)
                 .dt.tz_convert("Europe/Copenhagen").dt.tz_localize(None).dt.floor("h"))
    de = de.groupby("t").price_eur_mwh.mean()

    df = pd.DataFrame({"co2": co2, "price": price, "wind": wind, "solar": solar,
                       "thermal": thermal, "demand": demand, "net_import": exch,
                       "de_price": de}).dropna(subset=["co2", "price"])
    return df[df.index >= "2024-01-01"]


def main():
    df = load()
    df["hour"] = df.index.hour
    df["renew_share"] = (df.wind + df.solar) / df.demand.clip(lower=1) * 100
    df["wind_share"] = df.wind / df.demand.clip(lower=1) * 100
    df["solar_share"] = df.solar / df.demand.clip(lower=1) * 100
    df["thermal_share"] = df.thermal / df.demand.clip(lower=1) * 100
    df["price_ore"] = df.price / 10          # DKK/MWh -> øre/kWh
    df["de_price_ore"] = df.de_price * 7.46 / 10

    h = df.groupby("hour").agg(
        co2=("co2", "mean"), price=("price_ore", "mean"),
        wind_share=("wind_share", "mean"), solar_share=("solar_share", "mean"),
        thermal_share=("thermal_share", "mean"), demand=("demand", "mean"),
        net_import=("net_import", "mean"), de_price=("de_price_ore", "mean"))

    print(f"DØGNPROFIL {AREA.upper()} — gennemsnit 2024-01 → nu ({len(df):,} timer)\n")
    print(f"{'time':>4} {'CO2 g':>7} {'pris øre':>9} {'vind %':>7} {'sol %':>6} "
          f"{'termisk %':>10} {'forbrug MW':>11} {'nettoimport':>12} {'DE-pris':>8}")
    for hh, r in h.iterrows():
        mark = "  <- grønnest" if r.co2 == h.co2.min() else ("  <- dyrest" if r.price == h.price.max() else "")
        print(f"{hh:>4} {r.co2:7.0f} {r.price:9.1f} {r.wind_share:7.1f} {r.solar_share:6.1f} "
              f"{r.thermal_share:10.1f} {r.demand:11.0f} {r.net_import:12.0f} {r.de_price:8.1f}{mark}")

    print(f"\ngrønneste time: {h.co2.idxmin():02d}  ({h.co2.min():.0f} g)")
    print(f"dyreste time:   {h.price.idxmax():02d}  ({h.price.max():.1f} øre)")
    print(f"korrelation CO2 vs pris over døgnet: {h.co2.corr(h.price):+.2f}")
    print(f"korrelation DK-pris vs DE-pris (time for time): {df.price_ore.corr(df.de_price_ore):+.2f}")
    print(f"korrelation CO2 vs vindandel:                   {h.co2.corr(h.wind_share):+.2f}")
    print(f"korrelation pris vs forbrug:                    {h.price.corr(h.demand):+.2f}")
    print(f"korrelation pris vs termisk andel:              {h.price.corr(h.thermal_share):+.2f}")

    h.to_csv(f"{OUT}/hourly_profile.csv")

    # How often are the greenest and the most expensive hour the same day-hour?
    d = df.copy(); d["date"] = d.index.normalize()
    g = d.groupby("date")
    both = pd.DataFrame({"green": g.co2.idxmin(), "exp": g.price_ore.idxmax()}).dropna()
    both["gh"] = [x.hour for x in both.green]; both["eh"] = [x.hour for x in both.exp]
    same = (both.gh == both.eh).mean() * 100
    near = (abs(both.gh - both.eh) <= 2).mean() * 100
    print(f"\ndøgn hvor grønneste OG dyreste time er samme time:      {same:.1f} %")
    print(f"døgn hvor de ligger inden for 2 timer af hinanden:      {near:.1f} %")
    print(f"grønneste time falder oftest kl.: {both.gh.mode().iloc[0]:02d} "
          f"({(both.gh==both.gh.mode().iloc[0]).mean()*100:.0f} % af døgn)")
    print(f"dyreste time falder oftest kl.:   {both.eh.mode().iloc[0]:02d} "
          f"({(both.eh==both.eh.mode().iloc[0]).mean()*100:.0f} % af døgn)")

    # Evenings specifically: is DK exporting while prices are high?
    ev = df[df.hour.between(19, 21)]
    print(f"\naftentimer 19-21: nettoimport {ev.net_import.mean():+.0f} MWh/t "
          f"(negativ = eksport) | eksporterer i {(ev.net_import<0).mean()*100:.0f} % af timerne")


if __name__ == "__main__":
    main()
