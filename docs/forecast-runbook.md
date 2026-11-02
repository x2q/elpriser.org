# EU price forecast: runbook

What runs on the Spark, what it writes, how to start it, how to stop it, what to watch. The research behind it is
[forecast-per-region.md](forecast-per-region.md); the model code is `scripts/forecast_model/eu/`.

## What it is

One daily job (`train_daily.py`, cron `15 15 * * *`) forecasts the day after tomorrow and up to seven days ahead for the 25 EU zones
`de fr pl it-n at be ch cz hu si es pt sk gr ro bg hr rs ee lv lt me mk al ie` (not `gb`, not `xk`, not the Nordic zones and NL, which have their
own forecast). Per zone and horizon D+2 .. D+7 it publishes the **recipe** below only where the research backtest says it was at least 5 % better
(MAE) than the naive "level + shape" method out of sample (the **gate**), with a P10 / P90 band and an honest **accuracy block**.

| zones | recipe | fuel inputs |
|---|---|---|
| all but EE, LV, LT | mean of a 365-day rolling ridge (per zone and horizon, refitted daily) and LightGBM | gas (MIBGAS day-ahead) and carbon (EEX EUA auction) |
| EE, LV, LT | the plain LightGBM (fuel does not help there) | none |

If the fuel inputs are not usable the same zones run the same recipe **without** them, under their own (smaller) set of horizons (`nofuel` in the gate).

KV keys written, nothing else (the job never touches `eu-prices-*`, `nordic-forecast-*`, `forecast-v3-*`):

* `eu-forecast-<zone>`, TTL 3 days: forecast days only (`type: "forecast"`, `horizon`, `min_eur_mwh`/`max_eur_mwh` = P10/P90), `model` `eu-ens-v2`,
  `trainedThrough`, and the `accuracy` block of exactly the horizons published. `/api/nordic` puts them after the settled days (and ignores a run older
  than 3 days, so a job that stops makes the forecast vanish by itself).
* `eu-forecast-archive-<zone>-<date>`, TTL 200 days: the run as published plus the model's uncorrected numbers and the level-correction shadow, for `monitor.py`.

## Files

Code and data that must sit flat in `~/eu-forecast` on the Spark (what is there from the first build is replaced; `price_*.parquet` and `w_prev_*.parquet`
are the caches and stay):

```
scripts/forecast_model/eu/*.py   except test_*.py and the research-only scripts you do not need daily (they are harmless to copy)
scripts/forecast_model/eu/publish_gate.json accuracy_eu.json calibration_eu.json      the three files that decide what is published
scripts/forecast_model/eu/run_daily.sh refresh_calibration.sh                          chmod +x
scripts/eu_prices/entsoe_parse.py energy_charts_parse.py                              flat next to fetch_prices.py (they are in the repo one directory over)
```

`accuracy_eu.json` and `calibration_eu.json` of the **first build are in another format** (no `version`): the new job treats such a file as absent, so copy the new ones
over them. Without `publish_gate.json` + `accuracy_eu.json` (version 2) the job publishes **nothing** and exits 2; without `calibration_eu.json` it publishes days without a band.

```
rsync -a --exclude 'test_*' --exclude __pycache__ scripts/forecast_model/eu/ cc@spark:~/eu-forecast/
rsync -a scripts/eu_prices/entsoe_parse.py scripts/eu_prices/energy_charts_parse.py cc@spark:~/eu-forecast/
```

Needs `lightgbm`, `scikit-learn`, `pandas`, `pyarrow`, `openpyxl` (EEX sheets) in the python3 the cron uses; all are already there.

## Environment

All from `~/.config/elpriser.env` (sourced by `run_daily.sh`; never echoed): `ENTSOE_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (KV write).
Optional: `EU_FORECAST_JOBS` (LightGBM threads, default 8), `EU_FORECAST_LAMBDA` (unset = the level correction stays a shadow; `0.5` publishes it),
`EU_FORECAST_NO_FUEL=1` (never fetch or use the gas and carbon inputs).
`GIE_API_KEY` is **not needed** (storage fill was not measured and is not used).

## First run

1. Copy the files (above). The tests (`test_*.py`, run by `npm run test:gate`) are not needed on the Spark.
2. Dry run, writes nothing to KV and takes about 7 minutes (2 minutes with `--skip-refresh`, from the caches; 7.7 GB of memory at the peak): `nice -n 10 python3 train_daily.py --dry-run`. Expect `FUEL on`, a line per zone ("would write ...
   with band"), and `DONE 25/25 zones`. `forecast_latest.json` holds what would have been published.
3. One real run by hand: `set -a; . ~/.config/elpriser.env; set +a; nice -n 10 python3 train_daily.py`. Check `https://elpriser.org/api/nordic?zone=de` (settled days, then
   forecast days with `horizon`, a band and `accuracy`) and a Spanish and a Latvian zone; look at the pages (`/de/strompreis`, `/ee/elektri-hind`).
4. Cron (the existing 11:30/11:45/14:00/14:15 price jobs, the SEMOpx and Elexon lines and the Nordic jobs stay as they are):

```
15 15 * * *  /home/cc/eu-forecast/run_daily.sh
30 3 * * 0   /home/cc/eu-forecast/refresh_calibration.sh        # optional but recommended: the band offsets, weekly (or monthly)
```

`run_daily.sh` appends to `daily.log`, takes `flock` (one run at a time), runs at `nice -n 10` and is killed after 2 hours (a run takes about 7 minutes).

## What the job does when something is wrong

| failure | behaviour |
|---|---|
| ENTSO-E price refresh fails for a zone | that zone uses its cached prices; if they are older than yesterday the zone is skipped ("nothing to publish (stale prices)") |
| live weather missing | whole run aborts before anything is written, exit 1 (the old keys expire after 3 days on their own) |
| MIBGAS or EEX fetch fails | the cache is used while the gas value is at most 3 days old (carbon: 6, it is auctioned on weekdays only) |
| fuel cache too old / absent / absurd | log line `FUEL off: <reason>`; the fuel zones run without fuel (`ens-nofuel`: ridge and LightGBM without the fuel features) under the gate's `nofuel` horizons (IT-N only D+2..D+4) and a band from the residual offsets; EE/LV/LT are not affected; nothing else aborts |
| gate or accuracy file missing / old format | nothing published, exit 2 |
| calibration file missing / old format | days published without a band |
| a zone's forecast has a NaN hour | that day is dropped (never patched); no accuracy numbers for a published horizon: the zone is skipped |
| KV write fails for a zone | that zone is skipped ("FAILED (non-fatal)"), the others go on |
| fewer than 20 zones written | exit 3 after writing what there is |

## What to alarm on

* `daily.log`: the last `DONE n/25 zones` line is missing for a day, or n < 20 (also exit code 3). `skipped:` names the zones.
* `FUEL off:` in the log for three days running (a source is blocked or changed its format; the forecast gets less accurate but stays honest).
* `WARNING: the newest training row is N days old`: a price source froze.
* Live accuracy: `python3 monitor.py --days 21` (needs the Cloudflare pair): per zone and horizon the live MAE against the backtest's, the live band coverage
  (`cover`), and exit 4 with `ALERT` when a cell with 10+ settled days is 1.5 times worse than its backtest. Compare `--field published` with `--field shadow`.
* On the site: a zone page without forecast days while `eu-forecast-<zone>` is missing means the key expired (job stopped) or the run was older than 3 days.

## Refreshing

* **Bands, weekly or monthly**: `refresh_calibration.sh` (about 15 minutes: dataset, fuel dataset, 2-month-fold quantile backtest, `calibrate_bands.py`); the new
  `calibration_eu.json` replaces the old one only when the whole chain succeeded. Error is not stationary: a band fitted before the September 2026 price shift
  covered 67-69 % of the hours afterwards.
* **Gate and accuracy, when the research is redone (quarterly, or when the live MAE alarm fires)**: rerun the research pipeline of
  [forecast-per-region.md](forecast-per-region.md) (`dataset.py`, `fuel_dataset.py`, `backtest.py` for `rel` and `rel+fuel`, `region_backtest.py`, `family_backtest.py`,
  `region_all.py`, `quantile_backtest.py`), then `python3 build_gate.py --regions regions/regions_all.parquet --quantile regions/backtest_q_fuel.parquet` and commit the two JSON files.
  Review `git diff` of the gate: a horizon that disappears is a decision, not an accident.
* `verify_parity.py` compares the production ridge with the research's `lear_r365_g` on the same days (they must agree to the cent).

## Rollback

* Stop publishing: remove the cron line. The keys expire in 3 days and the API then serves the settled prices alone, exactly as before the forecast existed.
* At once: delete the keys, `wrangler kv key delete --namespace-id 126700e66e8d4a19b289b0e8afdaff69 eu-forecast-<zone>` for the 25 zones (the API cache is 15 minutes, the page cache a few more); the archive keys can stay.
* One zone or horizon only: take it out of `publish_gate.json` (a prefix of horizons, D+2 first), copy the file, and delete that zone's key; the next run does not write it.
* The site code needs no change for any of this: pages and API are data-driven (a zone without forecast days draws as an actual-prices page).

## Known limits

* The day the clocks go forward (the last Sunday of March) has no 02:00 hour on the zone's local clock: the job drops that forecast day (a day with a missing hour is never
  patched) and the API then ends the forecast days at the hole. Once a year, harmless.
* A missing hourly price lag cannot be fed to the ridge, so the job replaces it by its training mean (zero contribution), for at most three of the six lag features of a row and never for
  weather, level or fuel features; the log says how many (`N missing price lags replaced`). Portugal and Ireland do this every day for hour 23: their last known day has no hour 23 (it belongs
  to the market day that is not published yet), while the training rows were built in hindsight. The backtest never imputed, so these hours are slightly less measured than the rest.
* If the ridge still has a gap after that (more than three lag features missing in an hour), the LightGBM alone stands in for the hour, so that no forecast day is lost: the API ends the
  forecast days at the first missing one. At most six hours of a day may do so; a day needing more is dropped. The log says `N hours from the LightGBM alone`.
* The accuracy block is a research number (backtest 2025-04-01 to 2026-11-02, models retrained every two months in the backtest, daily in production), not the live error;
  `monitor.py` is the live check. Two months of the September 2026 regime are in it: since then the forecast has been no better than the simple method at the price LEVEL
  (`bias` against `baseBias` in the block) and better at the shape and at ranking the hours.
* The band is measured, not promised: whole-backtest coverage is 76-83 % per zone and horizon, since 1 September 2026 63-93 % (median 73 %), stored as `coverage` and `coverageRecent`.
* Tomorrow's price is a settled price. If a zone's own price job is late, the API shows the settled days it has and the forecast joins only if it starts the day after them
  (otherwise the answer is the settled prices alone until the next run).

## Data licences (open)

MIBGAS (gas) and EEX (carbon) data are used **only as model inputs**: they are never shown, never part of a payload, never redistributed, and the pages and
the API text do not name them (`test-eu-forecast.mjs` pins that). Their licences have not been confirmed in writing (info@mibgas.es, auctions@eex.com): the research
report says to credit them wherever the methodology is described, so do that in any public methodology text once they have answered. If either says no: put
`EU_FORECAST_NO_FUEL=1` in `~/.config/elpriser.env` (the job then neither fetches nor reads the fuel data and runs every zone without fuel, `FUEL off: switched off`) and delete `fuel_daily.csv`.
