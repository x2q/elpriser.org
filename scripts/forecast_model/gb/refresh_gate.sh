#!/bin/bash
# Re-measure the estimate and rewrite what decides what is published: gb_gate.json, gb_calibration.json (Great Britain) and hour23_gate.json (Portugal, Ireland).
# NOT in cron by default: run it monthly, or when `monitor_gb.py` alarms, and review `git diff` of the three files before copying them (a class that stops being
# published is a decision, not an accident). Error is not stationary: the bands of a file fitted before the September 2026 price shift covered only 61-71 % afterwards.
#
#   ./refresh_gate.sh            # about 5 minutes: price + weather top-up, backtest, gate, hour-23 backtest
#
# The new files are written to ./refreshed/ and only the whole chain succeeding makes them appear there; nothing in the live directory changes.
set -eu
cd "$(dirname "$0")"
mkdir -p refreshed
export GB_DATA_DIR="${GB_DATA_DIR:-$PWD}"
exec 9>/tmp/gb-estimate-refresh.lock
flock -n 9 || { echo "another refresh is running"; exit 1; }
nice -n 10 python3 fetch_mid.py
nice -n 10 python3 fetch_weather_gb.py
nice -n 10 python3 backtest_gb.py --jobs "${GB_JOBS:-8}"
python3 build_gate_gb.py --out-dir refreshed
for z in pt ie; do cp "$HOME/eu-forecast/price_$z.parquet" "price_$z.parquet"; done      # read-only copy of the EU job's ENTSO-E caches
python3 backtest_hour23.py --pt price_pt.parquet --ie price_ie.parquet --out refreshed/hour23_gate.json
echo "REFRESH DONE: refreshed/gb_gate.json refreshed/gb_calibration.json refreshed/hour23_gate.json"
