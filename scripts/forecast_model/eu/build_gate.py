#!/usr/bin/env python3
"""From the research backtest to the two checked-in files that decide what the daily job publishes: publish_gate.json and accuracy_eu.json.

    python3 build_gate.py [--regions regions/regions_all.parquet] [--quantile regions/backtest_q_fuel.parquet] [--out-dir .]

The recipe that is published is recipe.py's, so its backtest forecast is rebuilt here from the research columns of regions_all.parquet
(region_all.py), column for column what production computes:
    fuel   (zones other than EE/LV/LT)   0.5 * (lear_r365_g + lgb_fuel)
    nofuel (the same zones)              0.5 * (lear_r365   + lgb_base)
    EE, LV, LT, both modes               lgb_base
All forecasts are scored on the SAME rows, against the naive 'level + shape' baseline (region_scores.py: periods full 2025-04-01..,
before / after 2026-09-01, select ..2026-06-30, hold 2026-07-01..).

THE GATE (the owner's rule): a zone-horizon is published only if the recipe's MAE is at least 5 % below level+shape's on the HOLD-OUT
(2026-07-01..) AND on the whole backtest. The recipe is fixed (nothing is chosen on the hold-out), so this is out of sample. FORCED_OFF
adds the owner's explicit exclusions on top (AL D+7: it passes by a hair, 5.5 % on the hold-out; the report's own table has it below the rule).

THE ACCURACY BLOCK per zone, mode and published horizon (what the page prints; see /api/openapi.json):
    mae, baseMae        EUR/MWh over the whole backtest: the forecast's and level+shape's
    gain, gainHold, gainRecent   1 - mae / baseMae over the whole backtest, the hold-out, and since 2026-09-01 (the price-level shift)
    bias, baseBias      since 2026-09-01, forecast minus actual (EUR/MWh): the model is NOT better than the simple method at the LEVEL
    regret, baseRegret  EUR/MWh: what following the 3 cheapest forecast hours costs against the 3 cheapest actual hours (whole backtest)
    rankGain, rankOk    1 - regret / baseRegret, and whether it is at least 5 % in the whole backtest AND the hold-out
    coverage, coverageRecent   share of hours inside the published P10-P90 band, measured rolling out of sample (the band recipe of
                        calibrate_bands.py applied to the quantile models; since September 2026 for the second): NOT the nominal 80 %
    low                 LOW CONFIDENCE: the gain is below 10 % in the whole backtest, the hold-out or since September, or below 5 % against
                        the best of the four naive baselines, or the owner listed the zone (OWNER_WEAK)
    days                number of settled days scored
`showEur` (EE, LV, LT): a percentage misleads there, the page quotes EUR/MWh.
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
import family_models as FM        # noqa: E402
import gate as G                  # noqa: E402
import level_correction as LC     # noqa: E402
import recipe as RC               # noqa: E402
import region_scores as RS        # noqa: E402
from zones import ZONES           # noqa: E402

MIN_GAIN = 0.05
FORCED_OFF = {"al": [7]}                                      # the owner's list: AL D+7 is not published
OWNER_WEAK = {"it-n": "all", "pt": "all", "gr": "all", "me": "all", "mk": "all", "es": [2]}    # flagged weak by the owner: always low confidence
SHOW_EUR = tuple(RC.BALTICS)
RECENT = RS.T_SHIFT
NAIVE = RS.NAIVE


LEVEL_LAMBDA = LC.PUBLISH_LAMBDA        # the published level correction (level_correction.py); the backtest numbers are those of the CORRECTED recipe


def recipe_columns(df, lam=None):
    """prod (fuel) and nofuel forecast columns of the research frame, with the published level correction (lam, default level_correction.PUBLISH_LAMBDA) applied the way the
    daily job applies it: shift by lam x the mean day-level error of the same zone and horizon over the last LC.K_DAYS days settled at issue (LC.apply_to_backtest, rolling
    through the backtest). The uncorrected numbers stay in `fuel_raw` / `nofuel_raw`, the shifts in `corr_fuel` / `corr_nofuel` (the band uses them: calibrate_bands.py)."""
    lam = LEVEL_LAMBDA if lam is None else lam
    bal = df["zone"].isin(RC.BALTICS)
    raw = {"fuel": np.where(bal, df["lgb_base"], 0.5 * (df["lear_r365_g"] + df["lgb_fuel"])),
           "nofuel": np.where(bal, df["lgb_base"], 0.5 * (df["lear_r365"] + df["lgb_base"]))}
    for mode, v in raw.items():
        df[f"{mode}_raw"] = v
        df[f"corr_{mode}"] = 0.0
        if lam > 0:
            df[f"corr_{mode}"] = LC.apply_to_backtest(df[["zone", "h", "date", "y"]].assign(p=v), lam, LC.K_DAYS, LC.MIN_DAYS, col="p")
        df[mode] = v + df[f"corr_{mode}"]
    return df


def coverage_table(frame, point_col, quant=None, corr_col=None):
    """{(zone, h): (coverage whole period, coverage since RECENT)} measured rolling out of sample, with the band recipe production uses:
    quantile edges + offsets (when `quant` is given: a frame with q10 / q90) or the central estimate + residual offsets. The offsets are those of the UNCORRECTED model (what
    calibrate_bands.py / refresh_calibration.sh write, they never see the level correction); when `corr_col` is given the band is then moved by that correction
    (the column of `frame`, or `corr_fuel` of `quant`), exactly as forecast.build_days moves the band with the published point."""
    extra = ([corr_col] if quant is None else ["corr_fuel"]) if corr_col else []
    f = frame[["zone", "h", "date", "y", point_col] + extra].copy() if quant is None else quant[["zone", "h", "date", "y", "q10", "q90"] + extra].copy()
    f = f.dropna().sort_values(["zone", "h", "date"]).reset_index(drop=True)
    if quant is None:
        lo, hi = FM.rolling_residual_band(f, point_col)
    else:
        lo, _ = FM.rolling_residual_band(f, "q10")
        _, hi = FM.rolling_residual_band(f, "q90")
    if corr_col:
        shift = f[extra[0]]
        lo, hi = lo + shift, hi + shift
    f["lo"], f["hi"] = lo, hi
    f = f.dropna(subset=["lo", "hi"])
    f["in"] = ((f["y"] >= f["lo"]) & (f["y"] <= f["hi"])).astype(float)
    out = {}
    for (z, h), g in f.groupby(["zone", "h"]):
        r = g[g["date"] >= RECENT]
        out[(str(z), int(h))] = (float(g["in"].mean()), float(r["in"].mean()) if len(r) >= 24 * 14 else None)
    return out


def cell(s, zone, h, col, cov, mode):
    """The accuracy cell of one zone, horizon and mode from the long score table `s` (region_scores.score), or None."""
    def get(period, c, metric):
        v = s[(s["zone"] == zone) & (s["h"] == h) & (s["period"] == period) & (s["col"] == c)][metric]
        return float(v.iloc[0]) if len(v) and pd.notna(v.iloc[0]) else np.nan
    base = RS.BASELINE
    mae, bmae = get("full", col, "mae"), get("full", base, "mae")
    if not (np.isfinite(mae) and np.isfinite(bmae) and bmae > 0):
        return None
    gain = 1 - mae / bmae
    g = {p: (1 - get(p, col, "mae") / get(p, base, "mae")) for p in ("hold", "after")}
    best_naive = np.nanmin([get("full", c, "mae") for c in NAIVE])
    reg, breg = get("full", col, "regret"), get("full", base, "regret")
    rank = {p: (1 - get(p, col, "regret") / get(p, base, "regret")) for p in ("full", "hold")}
    rank_ok = bool(np.isfinite(rank["full"]) and np.isfinite(rank["hold"]) and min(rank["full"], rank["hold"]) >= MIN_GAIN)
    weak = OWNER_WEAK.get(zone)
    owner = weak == "all" or (isinstance(weak, list) and h in weak)
    gains = [x for x in (gain, g["hold"], g["after"]) if np.isfinite(x)]
    low = bool(min(gains) < G.LOW_GAIN or (1 - mae / best_naive) < G.MIN_GAIN_VS_BEST_NAIVE or owner)
    c = cov.get((zone, h), (None, None))
    out = {"mae": round(mae, 1), "baseMae": round(bmae, 1), "gain": round(gain, 3),
           "gainHold": round(g["hold"], 3) if np.isfinite(g["hold"]) else None,
           "gainRecent": round(g["after"], 3) if np.isfinite(g["after"]) else None,
           "bias": round(get("after", col, "bias"), 1) if np.isfinite(get("after", col, "bias")) else None,
           "baseBias": round(get("after", base, "bias"), 1) if np.isfinite(get("after", base, "bias")) else None,
           "regret": round(reg, 2) if np.isfinite(reg) else None, "baseRegret": round(breg, 2) if np.isfinite(breg) else None,
           "rankGain": round(rank["full"], 3) if np.isfinite(rank["full"]) else None, "rankOk": rank_ok,
           "coverage": round(c[0], 2) if c[0] is not None else None,
           "coverageRecent": round(c[1], 2) if c[1] is not None else None,
           "low": low, "days": int(get("full", col, "n_days"))}
    passes = bool(gain >= MIN_GAIN and np.isfinite(g["hold"]) and g["hold"] >= MIN_GAIN and h not in FORCED_OFF.get(zone, []))
    return out, passes


def attach_correction(quant, df):
    """The quantile frame with the level correction of the same (zone, t, h) as `corr_fuel` (0 where the recipe frame has no row): the band moves with the point."""
    if quant is None:
        return None
    q = quant.assign(t=pd.to_datetime(quant["t"])).merge(df[["zone", "t", "h", "corr_fuel"]].assign(t=pd.to_datetime(df["t"])), on=["zone", "t", "h"], how="left")
    q["corr_fuel"] = q["corr_fuel"].fillna(0.0)
    return q


def build(df, quant=None, lam=None):
    """(gate dict, accuracy dict, report lines) from the research frame (columns: zone t date h y b_lvlshape + the model columns)."""
    df = recipe_columns(df[df["zone"].isin(list(ZONES)) & df["h"].between(RC.H_MIN, RC.H_MAX)].copy(), lam)
    quant = attach_correction(quant, df)
    s = RS.score(df, cols=NAIVE + ["fuel", "nofuel"])
    corr = lam if lam is not None else LEVEL_LAMBDA
    cov = {"fuel": coverage_table(df, "fuel_raw", quant, "corr_fuel" if corr > 0 else None),
           "nofuel": coverage_table(df, "nofuel_raw", None, "corr_nofuel" if corr > 0 else None)}
    zones_gate, zones_acc, notes = {}, {}, []
    for z in ZONES:
        gz = {"recipe": "lgb" if z in RC.BALTICS else "ens", "fuel": [], "nofuel": []}
        az = {"recipe": gz["recipe"], "showEur": z in SHOW_EUR, "fuel": {}, "nofuel": {}}
        for h in range(RC.H_MIN, RC.H_MAX + 1):
            for mode, col in (("fuel", "fuel"), ("nofuel", "nofuel")):
                r = cell(s, z, h, col, cov[mode], mode)
                if r is None:
                    continue
                c, ok = r
                if ok:
                    gz[mode].append(h)
                    az[mode][str(h)] = c
                elif mode == "fuel":
                    notes.append(f"{z} D+{h}: not published (gain {c['gain']:.1%}, hold-out {c['gainHold']}{', forced off' if h in FORCED_OFF.get(z, []) else ''})")
        zones_gate[z], zones_acc[z] = gz, az
    first, last = f"{df['date'].min():%Y-%m-%d}", f"{df['date'].max():%Y-%m-%d}"
    period = f"{first}..{last}"
    meta = {"version": G.VERSION, "built": date.today().isoformat(), "period": period, "model": RC.MODEL_NAME}
    gate = {**meta,
            "rule": "a zone-horizon is published only if the recipe's MAE is at least 5 % below the naive level+shape method on the hold-out (2026-07-01..) and on the whole backtest",
            "forcedOff": FORCED_OFF, "ownerWeak": OWNER_WEAK, "zones": zones_gate}
    acc = {**meta, "baseline": "level+shape", "recent": RECENT.strftime("%Y-%m-%d"),
           "recipes": RC.RECIPES, "zones": zones_acc}
    return gate, acc, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", default=os.path.join(DIR, "regions", "regions_all.parquet"))
    ap.add_argument("--quantile", default=os.path.join(DIR, "regions", "backtest_q_fuel.parquet"))
    ap.add_argument("--out-dir", default=DIR)
    a = ap.parse_args()
    cols = ["zone", "t", "date", "h", "hour", "y", "level_7d", "b_lag7", "b_seasonal", "b_persist", "b_lvlshape", "lear_r365_g", "lear_r365", "lgb_fuel", "lgb_base"]
    df = pd.read_parquet(a.regions, columns=cols)
    df["zone"] = df["zone"].astype(str)
    df["date"] = pd.to_datetime(df["date"])
    q = None
    if os.path.exists(a.quantile):
        q = pd.read_parquet(a.quantile, columns=["zone", "t", "h", "date", "y", "q10", "q90"])
        q["zone"] = q["zone"].astype(str)
        q["date"] = pd.to_datetime(q["date"])
        q = q[q["zone"].isin(list(ZONES)) & q["h"].between(RC.H_MIN, RC.H_MAX)]
    gate, acc, notes = build(df, q)
    with open(os.path.join(a.out_dir, "publish_gate.json"), "w", encoding="utf-8") as f:
        f.write(G.dumps_compact(gate) + "\n")
    with open(os.path.join(a.out_dir, "accuracy_eu.json"), "w", encoding="utf-8") as f:
        f.write(G.dumps_compact(acc) + "\n")
    n = {m: sum(len(v[m]) for v in gate["zones"].values()) for m in ("fuel", "nofuel")}
    total = len(ZONES) * (RC.H_MAX - RC.H_MIN + 1)
    print(f"publish_gate.json / accuracy_eu.json: {len(ZONES)} zones, period {gate['period']}; horizons published: fuel {n['fuel']} of {total}, no-fuel {n['nofuel']} of {total}")
    low = sum(1 for z in acc["zones"].values() for c in z["fuel"].values() if c["low"])
    print(f"  low confidence: {low} of {n['fuel']} published cells (fuel mode)")
    for line in notes:
        print("  " + line)


if __name__ == "__main__":
    main()
