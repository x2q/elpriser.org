#!/bin/bash
# Cron entry point for the ESTIMATE job (Great Britain, Portugal, Ireland). NOT installed by the repo; see docs/forecast-runbook.md ("The estimate job").
#
#   12 * * * *  /home/cc/gb-estimate/run_hourly.sh
#
# :12 UTC, five minutes after the Elexon price job (:07 of elpriser-eu, which writes eu-prices-gb), so the hour that has just ended is settled when the estimate for the rest of
# today is made; the Portugal / Ireland hour-23 estimate does not change within a day and is rewritten at most every 100 minutes (the API serves an estimate for 3 hours).
#
# One run at a time (flock, shared with the daily training so the price cache is never read half-written), lowest CPU priority, at most 20 minutes. Credentials come from
# ~/.config/elpriser.env and are never echoed. Exit codes of run_estimate.py: 0 ok (a zone that was skipped is logged, not an error), 2 missing configuration, 3 every zone failed.
set -u
cd "$(dirname "$0")" || exit 2
set -a; . "$HOME/.config/elpriser.env"; set +a
exec flock -n /tmp/gb-estimate.lock nice -n 10 timeout 20m python3 run_estimate.py >> estimate.log 2>&1
