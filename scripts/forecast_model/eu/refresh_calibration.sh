#!/bin/bash
# Monthly (or weekly) refresh of the P10 / P90 band offsets: calibration_eu.json. NOT installed by the repo; see docs/forecast-runbook.md.
#
#   30 3 * * 0  /home/cc/eu-forecast/refresh_calibration.sh        (Sundays 03:30 UTC; the daily job at 15:15 picks the new file up)
#
# Why. The band is the quantile models' own P10 / P90 moved by the rolling 10th / 90th percentile of their miss over the last 180 days of an
# out-of-sample backtest (calibrate_bands.py). Error is not stationary: a band fitted before the September 2026 price shift covered 67-69 % of
# the hours afterwards. A file that is weeks old is still safe (the daily job publishes whatever the file says and the page prints the measured
# coverage of the research backtest, not of this file) but it ages.
#
# What. Rebuild the training set (prices and weather from the daily job's caches), add the fuel features, run the 2-month-fold quantile backtest
# (about 9 minutes on 8 threads) and write the offsets to a TEMPORARY file that replaces calibration_eu.json only when the whole chain succeeded.
# Nothing is written to KV. One run at a time, lowest priority, at most 3 hours.
set -u
cd "$(dirname "$0")" || exit 2
set -a; . "$HOME/.config/elpriser.env"; set +a
exec flock -n /tmp/eu-forecast-refresh.lock nice -n 10 timeout 3h bash -c '
  set -e
  python3 dataset.py
  python3 fuel_dataset.py --in dataset_eu.parquet --out dataset_eu_fuel.parquet --fuel fuel_daily.csv
  python3 quantile_backtest.py --jobs "${EU_FORECAST_JOBS:-8}"
  python3 calibrate_bands.py --quantile backtest_q_fuel.parquet --previous calibration_eu.json --out calibration_eu.json.new
  mv calibration_eu.json.new calibration_eu.json
' >> refresh.log 2>&1
