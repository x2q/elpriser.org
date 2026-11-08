#!/bin/bash
# Research only (docs/forecast-xk.md): the gate chain for a zone that was just added to zones.py, in a COPY of the job directory - never in ~/eu-forecast, never writes KV.
#
#   zone_research.sh <work dir>
#
# The work dir holds this directory's code (without test_*), price_<zone>.parquet for ALL zones cut at the same day (the research's end date: 2026-11-02 for the checked-in gate),
# the weather caches (w_prev_*.parquet, the new zone's from `fetch_weather.py --zone <zone>`), fuel_daily.csv and, for region_backtest.build_frame, dataset_nordic_fuel.parquet and
# nprice_*.parquet of the Nordic zones. Result: <work dir>/gate_out/{publish_gate,accuracy_eu,calibration_eu}.json, to be merged into the live files with merge_zone.py
# (about 25 minutes on 8 threads; expects `nice`d CPU, keep it outside the cron window).
set -u
cd "${1:?work dir}" || exit 1
set -x
export JOBS=8
nice -n 10 python3 dataset.py > ds.log 2>&1 || exit 1
nice -n 10 python3 fuel_dataset.py --in dataset_eu.parquet --out dataset_eu_fuel.parquet --fuel fuel_daily.csv > fuel_ds.log 2>&1 || exit 1
nice -n 10 python3 backtest.py --variant rel --dataset dataset_eu.parquet --jobs 8 > bt_rel.log 2>&1 || exit 1
nice -n 10 python3 backtest.py --variant rel+fuel --dataset dataset_eu_fuel.parquet --jobs 8 > bt_rel_fuel.log 2>&1 || exit 1
OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 nice -n 10 python3 zone_gate_frame.py > lear.log 2>&1 || exit 1
OMP_NUM_THREADS=8 nice -n 10 python3 quantile_backtest.py --jobs 8 > q.log 2>&1 || exit 1
mkdir -p gate_out
nice -n 10 python3 build_gate.py --regions regions_zone.parquet --quantile backtest_q_fuel.parquet --out-dir gate_out > gate.log 2>&1 || exit 1
nice -n 10 python3 calibrate_bands.py --quantile backtest_q_fuel.parquet --regions regions_zone.parquet --previous calibration_eu.json --out gate_out/calibration_eu.json > cal.log 2>&1 || exit 1
echo CHAIN DONE > chain.done
