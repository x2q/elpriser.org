#!/usr/bin/env python3
"""Research: why does the LightGBM lose its edge since the September 2026 price shift (bias about -25 GBP/MWh), and what fixes it?

Variants on the hold-out folds (2026-06 .. 2026-11): the training window (all history / last 365 days), the feature set (with / without the absolute price level
features, which a tree cannot extrapolate beyond what it saw), and a stacked variant (the trees learn what the ridge missed). Prints MAE and bias for the rest of
today at 08:00 and for D+1, against level+shape and the ridge.
"""
import os
import sys

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import backtest_gb as BT          # noqa: E402
import gbfeat as GF               # noqa: E402
import gbmodels as GM             # noqa: E402

REL = [f for f in GF.LGB_FEATS if f not in ("b_A", "level_7d", "level_30d")]


def main():
    p, h = BT.load_hist()
    df = BT.rows(h, "2024-04-25", p.index.max().normalize())
    df = df[df["y"].notna() & df["b_A"].notna()]
    out = []
    for lo in ("2026-04-01", "2026-06-01", "2026-08-01", "2026-10-01"):
        lo = pd.Timestamp(lo)
        hi = lo + pd.DateOffset(months=2)
        train = df[df["date"] < lo]
        test = df[(df["asof_date"] >= lo) & (df["asof_date"] < hi) & df["a"].isin((2, 8, 14))].copy()
        rc = GM.fit_ridges(train, GF.design)
        test["c_ridge"] = GM.predict_ridges(rc, test, GF.design)
        tr = {"all": train, "365": train[train["date"] > train["date"].max() - pd.Timedelta(days=365)]}
        for win, t in tr.items():
            for fs, feats in (("abs", GF.LGB_FEATS), ("rel", REL)):
                m = GM.fit_lgb(t, 0.5, 12, feats)
                test[f"lgb_{win}_{fs}"] = GM.predict_lgb(m, test, feats)
        # stacked: trees on the ridge's residual (the ridge in-sample on the same training rows)
        t = tr["365"].copy()
        t["c_ridge"] = GM.predict_ridges(rc, t, GF.design)
        t = t.dropna(subset=["c_ridge"])
        import lightgbm as lgb
        feats = REL
        m = lgb.LGBMRegressor(n_jobs=12, **GM.LGB_PARAMS)
        m.fit(t[feats], t["y"] - t["c_ridge"])
        test["stack"] = test["c_ridge"] + m.predict(test[feats])
        out.append(test)
        print("fold", lo.date(), flush=True)
    r = pd.concat(out)
    cols = ["b_A", "c_ridge", "lgb_all_abs", "lgb_all_rel", "lgb_365_abs", "lgb_365_rel", "stack"]
    r["ens_abs"] = (r["c_ridge"] + r["lgb_all_abs"]) / 2
    r["ens_365rel"] = (r["c_ridge"] + r["lgb_365_rel"]) / 2
    cols += ["ens_abs", "ens_365rel"]
    for name, sel in (("rest@08", (r["k"] == 0) & (r["a"] == 8)), ("D+1", r["k"] == 1), ("D+3", r["k"] == 3), ("D+7", r["k"] == 7)):
        for wname, w in (("hold", r["asof_date"] >= "2026-07-01"), ("since", r["asof_date"] >= "2026-09-01")):
            s = r[sel & w].dropna(subset=cols)
            print(f"{name:8s}{wname:6s} n={len(s):6d} " + "  ".join(f"{c}:{(s[c] - s['y']).abs().mean():.1f}/{(s[c] - s['y']).mean():+.0f}" for c in cols))


if __name__ == "__main__":
    main()
