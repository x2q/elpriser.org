#!/usr/bin/env python3
"""Check that a staged/downloaded copy of the PRIVATE fuel repo reproduces the production recipe's numbers.

    python3 verify_eu_fuel.py --pkg ~/hf-verify/eu-price-forecast-fuel --ref ~/hf-publish/out/eufuel/ref

--ref is export_eu.py --with-fuel --reference (frozen prices, weather and fuel table, and the production central estimate and quantile edges, all local to the Spark).
Exit 0 only if the central estimate, the P10 and the P90 model agree to 1e-6 EUR/MWh and forecast_fuel() produces banded payloads.
"""
import argparse
import os
import pickle
import sys
from datetime import datetime

import numpy as np


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pkg", required=True)
    ap.add_argument("--ref", required=True)
    a = ap.parse_args(argv)
    sys.path.insert(0, os.path.abspath(a.pkg))
    import eu_infer as EI
    import eu_infer_fuel as EF
    import recipe as RC
    from zones import ZONES
    assert os.path.abspath(a.pkg) in os.path.abspath(EF.__file__), "eu_infer_fuel was not imported from --pkg"
    ld = lambda n: pickle.load(open(os.path.join(a.ref, n), "rb"))
    prices, live, table = ld("prices.pkl"), ld("live.pkl"), ld("fuel_table.pkl")
    now = datetime.fromisoformat(open(os.path.join(a.ref, "now.txt")).read().strip())
    wdir = os.path.join(a.pkg, "weights")
    w, base = EF.load_fuel_weights(wdir), EI.load_weights(wdir)
    rows = EI.live_rows(prices, live, now)
    aug, cols = EF.model_columns_fuel(rows, prices, table, w, base)
    point = np.full(len(aug), np.nan)
    for z in ZONES:
        m = (aug["zone"] == z).to_numpy()
        if m.any():
            zr = aug[m]
            point[m] = RC.point_forecast(z, {k: np.asarray(v)[m] for k, v in cols.items()}, True,
                                         day_ids=(zr["date"].dt.strftime("%Y-%m-%d") + "_" + zr["h"].astype(str)).to_numpy())
    ok = True
    for name, mine, ref in (("central estimate", point, np.load(os.path.join(a.ref, "point_fuel.npy"))), ("P10 model", cols["q10"], np.load(os.path.join(a.ref, "q10_fuel.npy"))),
                            ("P90 model", cols["q90"], np.load(os.path.join(a.ref, "q90_fuel.npy")))):
        fin = np.isfinite(mine) & np.isfinite(ref)
        diff = float(np.abs(mine[fin] - ref[fin]).max())
        same = bool((np.isfinite(mine) == np.isfinite(ref)).all())
        print(f"{name}: {int(fin.sum()):,} hours, max |private repo - production| = {diff:.2e} EUR/MWh, same NaN pattern: {same}")
        ok &= diff < 1e-6 and same
    res = EF.forecast_fuel(prices, live, table, wdir, now=now)
    n_days = sum(len(p["days"]) for p in res.values())
    banded = sum(1 for p in res.values() for d in p["days"] if "min_eur_mwh" in d["prices"][0])
    print(f"forecast_fuel(): {len(res)} zones, {n_days} forecast days, {banded} with a band")
    ok &= len(res) >= 20 and banded == n_days
    print("VERIFY OK" if ok else "VERIFY FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
