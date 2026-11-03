#!/usr/bin/env python3
"""PRIVATE repo. The production EU forecast (with the gas and carbon inputs) from the stored weights.

    export ENTSOE_TOKEN=...
    python3 predict_eu_fuel.py --fuel-csv fuel_daily.csv --zones de,es

`fuel_daily.csv` is YOUR file, built with fetch_fuel.py from sources you are licensed to use; this repo contains none. Offline: --prices-dir / --weather-pickle as in predict_eu.py.
"""
import argparse
import json
import os
import pickle
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import eu_infer_fuel as EF             # noqa: E402
import fuel_live as FL                 # noqa: E402
import predict_eu as PE                # noqa: E402
import fetch_weather as W              # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--fuel-csv", required=True)
    ap.add_argument("--zones")
    ap.add_argument("--weights", default=os.path.join(HERE, "weights"))
    ap.add_argument("--prices-dir")
    ap.add_argument("--weather-pickle")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    table, st = FL.load(a.fuel_csv, datetime.now(timezone.utc).date(), refresh=False, log=print)
    if table is None:
        sys.exit(f"the fuel table is not usable: {st['reason']}")
    if a.prices_dir:
        prices = PE.prices_from_dir(a.prices_dir)
    else:
        if not os.environ.get("ENTSOE_TOKEN"):
            sys.exit("set ENTSOE_TOKEN or use --prices-dir")
        prices = PE.prices_from_entsoe()
    if a.weather_pickle:
        with open(a.weather_pickle, "rb") as f:
            live = pickle.load(f)
    else:
        live = W.live()
    res = EF.forecast_fuel(prices, live, table, a.weights, zones=a.zones.split(",") if a.zones else None)
    for z, pl in res.items():
        print(f"\n{z}  ({pl['recipe']}, fuel {pl['fuel']}, weights trained through {pl['trainedThrough']})")
        for d in pl["days"]:
            p = [x["eur_mwh"] for x in d["prices"]]
            print(f"  {d['date']}  D+{d['horizon']}  mean {sum(p)/24:7.1f}  min {min(p):7.1f}  max {max(p):7.1f} EUR/MWh")
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(res, f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
