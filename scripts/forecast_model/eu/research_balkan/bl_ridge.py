"""Ridge candidates of the balkan-level work (docs/forecast-balkan-level.md section 2), same engine as family_backtest.run_lear (closed-form ridge per zone and horizon,
refit every 7 days, window ending at the last settled target, target = y - base) with three things varied:
    anchor   the level the base forecast and the target are built on: base = shape_s + anchor (production: level_7d)
    extra    further columns for the design (region_models.design `extra`: used as they are, an empty value counting as 0)
    window   training window in days (production 365)
Fuel mode only unless --nofuel is given. Output: bl_ridge_<name>.parquet (zone, t, h, <name>) .

    python3 research_balkan/bl_ridge.py NAME [NAME ...]
"""
import os, sys, time
DIR = os.getcwd(); sys.path.insert(0, DIR)
import numpy as np, pandas as pd
import family_models as FM, region_models as RM
from family_backtest import EXTRA_LAGS

GRP = ["grp_gap_last", "grp_gap_l3", "grp_gap_l7"]
# name: (window, anchor, extra columns)
VARIANTS = {
    "r365": (365, "level_7d", []),                    # production (parity check against lear_r365_g)
    "r730": (730, "level_7d", []),                    # (e) the parked ridge730 window
    "a_ewm5": (365, "ewm5", []),                      # (a) level-anchored on the half-life-5-day level
    "a_l3": (365, "level_3d", []),                    # (a) level-anchored on the last-3-day level
    "b_reg": (365, "level_7d", GRP),                  # (b) regional level features
    "b_reg_dl": (365, "level_7d", GRP + ["dlvl7"]),   # (b) + the weekly drift of the zone's own level
    "dl": (365, "level_7d", ["dlvl7"]),               # drift alone
    "a_ewm5_730": (730, "ewm5", []),
    "b_reg_730": (730, "level_7d", GRP),
    "d_hyd": (365, "level_7d", ["res_pct_f", "res_d4_f", "res_reg_f"]),      # (d) leak-free A72 reservoir features
    "d_hyd_730": (730, "level_7d", ["res_pct_f", "res_d4_f", "res_reg_f"]),
    "c_ens": (365, "level_7d", []),                                          # (c) ECMWF IFS ENS mean replaces the weather of the CEE zones + it-n (bl_frame_ens.parquet)
    "c_ens_sd": (365, "level_7d", ["wind_sd", "rad_sd", "temp_sd"]),         # (c) + the ensemble spread
}


def lear_zone(A_z, X_z, base, step, window, fuel_cols, gas):
    refits = np.arange(np.datetime64("2025-04-01"), np.datetime64("2026-11-03"), np.timedelta64(step, "D"))
    out = np.full(len(A_z), np.nan)
    for h, g in A_z.groupby("h"):
        pos = g.index.to_numpy() - A_z.index[0]
        dates = g["date"].to_numpy().astype("datetime64[D]")
        cols = np.ones(X_z.shape[1], bool)
        if not gas:
            cols[fuel_cols] = False
        out[pos] = FM.lear_block(X_z[pos][:, cols], (g["y"] - base[pos]).to_numpy(), base[pos], dates, int(h), refits, window, None, "ridge",
                                 np.datetime64("2025-04-01"), np.datetime64("2026-11-02"), step)
    return out


def run(names, jobs=int(os.environ.get("JOBS", "8")), gas=True):
    from joblib import Parallel, delayed
    A = pd.read_parquet("bl_frame_hydro.parquet" if any(n.startswith("d_hyd") for n in names) else "bl_frame_ens.parquet" if any(n.startswith("c_ens") for n in names) else "bl_frame.parquet")
    A = A[A["h"] <= 7].reset_index(drop=True)
    A["date"] = pd.to_datetime(A["date"])
    for name in names:
        window, anchor, extra = VARIANTS[name]
        t0 = time.time()
        X = RM.design(A, True, extra=extra).join(A[EXTRA_LAGS].astype(np.float32))
        fuel_cols = [i for i, n in enumerate(X.columns) if n.startswith(("gap_", "mc_d7_", "mc_d28_")) or n in ("eua_d28", "gas_m1_spread")]
        Xn = X.to_numpy(np.float32)
        base_all = (A["shape_s"] + A[anchor]).to_numpy()
        jl = []
        for z, idx in A.groupby("zone").groups.items():
            sub = A.loc[idx, ["h", "date", "y"]]
            jl.append((z, idx, sub, Xn[idx], base_all[idx]))
        res = Parallel(n_jobs=jobs, backend="loky")(delayed(lear_zone)(sub, Xz, b, 7, window, fuel_cols, gas) for z, idx, sub, Xz, b in jl)
        col = pd.Series(np.nan, index=A.index)
        for (z, idx, sub, _, _), arr in zip(jl, res):
            col.loc[idx] = arr
        out = A[["zone", "t", "h"]].copy()
        out[name] = col.to_numpy()
        out = out[out[name].notna()]
        out.to_parquet(f"bl_ridge_{name}.parquet", index=False)
        print(f"[{time.time()-t0:5.0f}s] {name}: window {window}, anchor {anchor}, extra {extra}: {len(out):,} rows", flush=True)


if __name__ == "__main__":
    run(sys.argv[1:])
