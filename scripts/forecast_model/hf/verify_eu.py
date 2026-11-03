#!/usr/bin/env python3
"""Check that a (freshly downloaded) copy of the Hugging Face repo reproduces the production central estimate.

    python3 -I verify_eu.py --pkg ~/hf-verify/eu-price-forecast --ref ~/hf-publish/out/eu/ref

--pkg  the downloaded repo (eu_infer.py, code/, weights/, gate/)      --ref  export_eu.py --reference: frozen prices and weather, and the production
central estimate (recipe.point_forecast on the production ridge and LightGBM, in memory). The downloaded code, weights and gate files do all the work here;
nothing is read from the production directory. Exit 0 only if every hour agrees to 1e-6 EUR/MWh and the full forecast() call produces payloads.
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
    from zones import ZONES
    import recipe as RC
    assert os.path.abspath(a.pkg) in os.path.abspath(EI.__file__), "eu_infer was not imported from --pkg"
    with open(os.path.join(a.ref, "prices.pkl"), "rb") as f:
        prices = pickle.load(f)
    with open(os.path.join(a.ref, "live.pkl"), "rb") as f:
        live = pickle.load(f)
    now = datetime.fromisoformat(open(os.path.join(a.ref, "now.txt")).read().strip())
    ref = np.load(os.path.join(a.ref, "point_nofuel.npy"))
    w = EI.load_weights(os.path.join(a.pkg, "weights"))
    rows = EI.live_rows(prices, live, now)
    aug, cols, imputed = EI.model_columns(rows, prices, w)
    point = np.full(len(aug), np.nan)
    for z in ZONES:
        m = (aug["zone"] == z).to_numpy()
        if m.any():
            zr = aug[m]
            point[m] = RC.point_forecast(z, {k: np.asarray(v)[m] for k, v in cols.items()}, False,
                                         day_ids=(zr["date"].dt.strftime("%Y-%m-%d") + "_" + zr["h"].astype(str)).to_numpy())
    assert len(point) == len(ref), (len(point), len(ref))
    fin = np.isfinite(point) & np.isfinite(ref)
    diff = float(np.abs(point[fin] - ref[fin]).max())
    same_nan = bool((np.isfinite(point) == np.isfinite(ref)).all())
    print(f"central estimate: {int(fin.sum()):,} hours compared, max |published - production| = {diff:.2e} EUR/MWh, same NaN pattern: {same_nan}, imputed lags {imputed}")
    res = EI.forecast(prices, live, os.path.join(a.pkg, "weights"), now=now, log=print)
    n_days = sum(len(p["days"]) for p in res.values())
    banded = sum(1 for p in res.values() for d in p["days"] if "min_eur_mwh" in d["prices"][0])
    print(f"forecast(): {len(res)} zones, {n_days} forecast days, {banded} with a band")
    ok = diff < 1e-6 and same_nan and len(res) >= 20 and banded == n_days
    print("VERIFY OK" if ok else "VERIFY FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
