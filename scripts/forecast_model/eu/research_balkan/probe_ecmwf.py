"""(c) Feasibility of the ECMWF IFS ENS archive (dynamical.org, CC BY 4.0, Icechunk over HTTPS): open the store, read the Balkan region of ONE init time for the variables the model
uses, and time it, to extrapolate the cost of a backfill from 2024-04-01.  Run with venv_ecmwf/bin/python (zarr 3, icechunk, xarray, pystac); needs no account."""
import time, sys
import numpy as np
import pystac, icechunk, xarray as xr

t0 = time.time()
cat = pystac.Catalog.from_file("https://stac.dynamical.org/catalog.json")
col = cat.get_child("ecmwf-ifs-ens-forecast-15-day-0-25-degree")
asset = col.assets["icechunk-https"]
repo = icechunk.Repository.open(icechunk.http_storage(asset.href))
ds = xr.open_zarr(repo.readonly_session("main").store, chunks=None)
print("open", round(time.time() - t0, 1), "s;", dict(ds.sizes), "init", str(ds.init_time.values[0])[:10], "..", str(ds.init_time.values[-1])[:10], flush=True)
print("variables:", list(ds.data_vars), flush=True)
VARS = ["wind_u_100m", "wind_v_100m", "temperature_2m", "downward_short_wave_radiation_flux_surface", "precipitation_surface"]
# the weather points of the Balkan/south zones (zones.py): me mk al xk rs gr bg hr ro hu
pts = [(42.8, 19.2), (41.6, 21.7), (41.0, 19.9), (42.65, 21.15), (44.5, 20.8), (38.5, 23.0), (42.8, 25.0), (45.5, 16.0), (44.5, 26.0), (44.5, 28.0), (47.2, 19.0)]
init = ds.init_time.values[400]
tot = 0
for v in VARS:
    t1 = time.time()
    la = xr.DataArray([p[0] for p in pts], dims="pt"); lo = xr.DataArray([p[1] for p in pts], dims="pt")
    a = ds[v].sel(init_time=init).sel(latitude=la, longitude=lo, method="nearest").load()
    tot += a.nbytes
    print(v, a.shape, round(time.time() - t1, 1), "s", flush=True)
print("one init, 5 variables, 11 points:", round(time.time() - t0, 1), "s total; extracted", tot / 1e6, "MB")
