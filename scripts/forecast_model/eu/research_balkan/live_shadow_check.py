"""Live evidence for the level correction: the production archive (~/eu-forecast/archive, read only) holds, per run, the model's uncorrected numbers and the shadow (lambda 0.5, 14 days) numbers;
score both against the settled prices of ~/eu-forecast/price_<zone>.parquet (read only).  python3 research_balkan/live_shadow_check.py"""
import glob, json, os
import numpy as np, pandas as pd
SRC = os.path.expanduser("~/eu-forecast")
BAL = ["me", "mk", "rs", "xk", "al", "gr"]
rows = []
prices = {}
for f in sorted(glob.glob(f"{SRC}/archive/*.json")):
    pl = json.load(open(f))
    z = pl["zone"]
    if z not in prices:
        d = pd.read_parquet(f"{SRC}/price_{z}.parquet")
        s = d.set_index(pd.to_datetime(d["t"]))["eur_mwh"].sort_index()
        prices[z] = s[~s.index.duplicated(keep="last")]
    for d in pl["days"]:
        if d.get("type") != "forecast" or "uncorrected" not in d:
            continue
        y = prices[z].reindex(pd.date_range(d["date"], periods=24, freq="h")).to_numpy(float)
        u = np.array(d["uncorrected"], float); s = np.array(d.get("shadow") or [np.nan] * 24, float)
        if np.isnan(y).any() or len(u) != 24:
            continue
        rows.append(dict(zone=z, h=d["horizon"], run=pl["generated"], date=d["date"], mae_u=np.abs(u - y).mean(), mae_s=np.abs(s - y).mean(), bias_u=(u - y).mean(), bias_s=(s - y).mean(), n_shadow=int(np.isfinite(s).all())))
R = pd.DataFrame(rows)
print("settled forecast days scored:", len(R), "runs", R.run.min(), "..", R.run.max(), "target days", R.date.min(), "..", R.date.max())
R = R[R.n_shadow == 1]
for name, sel in (("all zones", R.zone != ""), ("Balkan six", R.zone.isin(BAL))):
    g = R[sel].groupby("h")[["mae_u", "mae_s", "bias_u", "bias_s"]].mean().round(1)
    g["days"] = R[sel].groupby("h").size()
    print(f"\n{name}: live MAE / bias uncorrected vs shadow by horizon (EUR/MWh)")
    print(g.to_string())
print("\nby run date, Balkan six, all horizons:")
print(R[R.zone.isin(BAL)].groupby("run")[["mae_u", "mae_s", "bias_u", "bias_s"]].mean().round(1).to_string())
