"""LightGBM candidates of the balkan-level work (docs/forecast-balkan-level.md section 2): backtest.py's model (pooled over the zones, quantile median, 400 trees, `zone` categorical,
rolling-origin 2-month folds from 2025-04 trained on all rows whose target day is before the fold, horizons 2..8 in training, 2..7 scored) with the feature set and the anchor varied.

    anchor   target = price - anchor (production: level_7d)
    feats    'prod'   backtest.py's FEATS + the fuel features (production)
             'rel'    LEVEL-INVARIANT: no feature carries an absolute price or fuel level - every price lag / day level / EU level is a difference to the zone's own level_7d, the absolute
                      gas, carbon and CCGT-cost levels are dropped (their 7/28-day changes, the month-ahead spread and the cost-minus-level gap stay), `level_7d` itself is dropped
             '+reg'   adds the regional gap features (bl_frame.py) and the weekly level drift
Output bl_lgb_<name>.parquet (zone, t, h, <name>), h 2..7 only.

    python3 research_balkan/bl_lgb.py NAME SEED [NAME SEED ...]
"""
import os, sys, time
DIR = os.getcwd(); sys.path.insert(0, DIR)
import numpy as np, pandas as pd
import lightgbm as lgb
import backtest as BT
import features as F
from zones import ZONES

GRP = ["grp_gap_last", "grp_gap_l3", "grp_gap_l7"]
ABS_FUEL = ["gas", "eua", "ccgt_mc"]
REL_SRC = ["lag_last", "lag1", "lag2", "lag3", "lag7", "lag14", "lag21", "lag28", "seasonal4w", "last_day_mean", "level_30d", "eu_last_day_mean", "eu_level_7d", "eu_level_30d"]
# name: (anchor, feature set tag, extra columns)
VARIANTS = {
    "t_prod": ("level_7d", "prod", []),
    "t_rel": ("level_7d", "rel", []),
    "t_rel_reg": ("level_7d", "rel", GRP + ["dlvl7"]),
    "t_prod_reg": ("level_7d", "prod", GRP + ["dlvl7"]),
    "t_ewm5": ("ewm5", "prod", []),
    "t_l3": ("level_3d", "prod", []),
    "t_rel_ewm5": ("ewm5", "rel", []),
    "t_hyd": ("level_7d", "prod", ["res_pct", "res_d4", "res_reg"]),        # (d) leak-free A72 reservoir features
    "t_ens": ("level_7d", "prod", []),                                       # (c) ECMWF IFS ENS mean replaces the weather of the CEE zones + it-n
    "t_ens_sd": ("level_7d", "prod", ["wind_sd", "rad_sd", "temp_sd"]),      # (c) + the ensemble spread
}


def add_rel(df):
    for c in REL_SRC:
        df[c + "_r"] = df[c] - df["level_7d"]
    return df


def feats_for(tag, extra):
    f = list(F.FEATS) + list(BT.FUEL_FEATS)
    if tag == "rel":
        f = [c for c in f if c not in REL_SRC and c not in ABS_FUEL and c != "level_7d"] + [c + "_r" for c in REL_SRC]
    return f + extra


def run(name, seed, jobs=int(os.environ.get("JOBS", "8"))):
    anchor, tag, extra = VARIANTS[name]
    df = pd.read_parquet("bl_frame_hydro.parquet" if name.startswith("t_hyd") else "bl_frame_ens.parquet" if name.startswith("t_ens") else "bl_frame.parquet")
    df["date"] = pd.to_datetime(df["date"])
    df["zone"] = pd.Categorical(df["zone"], categories=list(ZONES))
    df = add_rel(df).sort_values("t")
    feats = feats_for(tag, extra)
    req = [c for c in BT.required([c for c in feats if c not in extra]) if c in df.columns]
    req = [c for c in req if not c.endswith("_r") or c[:-2] not in BT.NULLABLE]
    folds = pd.period_range("2025-04", "2026-11", freq="M")
    params = dict(BT.PARAMS)
    if seed:
        params["random_state"] = int(seed)
    out = []
    t0 = time.time()
    for i in range(0, len(folds), 2):
        lo, hi = folds[i].start_time, folds[min(i + 1, len(folds) - 1)].end_time
        train = df[df["date"] < lo].dropna(subset=req + ["y", anchor])
        test = df[(df["date"] >= lo) & (df["date"] <= hi) & (df["h"] <= 7)]
        if len(train) < 100_000 or not len(test):
            continue
        m = lgb.LGBMRegressor(n_jobs=jobs, **params)
        m.fit(train[feats], train["y"] - train[anchor], categorical_feature=["zone"])
        o = test[["zone", "t", "h"]].copy()
        o["zone"] = o["zone"].astype(str)
        o[name] = m.predict(test[feats]) + test[anchor].to_numpy()
        out.append(o)
        print(f"  {name} s{seed} fold {lo:%Y-%m}..{hi:%Y-%m}: train {len(train):,} test {len(test):,} {time.time()-t0:.0f}s", flush=True)
    res = pd.concat(out, ignore_index=True)
    res.to_parquet(f"bl_lgb_{name}_s{seed}.parquet", index=False)
    print(f"{name} seed {seed}: {len(res):,} rows, {len(feats)} features, {time.time()-t0:.0f}s", flush=True)


if __name__ == "__main__":
    a = sys.argv[1:]
    for k in range(0, len(a), 2):
        run(a[k], int(a[k + 1]))
