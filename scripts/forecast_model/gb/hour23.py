"""The missing last hour of Portugal's and Ireland's newest day.

Both zones run one hour behind CET, so the day-ahead auction (CET day) leaves the last local hour (23:00-24:00 = 00:00-01:00 CET of the next market day) of the
newest settled day without a price until the next auction is published (~11:45-12:45 UTC). The estimate of that ONE hour uses what is known when it is missing:
the same day's hours 0..22 and every earlier day.

  persist   the price of hour 22 of the same day                                  the naive method
  med28     hour 22 + the median of (hour 23 - hour 22) over the last 28 complete days   "the last settled hour and the typical same-hour step"

Which of the two a zone publishes is decided by backtest_hour23.py (hour23_gate.json): the one with the lower error out of sample, and only if it is not worse than
the best naive method (persistence of hour 22, yesterday's hour 23, last week's hour 23) on the whole backtest AND on the hold-out. The band is the
rolling residual band of the EU model (calibrate.py: 1.2 x the 10th / 90th percentile of the method's own error over the last 180 days).

Pure functions on a day x hour matrix (rows = days in order, 24 columns, NaN where there is no price).
"""
import numpy as np

METHODS = ("persist", "med28")
STEP_DAYS = 28
BAND_DAYS = 180
BAND_SCALE = 1.2
MIN_STEPS = 10


def step_median(P, i, n=STEP_DAYS):
    """Median of (hour 23 - hour 22) over the n complete days before day index i, or NaN with fewer than MIN_STEPS."""
    s = (P[max(0, i - n):i, 23] - P[max(0, i - n):i, 22])
    s = s[np.isfinite(s)]
    return float(np.median(s)) if len(s) >= MIN_STEPS else np.nan


def estimate(P, i, method):
    """The estimate of P[i, 23] from P[i, :23] and the days before i, or NaN when hour 22 is missing (or the history is too short for med28)."""
    p22 = P[i, 22]
    if not np.isfinite(p22):
        return np.nan
    if method == "persist":
        return float(p22)
    if method == "med28":
        st = step_median(P, i)
        return float(p22 + st) if np.isfinite(st) else np.nan
    raise ValueError(method)


def naive(P, i):
    """The naive candidates for P[i, 23]: persistence of hour 22, yesterday's hour 23, last week's hour 23."""
    return {"persist": P[i, 22], "yday": P[i - 1, 23] if i >= 1 else np.nan, "lag7": P[i - 7, 23] if i >= 7 else np.nan}


def band_offsets(res, scale=BAND_SCALE):
    """(lo, hi) from the residuals (actual - estimate) of the window: scale x P10 and scale x P90."""
    r = np.asarray(res, float)
    r = r[np.isfinite(r)]
    if len(r) < 60:
        return None
    return round(float(np.percentile(r, 10)) * scale, 2), round(float(np.percentile(r, 90)) * scale, 2)
