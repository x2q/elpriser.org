# EU price forecast: runbook

What runs on the Spark, what it writes, how to start it, how to stop it, what to watch. The research behind it is
[forecast-per-region.md](forecast-per-region.md); the model code is `scripts/forecast_model/eu/`.

## What it is

One daily job (`train_daily.py`, cron `15 15 * * *`) forecasts the day after tomorrow and up to seven days ahead for the 26 EU zones
`de fr pl it-n at be ch cz hu si es pt sk gr ro bg hr rs ee lv lt me mk al xk ie` (not `gb`; `xk` is Albania's price in 98 % of the hours, see [forecast-xk.md](forecast-xk.md); not the Nordic zones and NL, which have their
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
   with band"), and `DONE 26/26 zones`. `forecast_latest.json` holds what would have been published.
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

* `daily.log`: the last `DONE n/26 zones` line is missing for a day, or n < 20 (also exit code 3). `skipped:` names the zones.
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

## Coverage check: does every zone show its forecast?

`npm run forecast-coverage` (`scripts/check-forecast-coverage.mjs`) asks the public API (`/api/nordic?zone=<zone>`, no secrets) for all 40 price zones and prints, per zone, the settled day the forecast
joins, the forecast days and horizons shown, the horizons the gate expects, the age of the run, and PASS / WARN / FAIL / NO MODEL with the reason. Exit code 1 on a FAIL (`--strict`: on a WARN too);
`--zone de,at` limits it, `--json` prints the verdicts, `--base <url> --today <date>` points it at a local run. Run it after a deploy and whenever a zone page lacks its forecast.

It also prints, per zone, an explicit verdict for **D+2, D+5 and D+7** (the date today + n; the horizons the business lives by, see [forecast-d257-matrix.md](forecast-d257-matrix.md)): `shown`,
`gate` (blocked-by-gate: the gate or the owner's `forcedOff` does not let the horizon through; documented, never a failure), `due` (before 16:00 UTC the run on the API ends at D+6 because it was made
before tomorrow's prices were in; the 15:15 run brings D+7), `HIDDEN` (hidden-bug: allowed and missing) and `NO MODEL`. **Exit code 1 when a zone FAILs or lacks one of the three without a gate reason**
(HIDDEN or NO MODEL). `shown*` = shown without any per-horizon gate or accuracy block (the 13 Nordic zones, which have none).

* **PASS**: the top horizon the gate allows is shown, every horizon shown is allowed and has accuracy numbers, the run is at most one day old. A horizon the gate rejects is listed as
  *not published by design* (today: Albania h7, forced off in `publish_gate.json`) and is never a failure: do not "fix" it, and never lower the 5 % rule to make a row green.
* **FAIL, "no forecast shown"**: `eu-forecast-<zone>` is missing or older than 3 days, or its first day is not the day after the zone's last settled day. The Worker shows forecast days only without a hole
  after the settled prices (the apps stop at the first missing day), so a run that starts one day late is hidden whole. Look at the zone's last known day in `daily.log` ("h 2,3,..": h counts from it).
* **FAIL, "allows up to h7 but the API shows h2-6"**: the same one-day shift, seen from the other end (the window ends at today + 7).
* **NO MODEL**: Kosovo (`xk`) when the API shows no forecast for it. Kosovo went live in the 15:15 UTC run of 2026-11-08 (D+2..D+6, [forecast-xk.md](forecast-xk.md)); with a forecast on the API it is judged like every EU zone by its `publish_gate.json` entry (D+7 not published: `blocked-by-gate`). Without one it is a coverage gap in the exit code.
* **WARN**: the run is two days old (a night was missed), or the training data stops more than three days ago (a price source froze).

**The weekend shift (found 2026-11-08, fixed in `forecast.py`).** The job trains on ENTSO-E prices, the site's DE and AT prices come from Energy-Charts. On Fridays and Saturdays ENTSO-E already
held the auction of today + 2 for DE and AT at 15:15 UTC (the Monday auction on Saturday); Energy-Charts delivers it a day later. `build_rows` counted h from that later day, so the forecast started at
today + 3: the Worker found a hole and showed nothing for DE and AT, and h7 fell out of the window (5 days instead of 6). The job now never counts the last known day later than today + 1 (the
information state of every other zone, so h means what the backtest and the gate measured; `test_eu_forecast.py::test_a_cache_ahead_of_tomorrow_is_joined_at_tomorrow`). If DE or AT are hidden
again, compare `price_de.parquet`'s last day on the Spark with `eu-prices-de`'s.

The remaining race (the cache is a day ahead of the site's feed, or the site's price job runs after 15:15 UTC) is a price-source question, owned by the `price-sources` work; see
[forecast-d257-matrix.md](forecast-d257-matrix.md) for the root cause and the forecast-side options that were considered and left out.

## Rollback

* Stop publishing: remove the cron line. The keys expire in 3 days and the API then serves the settled prices alone, exactly as before the forecast existed.
* At once: delete the keys, `wrangler kv key delete --namespace-id 126700e66e8d4a19b289b0e8afdaff69 eu-forecast-<zone>` for the 26 zones (the API cache is 15 minutes, the page cache a few more); the archive keys can stay.
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

## The Netherlands: Nordic feed plus settled overlay

`nl` is NOT an EU zone: it is one of the 13 zones of the Nordic pooled model (`scripts/forecast_model/nordic`, cron 12:40 UTC, KV `nordic-forecast-nl`, 9 forecast days).
That job reads ENTSO-E once a day and the Dutch day-ahead results often reach ENTSO-E after that run (seen on 28, 29, 30 October and 2 November 2026; DK/NO/SE/FI were always
in), so for most of the day the feed served NL's today (and tomorrow) as model forecast. `build_entsoe_prices.py` therefore also writes `eu-prices-nl` (its `NORDIC_OVERLAY`, same
A44 request and parser, Amsterdam clock = CET/CEST like Copenhagen; the default run and `--zones nl` both do), and `/api/nordic?zone=nl` (`overlayNordicSettled`) lays those settled days
over the feed: a complete settled day replaces the same date, the feed's forecast days stay only from the day after the last settled day, consecutive (the `withEuForecast` contract).
Without `eu-prices-nl` the answer is the feed byte for byte. Rollback: remove `nl` from `NORDIC_OVERLAY` (or just let the key expire after 3 days).

## Data licences (open)

MIBGAS (gas) and EEX (carbon) data are used **only as model inputs**: they are never shown, never part of a payload, never redistributed, and the pages and
the API text do not name them (`test-eu-forecast.mjs` pins that). Their licences have not been confirmed in writing (info@mibgas.es, auctions@eex.com): the research
report says to credit them wherever the methodology is described, so do that in any public methodology text once they have answered. If either says no: put
`EU_FORECAST_NO_FUEL=1` in `~/.config/elpriser.env` (the job then neither fetches nor reads the fuel data and runs every zone without fuel, `FUEL off: switched off`) and delete `fuel_daily.csv`.

**Open weights (2026-11-03).** The fuel-FREE variant of this recipe is published on Hugging Face (`Elpriser/eu-price-forecast`, refreshed by a weekly snapshot job); the fuel-trained weights are held back for exactly this licence
question and a guard keeps them off the Hub. How, why and the licence audit of every source: [hf-publishing.md](hf-publishing.md). The estimate job's models (`Elpriser/gb-price-estimate`) are published the same way.

---

# The estimate job: hours that have no price yet (Great Britain, Portugal, Ireland)

A settled day can have hours without a price. **Great Britain** (`gb`): the Elexon Market Index Price is published hour by hour, so at 02:52 London time today has two hours and there is no tomorrow.
**Portugal and Ireland** (`pt`, `ie`): one hour behind CET, so the day-ahead auction leaves the last local hour (23) of the newest day to the next auction (published ~11:45-12:45 UTC): that day has 23 hours.
The estimate fills those hours with elpriser.org's own statistical model, labelled *Estimate*, never as a price: the settled `days[]` of `/api/nordic` are not changed, the estimate is a separate top-level
object, and a settled hour replaces it as soon as it exists. Code: `scripts/forecast_model/gb/`; API: `functions/_estimate.js` (`ESTIMATE_ZONES`, the one list; the job lists the same three, a test pins that).

## What is served

KV keys written (nothing else; never `eu-prices-*`, `eu-forecast-<other zone>`, `nordic-*`, `forecast-v3-*`; the existing `eu-forecast-*` job and its crontab line are not touched):

| key | TTL | content |
|---|---|---|
| `eu-estimate-gb` | 3 h | the hours of today without a settled price (hour `a` .. 23 at London clock hour `a`), `eur_mwh` (GBP/MWh, the field keeps its name), P10/P90 as `min_eur_mwh`/`max_eur_mwh`, `accuracy` of the as-of hour's class |
| `eu-forecast-gb` | 6 h | forecast days D+1 .. D+7 whose class passed the gate: the shape of every EU zone's `eu-forecast-<zone>` (`type: 'forecast'`, `horizon` = days from today, band, `accuracy.byHorizon`, unit GBP/MWh); joined after the settled days by the existing `withEuForecast` |
| `eu-estimate-pt`, `eu-estimate-ie` | 3 h | hour 23 of the newest day, band, `accuracy` (`hours: 1`) |
| `eu-estimate-archive-gb-<date>` | 200 d | the day's first run (for `monitor_gb.py`); every run is also kept on disk in `archive/` |

`/api/nordic?zone=gb` then answers: `days` (settled yesterday and today with null hours, then the forecast days D+1.. that passed), and `estimate`:

```json
"estimate": { "date": "2026-11-03", "type": "forecast", "scope": "partial-day", "model": "gb-est-v1", "generatedAt": "2026-11-03T03:12:04+00:00",
  "prices": [ { "hour": 3, "eur_mwh": 161.7, "min_eur_mwh": 148.66, "max_eur_mwh": 215.32 }, { "hour": 4, "eur_mwh": 161.07, "min_eur_mwh": 141.92, "max_eur_mwh": 214.89 } ],
  "accuracy": { "asOf": 2, "unit": "GBP/MWh", "baseline": "level+shape", "mae": 18.12, "baseMae": 24.7, "persistMae": 25.09, "gain": 0.266, "gainHold": 0.319, "gainRecent": 0.338,
                "biasRecent": -8.54, "coverage": 0.774, "coverageRecent": 0.642, "low": false } }
```

**Why a separate object (the contract).** The apps' parser (`tests/golden` `parseZone`) keeps complete days only and `daysFrom` stops at the first hole; `gb` is `apps: false`. Merging estimated hours into today's `actual` day would let any client that
ignores a flag read estimates as settled prices (and make an incomplete day look complete to the apps); a second `days` entry for today would double the date. A top-level `estimate` cannot change what an existing client sees:
`test-api.mjs` proves `parseZone`/`daysFrom` give the same answer with and without it, and that dropping the field gives the old answer byte for byte. Forecast days D+1.. use the contract the apps already handle for the EU zones (they join without a hole after the last settled day).
The API serves an estimate only if `generatedAt` is at most 3 hours old, for a day of the answer, hour by hour only where the settled day has no price, copied by field name, band on all hours or none; the cache is 5 minutes for these zones.

## Great Britain: method and measured accuracy

*Rows*: for each as-of day `D`, as-of hour `a` (the job's clock hour; the hours `0..a-1` of `D` are finished) and target (the rest of today `k=0`, then `k=1..7`): level + shape (the EU model's naive method: mean of the last 7 complete days + the profile of the same hour 7/14/21/28 days earlier minus its own mean),
the realised residuals of today's hours against it (`rho1`, `rho3`, mean) with a decay in the hours ahead, calendar (England and Wales bank holidays), lags, and the weather as issued `max(1, k)` days before (Open-Meteo previous-runs, three points: Scotland/North Sea wind, the Midlands, the southern North Sea).
Leakage rule (pinned by `test_gb.py`): a price lag of `l` days exists only if that day is complete; day statistics end at `D-1`; today enters only through finished hours; nothing from the future moves any feature.
*Candidates*: **A** level+shape; **B** intraday update (B-simple: add the last three hours' residual fading with the hours ahead; B-mult: scale the shape by realised/expected; B-ridge: a ridge on the realised residuals per as-of hour and day offset); **C** the EU recipe retrained on Great Britain with the intraday features
(mean of a 365-day ridge and a LightGBM on the residual of level+shape). **Published: C.** The tree model gets no absolute price level (a version with them was 17-25 GBP/MWh too low after the September 2026 shift: `exp_lgb.py`).
*Backtest*: 2025-04-01 .. 2026-11-03, rolling origin, two-month folds, everything refitted at a fold start on targets settled before it; as-of hours 0, 2, 5, 8, 11, 14, 17, 20; D+k pooled over as-of 02/08/14. Hold-out 2026-07-01 ..; shift 2026-09-01 ..
(prices went from ~70-100 to 130-210 GBP/MWh around then). MAE in GBP/MWh, all / hold-out / since 1 Sept 2026 (`score_gb.py`):

| class | persistence | level+shape (A) | B-simple | B-ridge | C ridge | C LightGBM | **C = published** | gain vs A (all / hold-out / since Sept) |
|---|---|---|---|---|---|---|---|---|
| rest of today, as-of 02 | 25.1 / 34.6 / 42.4 | 24.7 / 36.2 / 46.1 | 21.5 / 31.2 / 38.3 | 19.6 / 27.5 / 32.3 | 19.1 / 25.6 / 30.2 | 19.3 / 26.5 / 33.5 | **18.1 / 24.7 / 30.5** | 27 % / 32 % / 34 % |
| rest of today, as-of 08 | 25.7 / 36.6 / 43.5 | 25.6 / 38.5 / 48.0 | 21.8 / 32.5 / 39.8 | 19.9 / 27.8 / 33.8 | 19.4 / 26.5 / 31.7 | 19.7 / 28.1 / 35.3 | **18.4 / 25.8 / 32.3** | 28 % / 33 % / 33 % |
| rest of today, as-of 14 | 22.2 / 29.3 / 36.0 | 23.7 / 33.5 / 43.0 | 18.4 / 24.1 / 30.2 | 17.3 / 21.5 / 27.6 | 16.6 / 20.4 / 25.6 | 18.0 / 24.5 / 31.8 | **15.7 / 20.7 / 26.9** | 34 % / 38 % / 38 % |
| rest of today, as-of 20 (4 h) | 17.6 / 20.3 / 27.5 | 20.9 / 28.0 / 38.5 | | | | | **12.0 / 15.4 / 20.2** | 42 % / 45 % / 48 % |
| D+1 (tomorrow) | 28.3 / 39.3 / 50.5 | 25.2 / 37.1 / 47.8 | 25.1 / 36.8 / 47.4 | 24.1 / 34.3 / 43.4 | 21.4 / 28.3 / 35.3 | 19.8 / 27.3 / 34.6 | **19.7 / 27.0 / 34.4** | 22 % / 27 % / 28 % |
| D+2 | 29.8 / 42.3 / 54.1 | 25.6 / 37.8 / 49.1 | = A | 25.4 / 36.7 / 48.0 | 21.5 / 28.9 / 36.0 | 20.0 / 28.3 / 35.9 | **19.7 / 27.6 / 35.1** | 23 % / 27 % / 29 % |
| D+3 | 30.5 / 44.8 / 58.6 | 25.7 / 38.3 / 49.5 | = A | 25.7 / 37.9 / 49.2 | 22.1 / 30.4 / 37.6 | 20.2 / 29.3 / 36.8 | **20.2 / 28.9 / 36.4** | 22 % / 24 % / 26 % |
| D+4 | 30.1 / 45.0 / 56.7 | 25.8 / 38.1 / 48.7 | = A | 25.8 / 38.0 / 48.5 | 22.6 / 30.9 / 37.9 | 20.7 / 29.7 / 36.4 | **20.7 / 29.3 / 36.3** | 20 % / 23 % / 25 % |
| D+5 | 30.2 / 46.0 / 61.1 | 25.8 / 37.4 / 46.7 | = A | 25.7 / 37.4 / 46.5 | 23.2 / 31.8 / 38.1 | 21.1 / 30.0 / 35.8 | **21.2 / 29.9 / 36.1** | 18 % / 20 % / 23 % |
| D+6 | 29.6 / 42.7 / 55.3 | 25.8 / 36.3 / 44.6 | = A | 25.6 / 36.7 / 46.0 | 23.6 / 33.5 / 41.1 | 22.2 / 31.2 / 38.2 | **22.2 / 31.7 / 39.0** | 14 % / 13 % / 13 % |
| D+7 | 30.5 / 43.5 / 54.6 | 26.1 / 35.5 / 43.6 | = A | 25.9 / 35.4 / 44.5 | 24.4 / 33.0 / 40.9 | 22.2 / 30.9 / 38.3 | **22.5 / 31.0 / 38.8** | 14 % / 13 % / 11 % |

The other as-of hours (0, 5, 11, 17) lie between these (gains 21-42 %, in `gb_gate.json`). The prices of these months average 70-210 GBP/MWh, so 18-22 GBP/MWh is an error of roughly 10-25 % of the price. The intraday part of B adds nothing beyond today (B = A from D+2),
and the weather and calendar features carry all of the gain at D+1 and later.

**Gate** (`gb_gate.json`, from `build_gate_gb.py`): a class is published only if its MAE is at least 5 % below level+shape on the whole backtest **and** on the hold-out, and not above persistence (a guard: level+shape is a weak baseline in a rising market).
**All 8 as-of classes of the rest of today and all of D+1 .. D+7 pass.** D+7 passes the 5 % rule but its "ranks the cheapest hours better" claim does not (3.9 %, `rankOk: false`: the page does not make it); nothing is `low` (>= 10 % in every window).
What the backtest does *not* flatter: **since 1 September 2026 the estimate has run 3-13 GBP/MWh too low on average** (rising prices; `biasRecent`, -9 for tomorrow, -13 at D+7) and **the P10-P90 band covered 77-81 % of the hours over the whole backtest but only 61-71 % since September**
(`coverage`, `coverageRecent`): the band is measured, never promised; refresh `gb_calibration.json` monthly (`refresh_gate.sh`). The numbers are a research result, not the live error (`monitor_gb.py` is the live check).
The live job uses the current weather forecast (fresher than the backtest's `previous_day1` for today).

## Portugal and Ireland: the missing hour 23

`hour23.py`, `backtest_hour23.py` -> `hour23_gate.json`. The hour is estimated from the same day's hours 0..22 and the earlier days: **persistence** of hour 22, or hour 22 plus the **median step** (hour 23 - hour 22) of the last 28 days. Backtest 2025-04-01 .. 2026-11-02 on the EU job's ENTSO-E caches
(about 580 days each), MAE in EUR/MWh, all / hold-out / since Sept:

| zone | mean price | persistence | median-step | yesterday's h23 | last week's h23 | published | band coverage (all / since Sept) |
|---|---|---|---|---|---|---|---|
| `pt` | 98 | 8.5 / 8.7 / 10.6 | 8.2 / 8.8 / 10.8 | 16.8 | 26.2 | **persistence** (no gain claimed) | 83 % / 71 % |
| `ie` | 125 | 18.3 / 22.4 / 23.9 | 16.5 / 20.8 / 23.3 | 34.0 | 37.9 | **median-step**: 9.7 % / 7.1 % / 2.6 % better than persistence | 81 % / 75 % |

The method is chosen before the hold-out (2025-04 .. 2026-06) and must not be worse than the best naive method on the whole backtest and on the hold-out; Portugal's median-step lost on the hold-out (-1 %), so Portugal publishes persistence itself, the naive method, and says so (`gain` 0).
A ridge on the last prices and the step history was no better (-8 % on Portugal's hold-out). The band is the rolling residual band (1.2 x the 10th / 90th percentile of the method's own error over the last 180 days, computed in the job from the cache).

## Files (flat in `~/gb-estimate` on the Spark)

```
scripts/forecast_model/gb/*.py *.json *.sh               except test_gb.py and the research scripts (harmless to copy): the job, the models, gb_gate.json, gb_calibration.json, hour23_gate.json
scripts/forecast_model/eu/fetch_weather.py zones.py metrics.py kv.py                              the EU job's helpers (flat next to the gb files; they are NOT changed)
scripts/eu_prices/elexon_parse.py build_elexon_prices.py build_eu_prices.py energy_charts_parse.py       the Elexon parser the price job uses
```

Data it creates: `price_gb.parquet` (hourly MID since 2023-01-01, Elexon BMRS, pulled at 6 days per request), `w_prev_gb_<i>.parquet` (Open-Meteo previous-runs weather), `models/gb_models.pkl`, `hist_pt|ie.parquet` (seeded once by a read-only copy of
`~/eu-forecast/price_pt|ie.parquet`), `archive/`. Needs `lightgbm`, `pandas`, `pyarrow`, `numpy`; all are on the Spark. Environment: the Cloudflare pair in `~/.config/elpriser.env` (never echoed); Elexon and Open-Meteo need no key.
No new data source: no gas (Great Britain's is NBP, not among the licensed inputs: not used), no ENTSO-E key. Licences: the history is BMRS data under the Elexon licence ("Contains BMRS data (c) Elexon Limited copyright and database right 2026", already on the page); the estimate is a derived statistical figure and is labelled as elpriser.org's own, not the Elexon number.

## Rollout (the owner or the lead; nothing here has been done)

1. Copy: `rsync -a scripts/forecast_model/gb/ cc@spark:~/gb-estimate/ --exclude 'test_*' --exclude '__pycache__' --exclude 'exp_*' --exclude 'score_gb.py'` plus the eight helper files above; `chmod +x ~/gb-estimate/*.sh`. (A dry-run copy with the caches already built is in `~/gb-research` on the Spark: copying `price_gb.parquet` and `w_prev_gb_*.parquet` from there saves the 15-minute first pull.)
2. Train: `cd ~/gb-estimate && nice -n 10 python3 train_gb.py` (about 30 s with the caches, ~15 min the first time).
3. Dry run (writes no KV, needs no credentials): `python3 run_estimate.py --dry-run` (also `--asof-hour 14 --skip-refresh` and `--zones pt,ie`). Expect `gb: would write eu-estimate-gb ... with band`, `would write eu-forecast-gb: days D+1,2,3,4,5,6,7`, and one line each for pt and ie.
4. Deploy the site (the API reads the new keys; absent keys change nothing, so this can go first), then one real run by hand: `set -a; . ~/.config/elpriser.env; set +a; python3 run_estimate.py`, and look at `https://elpriser.org/api/nordic?zone=gb` (`estimate`, then forecast days with `horizon` and `accuracy`) and the three pages (`/gb/electricity-price`, `/pt/preco-eletricidade`, `/ie/electricity-price`).
5. Cron (the existing lines stay; `:12` is five minutes after the Elexon job at `:07`):

```
12 * * * *   /home/cc/gb-estimate/run_hourly.sh
25 3 * * *   /home/cc/gb-estimate/train_daily.sh
```

KV writes: at most ~50 a day (`eu-estimate-gb` and `eu-forecast-gb` every hour; pt/ie only when the hour or the age (100 min) changes). Elexon requests: one extra per hour (the last 3 days); the :07 job's are unchanged.

## What the job does when something is wrong

| failure | behaviour |
|---|---|
| Elexon refresh fails | the cached prices are used; if the newest is older than yesterday: gb skipped ("stale"), nothing written, the keys expire in 3 h |
| live weather missing | gb skipped, nothing written (a row without weather is never predicted) |
| models missing or older than 3 days | gb skipped; run `train_gb.py` |
| `gb_gate.json` / `gb_calibration.json` missing or not version 1 | gb skipped, exit 2 |
| a class not in the gate | not published (the rest of today per as-of hour, each forecast day on its own) |
| a forecast day with a NaN hour | that day is dropped, never patched; the estimate is cut at the first missing hour |
| pt / ie: `/api/nordic` unavailable, or the newest day is not "hours 0..22 priced, hour 23 missing" | that zone skipped |
| KV write fails | that zone is skipped ("FAILED (non-fatal)"), the others go on; exit 3 only if every zone failed |

Alarm on: no `DONE` line in `estimate.log` for 3 hours; `python3 monitor_gb.py` (live MAE per class against the backtest, `ALERT` and exit 4 at 1.5 x with 10+ settled days); on the site: the *Estimate* legend missing while the key is there.

## Rollback

Remove the cron line: `eu-estimate-*` expire in 3 hours and `eu-forecast-gb` in 6, and the API serves the settled prices alone (a page without `estimate` and without forecast days is the page as before). At once: `wrangler kv key delete --namespace-id 126700e66e8d4a19b289b0e8afdaff69 eu-estimate-gb` (and `eu-forecast-gb`, `eu-estimate-pt`, `eu-estimate-ie`). One class: set `publish: false` in `gb_gate.json` and copy it.
