#!/usr/bin/env python3
"""The P10 / P90 band offsets of the daily job -> calibration_eu.json.

    python3 calibrate_bands.py [--quantile backtest_q_fuel.parquet] [--regions regions/regions_all.parquet] [--out calibration_eu.json] [--previous calibration_eu.json]

THE RECIPE (docs/forecast-per-region.md, section 7). LightGBM with the quantile objective (alpha 0.1 and 0.9, fuel features, target = price -
level_7d) gives raw P10 / P90 that cover only 62-69 % of the hours. Each edge is then moved by the 10th (lower) / 90th (upper) percentile of ITS OWN
miss over the last WINDOW_DAYS days of the out-of-sample backtest, times BAND_SCALE:
    lo offset = 1.2 * P10( actual - q10 )      hi offset = 1.2 * P90( actual - q90 )
    published band = [ q10 + lo offset , q90 + hi offset ]   (widened to contain the central estimate; forecast.band_edges)
Measured out of sample (band recipe applied rolling, edges from residuals settled 8+ days before each month): 79-80 % of the hours inside over
the whole backtest, 74-76 % since September 2026 (the price-level shift), against 81 % / 67-69 % for the previous 180-day x 1.2 band around
the median. The honest number goes into the accuracy block (`coverage`, `coverageRecent`), never a nominal 80 %.

Two kinds of offset are written, one per zone and horizon:
  quantile  added to the quantile models' predictions (the normal run, fuel usable)
  residual  added to the central estimate (the old 180-day x 1.2 recipe): the band of a run WITHOUT fuel, where the quantile models (which need
            the fuel features) are not trained. Built from the research frame (regions_all.parquet, column `nofuel`) when it is given; otherwise
            the previous file's section is kept.
The file ages: error is not stationary. Re-run monthly (refresh_calibration.sh: dataset -> fuel dataset -> quantile_backtest.py -> this).
"""
import argparse
import json
import os
import sys
from datetime import date

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import calibrate as K             # noqa: E402
import gate as G                  # noqa: E402
from zones import ZONES           # noqa: E402

WINDOW_DAYS = K.WINDOW_DAYS
BAND_SCALE = K.BAND_SCALE
MIN_N = K.MIN_N


def quantile_offsets(q, window_days=WINDOW_DAYS, scale=BAND_SCALE, min_n=MIN_N):
    """{zone: {h: {lo, hi}}} from a frame with zone, h, date, y, q10, q90: the scaled 10th percentile of y - q10 and 90th percentile of y - q90
    over the `window_days` ending with the newest date of the frame (all of them settled: it is a backtest)."""
    d = q.copy()
    d["date"] = pd.to_datetime(d["date"])
    end = d["date"].max() + pd.Timedelta(days=1)
    d = d[d["date"] >= end - pd.Timedelta(days=window_days)]
    out = {}
    for (z, h), s in d.groupby(["zone", "h"], observed=True):
        s = s.dropna(subset=["y", "q10", "q90"])
        if len(s) < min_n:
            continue
        lo = float(np.percentile(s["y"] - s["q10"], 10)) * scale
        hi = float(np.percentile(s["y"] - s["q90"], 90)) * scale
        out.setdefault(str(z), {})[str(int(h))] = {"lo": round(lo, 2), "hi": round(hi, 2)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quantile", default=os.path.join(DIR, "backtest_q_fuel.parquet"))
    ap.add_argument("--regions", default=os.path.join(DIR, "regions", "regions_all.parquet"))
    ap.add_argument("--out", default=os.path.join(DIR, "calibration_eu.json"))
    ap.add_argument("--previous", default=os.path.join(DIR, "calibration_eu.json"), help="the file whose `residual` section is kept when the research frame is not at hand")
    a = ap.parse_args()
    q = pd.read_parquet(a.quantile, columns=["zone", "h", "date", "y", "q10", "q90"])
    q["zone"] = q["zone"].astype(str)
    q = q[q["zone"].isin(list(ZONES))]
    quantile = quantile_offsets(q)
    residual = (G.load_calibration(a.previous) or {}).get("residual", {})            # keep the previous section unless the research frame is at hand
    if os.path.exists(a.regions):
        r = pd.read_parquet(a.regions, columns=["zone", "h", "date", "y", "lear_r365", "lgb_base"])
        r["zone"] = r["zone"].astype(str)
        r = r[r["zone"].isin(list(ZONES)) & r["h"].between(2, 7)]
        r["nofuel"] = np.where(r["zone"].isin(["ee", "lv", "lt"]), r["lgb_base"], 0.5 * (r["lear_r365"] + r["lgb_base"]))
        residual = K.residual_bands(r.dropna(subset=["nofuel"]), col="nofuel")
    through = f"{pd.to_datetime(q['date']).max():%Y-%m-%d}"
    cal = {"version": G.VERSION, "built": date.today().isoformat(), "through": through, "windowDays": WINDOW_DAYS, "scale": BAND_SCALE,
           "quantile": quantile, "residual": residual}
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(G.dumps_compact(cal) + "\n")
    cells = sum(len(v) for v in quantile.values())
    print(f"{a.out}: quantile offsets for {len(quantile)} zones ({cells} zone-horizons) through {through}; residual offsets for {len(residual)} zones")


if __name__ == "__main__":
    main()
