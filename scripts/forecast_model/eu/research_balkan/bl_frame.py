"""Research frame of the balkan-level work (docs/forecast-balkan-level.md): the 26-zone research frame of zone_gate_frame.py (same rows, same baselines) plus the columns the
candidates need. Run in a COPY of the job directory (~/eu-forecast-bl) after region_backtest.build_frame's inputs exist.

New columns (all computed from prices up to the row's LAST KNOWN DAY L = date - (h - 1), the same leakage rule as features.py):
  level_3d, level_14d      trailing means of the daily means ending at L
  dlvl7                    level_7d(L) - level_7d(L - 7): the weekly drift of the level
  grp_last, grp_l3, grp_l7 mean over the OTHER zones of the zone's region (region_models.GROUPS: cee / core / baltics; none for it-n, es, pt, ie) of day_mean(L), level_3d(L), level_7d(L)
  grp_gap_last/l3/l7       the same minus the zone's own day_mean(L) / level_3d(L) / level_7d(L): is this zone cheaper or dearer than its neighbours than it was?
"""
import os, sys, time
DIR = os.getcwd(); sys.path.insert(0, DIR)
import numpy as np, pandas as pd
import region_backtest as RB, family_backtest as FB, region_models as RM

t0 = time.time()
def log(m): print(f"[{time.time()-t0:6.0f}s] {m}", flush=True)

REGION = {z: g for g, zs in RM.GROUPS.items() for z in zs if g in ("cee", "core", "baltics")}


def region_tables(prices):
    """{zone: daily table with day_mean, level_3d, level_7d, level_14d} (all trailing, indexed by the last day included)."""
    out = {}
    for z, p in prices.items():
        dm = p.groupby(p.index.normalize()).mean()
        dm = dm.reindex(pd.date_range(dm.index.min(), dm.index.max(), freq="D"))
        out[z] = pd.DataFrame({"day_mean": dm, "level_3d": dm.rolling(3, min_periods=2).mean(), "level_7d": dm.rolling(7, min_periods=3).mean(),
                               "level_14d": dm.rolling(14, min_periods=5).mean()})
    return out


def add_candidate_columns(A, prices):
    T = region_tables(prices)
    last = A["date"] - pd.to_timedelta(A["h"] - 1, unit="D")
    for c in ("level_3d", "level_14d"):
        A[c] = np.nan
    A["dlvl7"] = np.nan
    for z, idx in A.groupby("zone").groups.items():
        lz = last.loc[idx].to_numpy()
        for c in ("level_3d", "level_14d"):
            A.loc[idx, c] = T[z][c].reindex(lz).to_numpy()
        l7 = T[z]["level_7d"]
        A.loc[idx, "dlvl7"] = l7.reindex(lz).to_numpy() - l7.reindex(lz - np.timedelta64(7, "D")).to_numpy()
    for k, src in (("grp_last", "day_mean"), ("grp_l3", "level_3d"), ("grp_l7", "level_7d")):
        A[k] = np.nan
        own = {"grp_last": "last_day_mean", "grp_l3": "level_3d", "grp_l7": "level_7d"}[k]
        for z, idx in A.groupby("zone").groups.items():
            g = REGION.get(z)
            if g is None:
                continue
            others = [o for o in prices if o != z and REGION.get(o) == g]
            lz = last.loc[idx].to_numpy()
            stack = np.vstack([T[o][src].reindex(lz).to_numpy() for o in others])
            n = np.isfinite(stack).sum(axis=0)
            m = np.where(n >= max(1, len(others) // 2), np.nanmean(np.where(np.isfinite(stack), stack, np.nan), axis=0), np.nan)
            A.loc[idx, k] = m
            A.loc[idx, k.replace("grp_", "grp_gap_")] = m - A.loc[idx, own].to_numpy()
    return A


def build_eu_frame(h_max=8):
    """RB.build_frame without the Nordic rows and with the horizon-8 rows the production LightGBM trains on (the ridge uses h <= 7 only)."""
    eu = pd.read_parquet(os.path.join(DIR, "dataset_eu_fuel.parquet"))
    eu = eu[eu["h"] <= h_max].copy()
    eu["zone"] = eu["zone"].astype(str)
    eu["t"] = pd.to_datetime(eu["t"])
    A = eu
    A["date"] = A["t"].dt.normalize()
    prices, _ = RB.load_prices()
    prices = {z: s for z, s in prices.items() if z not in set(RB.NORDIC)}
    tables = RM.day_tables(prices)
    A = RM.attach_last_known(A, tables, ["ewm5", "ewm7"])
    A["b_lag7"], A["b_seasonal"], A["b_persist"] = A["lag7"], A["seasonal4w"], A["lag_last"]
    A["shape_s"] = RM.shape(A)
    A["b_lvlshape"] = A["shape_s"] + A["level_7d"]
    A = A.sort_values(["zone", "h", "t"], kind="stable").reset_index(drop=True)
    return A, prices


if __name__ == "__main__":
    A, prices = build_eu_frame()
    log(f"frame {len(A):,} rows, zones {A.zone.nunique()}")
    A = FB.add_lear_columns(A, prices)
    A = add_candidate_columns(A, prices)
    A = A[A["date"] >= pd.Timestamp("2024-03-15")]
    A.to_parquet("bl_frame.parquet", index=False)
    log(f"wrote bl_frame.parquet {len(A):,} rows, {A.shape[1]} columns")
    print(A[["grp_gap_last", "grp_gap_l7", "dlvl7", "level_3d"]].describe().round(1))
