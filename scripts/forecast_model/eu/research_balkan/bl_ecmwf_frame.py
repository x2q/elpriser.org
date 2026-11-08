"""(c) Build the research frame with the ECMWF IFS ENS weather for the CEE zones + it-n (fetch_ecmwf.py -> ecmwf/<init>.npz): for every row (zone, target hour t, horizon h) the weather of the 00z run issued
h days before the target day (the lead the Open-Meteo previous-runs features use, min(h, 7); h = 8 rows use the 8-day lead), ensemble MEAN (and spread) interpolated linearly in lead time (3-hourly to 144 h, 6-hourly after)
at the hour. The columns `wind`, `rad`, `temp`, `precip` of those zones are REPLACED (originals kept as *_om); wind in km/h like Open-Meteo's; spreads as wind_sd, rad_sd, temp_sd. Other zones are untouched.
-> bl_frame_ens.parquet (all 26 zones; rows of the other zones identical to bl_frame.parquet)."""
import glob, os, sys
sys.path.insert(0, os.getcwd())
import numpy as np, pandas as pd
from zones import ZONES
ZS = ["hu", "sk", "ro", "bg", "gr", "hr", "si", "rs", "me", "mk", "al", "xk", "it-n"]
files = sorted(glob.glob("ecmwf/*.npz"))
files = [f for f in files if not f.endswith(".tmp.npz")]
print(len(files), "inits", files[0][-14:-4], "..", files[-1][-14:-4])
A = pd.read_parquet("bl_frame.parquet")
A["date"] = pd.to_datetime(A["date"])
z0 = np.load(files[0])
leads = z0["leads"].astype(float); points = [str(p) for p in z0["points"]]
hours = np.arange(0, 24 * 9)
cols = ["wspd_mean", "wspd_std", "temp_mean", "temp_std", "rad_mean", "rad_std", "precip_mean", "precip_std"]
# per init: array [lead, point, 8] -> per zone mean over its points -> interpolate to hourly leads
tabs = {z: [] for z in ZS}
idx = [i for i, p in enumerate(points)]
zpts = {z: [i for i, p in enumerate(points) if p.split(":")[0] == z] for z in ZS}
inits = []
for f in files:
    a = np.load(f)["a"]                                                          # (lead, point, 8)
    d = pd.Timestamp(os.path.basename(f)[:10])
    inits.append(d)
    for z in ZS:
        m = a[:, zpts[z], :].mean(axis=1)                                       # (lead, 8)
        h = np.stack([np.interp(hours, leads, m[:, k]) for k in range(8)], axis=1)
        tabs[z].append(h)
inits = pd.DatetimeIndex(inits)
parts = []
for z in ZS:
    sub = A[A["zone"] == z]
    tz = ZONES[z][1]
    tloc = pd.DatetimeIndex(sub["t"])
    # target hour on the UTC clock; the repeated autumn hour / skipped spring hour are ambiguous / nonexistent: resolve like features.to_local does (they are a handful of rows)
    tutc = tloc.tz_localize(tz, ambiguous="NaT", nonexistent="NaT").tz_convert("UTC").tz_localize(None)
    init = (sub["date"] - pd.to_timedelta(sub["h"], unit="D")).to_numpy()
    lead_h = ((tutc.to_numpy() - init) / np.timedelta64(1, "h"))
    pos = inits.get_indexer(pd.DatetimeIndex(init))
    ok = (pos >= 0) & np.isfinite(lead_h) & (lead_h >= 0) & (lead_h < len(hours))
    T = np.stack(tabs[z])                                                        # (init, hour, 8)
    vals = np.full((len(sub), 8), np.nan, dtype=np.float32)
    li = np.where(ok, lead_h, 0).astype(int)
    vals[ok] = T[pos[ok], li[ok], :]
    out = pd.DataFrame(vals, index=sub.index, columns=cols)
    parts.append(out)
E = pd.concat(parts)
A = A.join(E)
for c in ("wind", "rad", "temp", "precip"):
    A[c + "_om"] = A[c]
ens = A["zone"].isin(ZS)
A.loc[ens, "wind"] = A.loc[ens, "wspd_mean"] * 3.6
A.loc[ens, "temp"] = A.loc[ens, "temp_mean"]
A.loc[ens, "rad"] = A.loc[ens, "rad_mean"]
A.loc[ens, "precip"] = A.loc[ens, "precip_mean"]
A["wind_sd"] = A["wspd_std"] * 3.6; A["rad_sd"] = A["rad_std"]; A["temp_sd"] = A["temp_std"]
# rows of an ens zone without ens weather (init before 2024-04-01, hole): NaN weather = not usable by either model, exactly like a missing Open-Meteo row
print("ens-zone rows with ens weather:", float(A.loc[ens, "wind"].notna().mean().round(4)), "; before 2025-04-01 (training only):", float(A.loc[ens & (A.date < "2025-04-01"), "wind"].notna().mean().round(4)))
A.drop(columns=cols).to_parquet("bl_frame_ens.parquet", index=False)
sub = A[ens & A.wind.notna() & A.wind_om.notna() & (A.h == 5)]
print("correlation ens vs Open-Meteo previous-runs (h=5, km/h / degC / W per m2):", {c: round(float(np.corrcoef(sub[c], sub[c + "_om"])[0, 1]), 3) for c in ("wind", "temp", "rad", "precip")})
