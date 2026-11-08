"""What a dry run of train_daily.py (forecast_latest.json of the staged copy) says about the level correction: the shift by zone and horizon, that only the listed zones carry one, bands intact.
python3 research_balkan/dry_run_check.py <dir>"""
import json, sys
import numpy as np
L = json.load(open(sys.argv[1] + "/forecast_latest.json"))
six = ("me", "mk", "rs", "xk", "al", "gr")
print("zones", len(L))
for z in ("me", "mk", "rs", "xk", "al", "gr", "de", "hu", "sk", "ee", "it-n"):
    out = []
    for d in L[z]["days"]:
        pub = np.array([p["eur_mwh"] for p in d["prices"]]); unc = np.array(d["uncorrected"])
        out.append((d["horizon"], round(float((pub - unc).mean()), 1)))
    print(z, "mean shift (published - model's own) by horizon:", out, "| days", len(L[z]["days"]))
bad = [z for z in L if z not in six and any(abs(p["eur_mwh"] - u) > 0.006 for d in L[z]["days"] for p, u in zip(d["prices"], d["uncorrected"]))]
print("unlisted zones with a shifted number:", bad)
print("min <= price <= max everywhere:", all(p["min_eur_mwh"] <= p["eur_mwh"] <= p["max_eur_mwh"] for z in L for d in L[z]["days"] for p in d["prices"] if "min_eur_mwh" in p))
print("every day has a band:", all("min_eur_mwh" in d["prices"][0] for z in L for d in L[z]["days"]))
print("horizons of xk:", [d["horizon"] for d in L["xk"]["days"]], "| al:", [d["horizon"] for d in L["al"]["days"]])
