#!/bin/bash
# Cron entry point for the daily training of the Great Britain estimate (models/gb_models.pkl). NOT installed by the repo; see docs/forecast-runbook.md.
#
#   25 3 * * *  /home/cc/gb-estimate/train_daily.sh
#
# 03:25 UTC: the day's settled prices are complete (Elexon) and the previous-runs weather of yesterday is in. Takes about 30 seconds on the Spark's 20 cores (2 minutes on 8).
# `flock -w 900` waits for a running hourly estimate (the two share /tmp/gb-estimate.lock); nothing is written to KV. A failed training leaves the old models, which the
# hourly job keeps using for 3 days and then refuses (the estimate vanishes by itself).
set -u
cd "$(dirname "$0")" || exit 2
export GB_JOBS="${GB_JOBS:-8}"
exec flock -w 900 /tmp/gb-estimate.lock nice -n 10 timeout 1h python3 train_gb.py >> train.log 2>&1
