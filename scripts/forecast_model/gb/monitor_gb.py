#!/usr/bin/env python3
"""Live accuracy of the estimate: what the hourly job published (archive/*.json on the Spark) against the prices that were settled afterwards.

    cd ~/gb-estimate && python3 monitor_gb.py [--days 21]

Great Britain: for every archived run, the estimated hours of today against the settled Market Index Price (price_gb.parquet), grouped by the as-of hour's class, and the
forecast days D+1 .. D+7 against the day they were for. Portugal / Ireland: the archived hour-23 estimate against the hour that was settled (hist_<zone>.parquet).
Each live MAE is printed beside the backtest's (gb_gate.json / hour23_gate.json); exit code 4 with `ALERT` when a class with 10+ settled days is 1.5 times worse than
its backtest. Nothing is written anywhere and no credentials are needed.
"""
import argparse
import glob
import json
import os
import sys
from datetime import date, timedelta

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("GB_DATA_DIR", DIR)
MIN_DAYS = 10
FACTOR = 1.5


def series(path):
    d = pd.read_parquet(path)
    return d.set_index(pd.to_datetime(d["t"]))["eur_mwh"].sort_index()


def gb(days):
    price = series(os.path.join(DATA, "price_gb.parquet"))
    with open(os.path.join(DIR, "gb_gate.json"), encoding="utf-8") as f:
        gate = json.load(f)
    cut = pd.Timestamp(date.today() - timedelta(days=days))
    rows = []
    for fn in sorted(glob.glob(os.path.join(DATA, "archive", "gb-*.json"))):
        a = json.load(open(fn, encoding="utf-8"))
        if pd.Timestamp(a["today"]) < cut:
            continue
        for h in (a.get("estimate") or {}).get("hours", []):
            t = pd.Timestamp(a["today"]) + pd.Timedelta(hours=h["hour"])
            if t in price.index:
                rows.append({"cls": f"rest@{(a['estimate']['accuracy']['asOf']):02d}", "day": a["today"], "err": abs(h["eur_mwh"] - price[t]),
                             "inside": h.get("min_eur_mwh", -1e9) <= price[t] <= h.get("max_eur_mwh", 1e9)})
        for d in (a.get("forecast") or {}).get("days", []):
            for p in d["prices"]:
                t = pd.Timestamp(d["date"]) + pd.Timedelta(hours=p["hour"])
                if t in price.index:
                    rows.append({"cls": f"D+{d['horizon']}", "day": a["today"], "err": abs(p["eur_mwh"] - price[t]),
                                 "inside": p.get("min_eur_mwh", -1e9) <= price[t] <= p.get("max_eur_mwh", 1e9)})
    return pd.DataFrame(rows), {**{f"rest@{int(k):02d}": c for k, c in gate["rest"].items()}, **{f"D+{k}": c for k, c in gate["days"].items()}}


def h23(days):
    with open(os.path.join(DIR, "hour23_gate.json"), encoding="utf-8") as f:
        gate = json.load(f)["zones"]
    cut = pd.Timestamp(date.today() - timedelta(days=days))
    rows = []
    for fn in sorted(glob.glob(os.path.join(DATA, "archive", "h23-*.json"))):
        a = json.load(open(fn, encoding="utf-8"))
        z = a["zone"]
        path = os.path.join(DATA, f"hist_{z}.parquet")
        if pd.Timestamp(a["date"]) < cut or not os.path.exists(path):
            continue
        s = series(path)
        t = pd.Timestamp(a["date"]) + pd.Timedelta(hours=23)
        if t in s.index:
            rows.append({"cls": f"{z} h23", "day": a["date"], "err": abs(a["hour"]["eur_mwh"] - s[t]),
                         "inside": a["hour"].get("min_eur_mwh", -1e9) <= s[t] <= a["hour"].get("max_eur_mwh", 1e9)})
    return pd.DataFrame(rows), {f"{z} h23": c for z, c in gate.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=21)
    a = ap.parse_args()
    alert = False
    for name, fn in (("Great Britain", gb), ("Portugal / Ireland", h23)):
        try:
            df, ref = fn(a.days)
        except FileNotFoundError as e:
            print(f"{name}: {e.filename} missing, skipped")
            continue
        print(f"== {name}, last {a.days} days")
        if df.empty:
            print("   nothing archived and settled yet")
            continue
        for cls, g in df.groupby("cls"):
            n, mae = g["day"].nunique(), g["err"].mean()
            bt = (ref.get(cls) or {}).get("mae")
            bad = bt is not None and n >= MIN_DAYS and mae > FACTOR * bt
            alert |= bad
            print(f"   {cls:8s} days {n:3d}  hours {len(g):5d}  live MAE {mae:6.1f}  backtest {bt if bt is not None else float('nan'):6.1f}  inside band {g['inside'].mean():.2f}" + ("   ALERT" if bad else ""))
    return 4 if alert else 0


if __name__ == "__main__":
    sys.exit(main())
