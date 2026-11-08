"""Diagnosis part 2: what the day-level miss of the production recipe since 2026-09-01 correlates with (D+5, the Balkan six, per target day): the gas cost trend at issue time, the gap between the
CCGT marginal cost and the zone's level, the weather forecast of the day (as the model saw it), the price run itself (actual day mean minus level_7d).  Needs diag_days.parquet (diag_level_shape.py) and bl_frame.parquet."""
import numpy as np, pandas as pd
D = pd.read_parquet("diag_days.parquet")
D = D[(D.h == 5) & (D.zone.isin(["me", "mk", "rs", "xk", "al", "gr"])) & (D.date >= "2026-09-01")]
F = pd.read_parquet("bl_frame.parquet", columns=["zone", "date", "h", "ccgt_mc", "ccgt_mc_d7", "ccgt_mc_d28", "mc_gap", "gas", "wind", "rad", "temp", "level_7d"])
F["date"] = pd.to_datetime(F["date"])
G = F[F.h == 5].groupby(["zone", "date"]).agg(mc=("ccgt_mc", "first"), mc_d7=("ccgt_mc_d7", "first"), mc_d28=("ccgt_mc_d28", "first"), gap=("mc_gap", "first"), gas=("gas", "first"),
                                                wind=("wind", "mean"), rad=("rad", "mean"), temp=("temp", "mean")).reset_index()
X = D.merge(G, on=["zone", "date"])
X["err"] = -X["m_prod"]                       # actual - forecast, day level (positive = the forecast was too low)
X["move"] = X["ym"] - X["lvl7"]
for c in ("wind", "rad", "temp"):             # weather as anomaly against the zone's own mean over the same days
    X[c + "_an"] = X[c] - X.groupby("zone")[c].transform("mean")
print("days", len(X), "zones", X.zone.nunique(), "| mean error (actual - forecast) %.1f EUR/MWh, sd %.1f" % (X.err.mean(), X.err.std()))
print("correlation of the day-level error (actual - forecast) with:")
for c in ("move", "mc_d7", "mc_d28", "gap", "gas", "wind_an", "rad_an", "temp_an"):
    print(f"   {c:8s} {X[['err', c]].corr().iloc[0, 1]:+.2f}")
from numpy.linalg import lstsq
def r2(cols, y="err"):
    Z = X[cols].to_numpy(float); Z = np.column_stack([np.ones(len(Z)), (Z - Z.mean(0)) / Z.std(0)])
    b = lstsq(Z, X[y].to_numpy(), rcond=None)[0]; res = X[y].to_numpy() - Z @ b
    return 1 - res.var() / X[y].var(), b[1:]
for name, cols in (("weather forecast anomalies (wind, rad, temp)", ["wind_an", "rad_an", "temp_an"]), ("gas cost trend + gap (mc_d7, mc_d28, gap)", ["mc_d7", "mc_d28", "gap"]), ("both", ["mc_d7", "mc_d28", "gap", "wind_an", "rad_an", "temp_an"])):
    r, b = r2(cols)
    print(f"R2 of the error on {name}: {r:.2f}; standardised coefficients {np.round(b, 1).tolist()}")
r, _ = r2(["move"]); print(f"R2 of the error on the price run (actual day mean - level_7d) alone: {r:.2f}  <- the level moved away from its trailing mean; nothing at issue time says by how much")
print("\nmonthly mean (EUR/MWh): gas da, ccgt marginal cost, price (Balkan six) -> the price run is the gas run:")
M = D.merge(G, on=["zone", "date"]); M["month"] = M.date.dt.strftime("%Y-%m")
print(M.groupby("month")[["gas", "mc", "ym"]].mean().round(0).to_string())
