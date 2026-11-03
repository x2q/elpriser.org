#!/usr/bin/env python3
"""Daily training of the Great Britain estimate -> models/gb_models.pkl (the hourly job, run_estimate.py, only loads it).

    cd ~/gb-estimate && set -a && . ~/.config/elpriser.env && set +a && python3 train_gb.py [--no-refresh]

Tops up the Elexon MID history (price_gb.parquet) and the Open-Meteo previous-runs weather (w_prev_gb_<i>.parquet), builds the rows of every settled as-of day,
and fits what backtest_gb.py fits at a fold start: the ridges (365-day window, one per as-of hour and day offset), the LightGBM median and its P10 / P90 models.
Nothing is written to KV. The environment file is not needed (Elexon and Open-Meteo need no key); the Cloudflare pair is only read by run_estimate.py.
"""
import argparse
import os
import pickle
import sys
import time
from datetime import datetime, timezone

import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
sys.path.insert(1, os.path.join(DIR, "..", "eu"))
sys.path.insert(1, os.path.join(DIR, "..", "..", "eu_prices"))
import backtest_gb as BT                                 # noqa: E402
import fetch_mid                                         # noqa: E402
import fetch_weather_gb as FW                            # noqa: E402
import gbfeat as GF                                      # noqa: E402
import gbmodels as GM                                    # noqa: E402

DATA = os.environ.get("GB_DATA_DIR", DIR)
MODELS = os.path.join(DATA, "models", "gb_models.pkl")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-refresh", action="store_true", help="use the cached prices and weather as they are")
    ap.add_argument("--jobs", type=int, default=int(os.environ.get("GB_JOBS", "8")))
    a = ap.parse_args(argv)
    t0 = time.time()
    print(f"=== GB estimate training {datetime.now(timezone.utc):%Y-%m-%d %H:%M}Z ===", flush=True)
    if not a.no_refresh:
        try:
            fetch_mid.update(os.path.join(DATA, "price_gb.parquet"))
        except Exception as e:
            print(f"  price refresh failed, using the cache: {e}", flush=True)
        try:
            FW.fetch_history(DATA, pause=3)
        except Exception as e:
            print(f"  weather history refresh failed, using the cache: {e}", flush=True)
    p, h = BT.load_hist()
    last = p.index.max().normalize() - pd.Timedelta(days=1)       # the newest day that is complete
    print(f"  prices {len(p):,} h through {p.index.max():%Y-%m-%d %H:00}; weather through {FW.load_prev(DATA).index.max():%Y-%m-%d}", flush=True)
    df = BT.rows(h, "2024-04-25", last)
    df = df[df["y"].notna() & df["b_A"].notna() & (df["date"] <= last)]
    print(f"  {len(df):,} training rows ({time.time() - t0:.0f}s)", flush=True)
    ridges = GM.fit_ridges(df, GF.design)
    lgb50, lgb10, lgb90 = (GM.fit_lgb(df, al, a.jobs) for al in (0.5, 0.1, 0.9))
    trained_through = df["date"].max().date().isoformat()
    os.makedirs(os.path.dirname(MODELS), exist_ok=True)
    tmp = MODELS + ".tmp"
    with open(tmp, "wb") as f:
        pickle.dump({"ridges": ridges, "lgb50": lgb50, "lgb10": lgb10, "lgb90": lgb90, "trainedThrough": trained_through,
                     "built": datetime.now(timezone.utc).isoformat(timespec="seconds"), "rows": len(df)}, f)
    os.replace(tmp, MODELS)
    print(f"DONE models for {len(ridges)} (as-of, day) cells, trained through {trained_through} ({time.time() - t0:.0f}s)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
