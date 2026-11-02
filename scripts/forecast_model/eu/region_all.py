#!/usr/bin/env python3
"""Merge every candidate forecast (region_backtest.py, family_backtest.py, catboost_backtest.py) into regions_all.parquet, build the
simple ensembles, score everything and write the winner tables.

Ensembles (components chosen per region group and horizon on the SELECT period only, like the single-model winners):
  ens_lt   the mean of the best linear model and the best tree model (LINEAR / TREE sets of family_models)
  ens_lb   the mean of level+shape and the best model of the group

    python3 region_all.py
"""
import os
import sys

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import family_models as FM        # noqa: E402
import region_models as RM        # noqa: E402
import region_scores as RS        # noqa: E402


def merge_all():
    df = pd.read_parquet(os.path.join(DIR, "regions_predictions.parquet"))
    df["zone"] = df["zone"].astype(str)
    df["t"] = pd.to_datetime(df["t"])
    key = ["zone", "t", "h"]
    path = os.path.join(DIR, "families_predictions.parquet")
    if os.path.exists(path):
        fam = pd.read_parquet(path)
        fam["zone"] = fam["zone"].astype(str)
        fam["t"] = pd.to_datetime(fam["t"])
        kp = os.path.join(DIR, "families_kalman.parquet")
        if os.path.exists(kp):                                # the Kalman columns re-run with the wider parameter grid win
            fam = fam.drop(columns=[c for c in fam.columns if c.startswith("k_")])
            k = pd.read_parquet(kp)
            k["zone"] = k["zone"].astype(str)
            k["t"] = pd.to_datetime(k["t"])
            fam = fam.merge(k, on=key, how="left")
        df = df.merge(fam, on=key, how="left")
    dp = os.path.join(DIR, "families_daily.parquet")
    if os.path.exists(dp):                                    # the daily-refit check of the best LEAR configurations
        d = pd.read_parquet(dp)
        d["zone"] = d["zone"].astype(str)
        d["t"] = pd.to_datetime(d["t"])
        df = df.merge(d, on=key, how="left")
    for tag in ("base", "fuel"):
        parts = []
        for st in ("eu", "nordic"):
            p = os.path.join(DIR, f"backtest_cb_{st}_{tag}.parquet")
            if os.path.exists(p):
                c = pd.read_parquet(p, columns=["zone", "t", "h", "p_cb"])
                c["zone"] = c["zone"].astype(str)
                c["t"] = pd.to_datetime(c["t"])
                parts.append(c)
        if parts:
            df = df.merge(pd.concat(parts).drop_duplicates(key).rename(columns={"p_cb": f"cb_{tag}"}), on=key, how="left")
    df["date"] = pd.to_datetime(df["date"])
    return df


def _best(scores, group, h, among):
    """The best column of `among` for a group and horizon on the select period (None if none is defined for every zone)."""
    gs = RS.group_scores(scores, group, h, "select", "mae")
    gs = {c: v for c, v in gs.items() if c in among}
    return min(gs, key=gs.get) if gs else None


def add_ensembles(df, scores):
    """ens_lt and ens_lb columns, chosen per (group, h) on the select period."""
    df = df.copy()
    df["ens_lt"] = np.nan
    df["ens_lb"] = np.nan
    chosen = {}
    singles = [c for c in scores["col"].unique() if c not in RS.NAIVE and c != "lgb_gasonly" and not c.startswith(("f_ptes", "ens_"))]
    for group, zs in RM.GROUPS.items():
        for h in range(2, 8):
            lin, tree = _best(scores, group, h, FM.LINEAR), _best(scores, group, h, FM.TREE)
            best = _best(scores, group, h, singles)
            m = df["zone"].isin(zs) & (df["h"] == h)
            if lin and tree:
                df.loc[m, "ens_lt"] = (df.loc[m, lin] + df.loc[m, tree]) / 2
            if best:
                df.loc[m, "ens_lb"] = (df.loc[m, RS.BASELINE] + df.loc[m, best]) / 2
            chosen[(group, h)] = {"linear": lin, "tree": tree, "best": best}
    return df, chosen


def main():
    df = merge_all()
    df = df[df["h"].between(2, 7)]
    base_cols = [c for c in df.columns if c not in ("ens_lt", "ens_lb")]
    sc0 = RS.score(df[base_cols])
    df, chosen = add_ensembles(df, sc0)
    df.to_parquet(os.path.join(DIR, "regions_all.parquet"), index=False)
    pd.DataFrame([{"group": g, "h": h, **v} for (g, h), v in chosen.items()]).to_csv(os.path.join(DIR, "ensemble_components.csv"), index=False)
    sc = RS.score(df)
    sc.to_csv(os.path.join(DIR, "region_scores.csv"), index=False)
    wm = RS.winners_table(sc, "mae")
    wm.to_csv(os.path.join(DIR, "region_winners_mae.csv"), index=False)
    wr = RS.winners_table(sc, "regret")
    wr.to_csv(os.path.join(DIR, "region_winners_regret.csv"), index=False)
    n = df.groupby(["zone", "h"]).size().describe()
    print(f"regions_all.parquet: {len(df):,} rows, {len(df.columns)} columns; rows per (zone, h): min {int(n['min'])} max {int(n['max'])}")
    print(f"publish (MAE rule): {int(wm.publish.sum())} of {len(wm)}; (regret rule): {int(wr.publish.sum())} of {len(wr)}")


if __name__ == "__main__":
    main()
