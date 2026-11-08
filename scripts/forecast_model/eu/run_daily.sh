#!/bin/bash
# Cron entry point for the EU forecast (NOT installed by the repo; see docs/forecast-runbook.md).
#
#   15 15 * * *  /home/cc/eu-forecast/run_daily.sh
#
# 15:15 UTC: after the price jobs (Energy-Charts 11:30/14:00, ENTSO-E 11:45/14:15, SEMOpx and Elexon, which finish by ~14:20), after the
# Nordic jobs (12:10 prognose3, 12:40 nordic, 12:50/12:55 price_archive) and after the 12:45 CET day-ahead auction in both summer and
# winter time, so tomorrow's prices are known and the first forecast day is the day after tomorrow. The gas index of the day is out by then too.
#
# One run at a time (flock), lowest CPU priority, at most 2 hours, LightGBM on 8 threads. Credentials come from ~/.config/elpriser.env and are
# never echoed. Exit codes of train_daily.py: 0 ok, 1 aborted before writing (live weather missing), 2 missing configuration (or no gate file),
# 3 fewer than 20 zones written. Alert on the log (daily.log): the line "DONE n/26 zones" with n below 20, and "FUEL off:" (the run went on without
# the gas and carbon inputs: fewer horizons, a different accuracy block; harmless for a day or two, look at it after three).
set -u
cd "$(dirname "$0")" || exit 2
set -a; . "$HOME/.config/elpriser.env"; set +a
export EU_FORECAST_JOBS="${EU_FORECAST_JOBS:-8}"
exec flock -n /tmp/eu-forecast.lock nice -n 10 timeout 2h python3 train_daily.py >> daily.log 2>&1
