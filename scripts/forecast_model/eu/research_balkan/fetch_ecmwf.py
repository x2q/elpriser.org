"""(c) ECMWF IFS ENS (dynamical.org Icechunk archive, CC BY 4.0, no account) at the weather points of the CEE zones + it-n: for every 00z init time from 2024-04-01 the ensemble MEAN and SPREAD
(std over the 51 members) of wind speed at 100 m (member speeds from u, v), 2 m temperature, shortwave radiation and precipitation, at every lead step, nearest 0.25-degree grid point.
Only those 8 numbers x 85 leads x 15 points per init are kept (30 KB), the rest of the chunk is discarded.  venv_ecmwf/bin/python research_balkan/fetch_ecmwf.py WORKER NWORKERS
Output ecmwf/<init>.npz (arrays `a`: [lead, point, 8], `leads`, `points`)."""
import os, sys, time
import numpy as np
import pystac, icechunk, xarray as xr
sys.path.insert(0, os.getcwd())
from zones import ZONES

ZS = ["hu", "sk", "ro", "bg", "gr", "hr", "si", "rs", "me", "mk", "al", "xk", "it-n"]
PTS = [(z, i, la, lo) for z in ZS for i, (la, lo) in enumerate(ZONES[z][2])]
FEATS = ["wspd_mean", "wspd_std", "temp_mean", "temp_std", "rad_mean", "rad_std", "precip_mean", "precip_std"]
w, nw = int(sys.argv[1]), int(sys.argv[2])
os.makedirs("ecmwf", exist_ok=True)
cat = pystac.Catalog.from_file("https://stac.dynamical.org/catalog.json")
asset = cat.get_child("ecmwf-ifs-ens-forecast-15-day-0-25-degree").assets["icechunk-https"]
repo = icechunk.Repository.open(icechunk.http_storage(asset.href))
ds = xr.open_zarr(repo.readonly_session("main").store, chunks=None)
la = xr.DataArray([p[2] for p in PTS], dims="pt"); lo = xr.DataArray([p[3] for p in PTS], dims="pt")
inits = ds.init_time.values
t0 = time.time(); done = 0
order = list(range(w, len(inits), nw))
if os.environ.get('REVERSE'):
    order = order[::-1]
for k in order:
    it = inits[k]
    name = f"ecmwf/{str(it)[:10]}.npz"
    if os.path.exists(name):
        continue
    for attempt in range(4):
        try:
            g = lambda v: ds[v].sel(init_time=it).sel(latitude=la, longitude=lo, method="nearest").load().values   # (lead, member, pt)
            u, v = g("wind_u_100m"), g("wind_v_100m")
            sp = np.sqrt(u ** 2 + v ** 2)
            te, ra, pr = g("temperature_2m"), g("downward_short_wave_radiation_flux_surface"), g("precipitation_surface") * 3600.0   # kg m-2 s-1 -> mm/h
            a = np.stack([x for arr in (sp, te, ra, pr) for x in (np.nanmean(arr, axis=1), np.nanstd(arr, axis=1))], axis=-1).astype(np.float32)
            np.savez(name + ".tmp.npz", a=a, leads=ds.lead_time.values.astype("timedelta64[h]").astype(int), points=np.array([f"{p[0]}:{p[1]}" for p in PTS]))
            os.replace(name + ".tmp.npz", name)
            break
        except Exception as e:                                   # network hiccup: retry
            print("retry", str(it)[:10], repr(e)[:100], flush=True); time.sleep(5 * (attempt + 1))
    done += 1
    if done % 10 == 0:
        print(f"worker {w}: {done} inits, {time.time()-t0:.0f}s", flush=True)
print("WORKER DONE", w, flush=True)
