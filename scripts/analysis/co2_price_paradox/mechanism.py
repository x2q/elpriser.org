#!/usr/bin/env python3
"""Third pass: test the mechanism the exchange data suggests.

The hourly profile shows Norwegian imports peaking at exactly the hours when
prices peak (1,027 MWh at 20:00, when price is highest) and collapsing at
midday (15 MWh at 13:00, when price is lowest). That points at a specific
causal story rather than a coincidence:

  Norwegian hydro is dispatched against WATER VALUE. When the price is high,
  releasing water is worth more than storing it, so Norway exports. When the
  price collapses, the water is worth more kept in the reservoir, so Norway
  holds back — and Denmark leans on German thermal instead.

If that is right, the high evening price is not merely correlated with clean
power; it is part of what CALLS the clean power in. This tests it directly.
"""
import os
import numpy as np
import pandas as pd

BACKUP = os.path.expanduser("~/elpriser-data-backup")


def main():
    pc = pd.read_parquet(f"{BACKUP}/eds_productionconsumptionsettlement_dk1.parquet")
    pc["t"] = pd.to_datetime(pc.HourDK); pc = pc.drop_duplicates("t").set_index("t")
    co2 = pd.read_parquet(f"{BACKUP}/eds_co2emis_dk1.parquet")
    co2["t"] = pd.to_datetime(co2.TimeDK); co2 = co2.set_index("t")["CO2Emission_g_per_kWh"]
    pr = pd.read_parquet(f"{BACKUP}/eds_dayaheadprices_dk1.parquet")
    pr["t"] = pd.to_datetime(pr.TimeDK).dt.floor("h"); pr = pr.groupby("t").DayAheadPriceDKK.mean()
    old = pd.read_parquet(f"{BACKUP}/eds_elspotprices_dk1.parquet")
    old["t"] = pd.to_datetime(old.HourDK); old = old.set_index("t").SpotPriceDKK
    price = pd.concat([old[old.index < "2025-10-01"], pr[pr.index >= "2025-10-01"]])
    price = price[~price.index.duplicated()]

    d = pd.DataFrame({
        "co2": co2, "price": price / 10,
        "no_imp": pc.ExchangeNO_MWh.fillna(0), "de_imp": pc.ExchangeGE_MWh.fillna(0),
    }).dropna()
    d = d[d.index >= "2024-01-01"]
    d["hour"] = d.index.hour

    print("TEST 1 — følger norsk import prisen? (time for time, alle timer)")
    print(f"  korrelation norsk import vs DK-pris : {d.no_imp.corr(d.price):+.2f}")
    print(f"  korrelation tysk udveksling vs pris : {d.de_imp.corr(d.price):+.2f}")

    print("\nTEST 2 — norsk import fordelt på prisniveau (deciler)")
    d["dec"] = pd.qcut(d.price, 10, labels=False, duplicates="drop")
    g = d.groupby("dec").agg(pris=("price", "mean"), norsk_import=("no_imp", "mean"),
                             tysk=("de_imp", "mean"), co2=("co2", "mean"))
    print(f"{'decil':>6} {'pris øre':>9} {'NO-import':>10} {'DE-udveksl':>11} {'CO2 g':>7}")
    for i, r in g.iterrows():
        print(f"{int(i)+1:>6} {r.pris:9.1f} {r.norsk_import:10.0f} {r.tysk:11.0f} {r.co2:7.0f}")

    print("\nTEST 3 — samme time på dyre vs billige døgn (kontrollerer for tid på døgnet)")
    print(f"{'time':>5} {'billige døgn: NO-imp':>22} {'dyre døgn: NO-imp':>20} {'forskel':>9}")
    d["date"] = d.index.normalize()
    daily = d.groupby("date").price.mean()
    lo, hi = daily.quantile(0.25), daily.quantile(0.75)
    cheap = d[d.date.map(daily) <= lo]; exp = d[d.date.map(daily) >= hi]
    for hh in (2, 8, 13, 17, 20, 22):
        c = cheap[cheap.hour == hh].no_imp.mean(); e = exp[exp.hour == hh].no_imp.mean()
        print(f"{hh:>5} {c:22.0f} {e:20.0f} {e-c:+9.0f}")

    print("\nTEST 4 — hvor tit er aftentimen (19-21) grønnere end middagstimen samme døgn?")
    ev = d[d.hour.between(19, 21)].groupby("date").co2.mean()
    mid = d[d.hour.between(12, 14)].groupby("date").co2.mean()
    both = pd.DataFrame({"ev": ev, "mid": mid}).dropna()
    print(f"  aften grønnere end middag: {(both.ev < both.mid).mean()*100:.0f} % af døgn")
    print(f"  gennemsnitlig forskel:     {(both.mid - both.ev).mean():+.0f} g/kWh")
    evp = d[d.hour.between(19, 21)].groupby("date").price.mean()
    midp = d[d.hour.between(12, 14)].groupby("date").price.mean()
    bp = pd.DataFrame({"ev": evp, "mid": midp}).dropna()
    print(f"  aften dyrere end middag:   {(bp.ev > bp.mid).mean()*100:.0f} % af døgn")
    print(f"  gennemsnitlig forskel:     {(bp.ev - bp.mid).mean():+.1f} øre/kWh")


if __name__ == "__main__":
    main()
