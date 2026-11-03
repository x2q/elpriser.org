#!/bin/bash
# Cron entry point for the weekly Hugging Face snapshot of the EU (fuel-free) and GB weights. NOT installed by the repo; see docs/hf-publishing.md.
#
#   45 15 * * 0  /home/cc/hf-publish/snapshot_hf.sh
#
# Sunday 15:45 UTC: after the day's EU forecast run (15:15, about 7 minutes) and the hourly GB job, so the caches the export reads are fresh, and far from the next
# day's 15:15 run. It never takes the EU job's lock (a held lock would make the production run skip): if that job is running now it simply stands aside
# and the next Sunday catches up. Own lock, 1 hour limit, lowest CPU priority, the Hugging Face token only from the environment file (never echoed).
set -u
cd "$(dirname "$0")" || exit 2
set -a; . "$HOME/.config/elpriser.env"; set +a
if ! flock -n /tmp/eu-forecast.lock true 2>/dev/null; then
  echo "$(date -u +%FT%TZ) the EU forecast job is running: standing aside" >> snapshot.log
  exit 0
fi
exec flock -n /tmp/hf-snapshot.lock nice -n 10 timeout 1h python3 hf/snapshot_hf.py >> snapshot.log 2>&1
