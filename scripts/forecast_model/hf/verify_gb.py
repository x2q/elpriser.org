#!/usr/bin/env python3
"""Check that a (freshly downloaded) copy of the gb-price-estimate repo reproduces the production prediction.

    python3 -I verify_gb.py --pkg ~/hf-verify/gb-price-estimate --ref ~/hf-publish/out/gb/ref

--ref is export_gb.py --reference (frozen Elexon prices and weather, and the production prediction from the pickle). Exit 0 only if point, P10 and P90 agree to 1e-6.
"""
import argparse
import os
import pickle
import sys
from datetime import datetime

import numpy as np
import pandas as pd


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pkg", required=True)
    ap.add_argument("--ref", required=True)
    a = ap.parse_args(argv)
    sys.path.insert(0, os.path.abspath(a.pkg))
    import gb_infer as GI
    assert os.path.abspath(a.pkg) in os.path.abspath(GI.__file__), "gb_infer was not imported from --pkg"
    with open(os.path.join(a.ref, "frozen.pkl"), "rb") as f:
        fz = pickle.load(f)
    ref = pd.read_pickle(os.path.join(a.ref, "pred.pkl"))
    res = GI.estimate(fz["price"], fz["wx"], os.path.join(a.pkg, "weights"), datetime.fromisoformat(fz["now"]))
    pred = res["pred"]
    assert len(pred) == len(ref), (len(pred), len(ref))
    ok = True
    for c in ("point", "lo", "hi"):
        x, y = pred[c].to_numpy(float), ref[c].to_numpy(float)
        fin = np.isfinite(x) & np.isfinite(y)
        diff = float(np.abs(x[fin] - y[fin]).max()) if fin.any() else float("nan")
        same = bool((np.isfinite(x) == np.isfinite(y)).all())
        print(f"{c}: {int(fin.sum())} hours compared, max |published - production| = {diff:.2e} GBP/MWh, same NaN pattern: {same}")
        ok &= diff < 1e-6 and same
    print("estimate:", "yes" if res["estimate"] else "none (gate or hour)", "| forecast days:", len(res["forecast"]["days"]) if res["forecast"] else 0)
    print("VERIFY OK" if ok else "VERIFY FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
