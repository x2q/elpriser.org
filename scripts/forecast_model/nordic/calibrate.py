#!/usr/bin/env python3
"""Per-zone, per-horizon prediction bands from empirical residual quantiles.

The first attempt scaled LightGBM's own quantile spread until coverage hit
80%, the way the Danish model does. That works where the model's uncertainty
estimate is roughly the right shape and just too narrow — DK, NL and SE3/SE4
needed a sensible ~1.8-2.0x. It broke down in the flat, low-price zones: NO4
needed 8.0x and still fell short of 80%, NO5 up to 7.5x, SE1/SE2 up to ~5x.

A band that has to be inflated eightfold is not carrying information about
when uncertainty is high — it is just being stretched to pass a coverage
check. Those zones sit near a stable level most of the time and then spike
hard (NO4 averages 22 EUR/MWh but has reached 321), so the conditional
quantiles are badly calibrated in a way scaling cannot repair.

Empirical residual quantiles sidestep that: take the actual distribution of
(actual - forecast) per zone and horizon from the backtest, and add its 10th
and 90th percentiles to the point forecast. Coverage is then correct by
construction, and the band width reflects the error distribution that zone
really has.
"""
import json
import numpy as np
import pandas as pd

P = "/home/cc/nordic"

d = pd.read_parquet(f"{P}/backtest_nordic.parquet")
d["date"] = pd.to_datetime(d["date"])
d["resid"] = d.y - d.hyb

cal = {}
print("EMPIRICAL RESIDUAL BANDS (additive, per zone and horizon)")
print(f"{'zone':6} {'coverage':>9} {'mean width':>11} {'width % of price':>17}")
for z, s in d.groupby("zone", observed=True):
    cal[z] = {}
    covs, widths = [], []
    for h, sub in s.groupby("h"):
        r = sub.resid.dropna()
        if len(r) < 100:
            continue
        lo, hi = np.percentile(r, [10, 90])
        cal[z][str(int(h))] = {"lo": round(float(lo), 2), "hi": round(float(hi), 2)}
        covs.append(((sub.y >= sub.hyb + lo) & (sub.y <= sub.hyb + hi)).mean())
        widths.append(hi - lo)
    mean_price = s.y.mean()
    print(f"{z:6} {np.mean(covs)*100:8.1f}% {np.mean(widths):10.1f} "
          f"{np.mean(widths)/mean_price*100:16.0f}%")

json.dump(cal, open(f"{P}/calibration_nordic.json", "w"), indent=1)
print("\nsaved calibration_nordic.json")
