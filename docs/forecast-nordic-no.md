# Nordic zones: an honest gate table and a better Norway (research of 2026-11-08; staged on the branch `nordic-no`, nothing rolled out)

Question (owner, 2026-11-08): the 13 Nordic zones are published without a gate and without an accuracy block, and the earlier research (`forecast-d257-matrix.md`) showed that the production Nordic
model fails the 5 % rule against level+shape in all five Norwegian zones (NO5 is 9-20 % WORSE than the naive method). Why, and can Norway be improved honestly?

**Answer in five lines.** (1) The production model's DAY LEVEL is worse than "the mean of the last 7 days" in Norway, its intraday shape is 7-10 % better; the level error is a persistent negative bias (-14..-19 EUR/MWh in
NO1/NO2/NO5 since September). (2) Cause: a tree on the raw price with calendar features memorises last year's price for the same date and cannot extrapolate into a regime it has not seen (Norway's south went from ~70 to ~120 EUR/MWh in 2026;
history is 2.6 years). (3) The EU recipe (730-day ridge + LightGBM on price minus level_7d, fuel inputs) fixes it: **NO1, NO2, NO3, NO5 pass the gate at every horizon D+2..D+8 (whole backtest and hold-out, 9-29 %)**.
(4) **NO4 does not pass at any horizon** (hold-out gain -1..+3.5 %, whole backtest 4-12 %): it sits at 20 EUR/MWh in the hold-out and level+shape is nearly perfect there; nothing tried fixes it honestly.
(5) All 13 zones can get a gate and an accuracy block from the same scorer; files and code are on the branch (84 of 91 zone-horizons would be published, NO4's 7 are the missing ones).

Scripts: `scripts/forecast_model/nordic/research_no/` (`nfr.py` frame and candidate runners, `score_nfr.py` the gate scorer, `build_gate_nordic.py`, `calibrate_nordic.py`, `report_nfr.py` bootstrap and quarters, `diag*.py`, `verify_parity_nordic.py`).
Everything ran on the Spark in `~/nordic-no-research` and `~/nordic-no-stage` (copies; `~/nordic`, `~/eu-forecast`, `~/prognose3`, the crontab, KV and the Worker were not touched; no push, no deploy).

## 1. Protocol (the EU gate's, unchanged)

Rolling origin from 2025-04, two-month folds for LightGBM and weekly refits for the ridge (`family_models.lear_block`), a fold's targets never in its training set, baseline = level+shape (`level_7d` + the `seasonal4w` profile),
MAE and regret (the 3 cheapest hours against the 3 cheapest, `metrics.regret`) from `region_scores.score`, periods whole backtest 2025-04-01..2026-10-31 (the Nordic dataset ends 10-31; the EU frame 11-02), select ..2026-06-30, hold-out 2026-07-01.. .
**The 5 % rule: a zone-horizon is published only if both the whole-backtest and the hold-out gain are >= 5 %.** Leakage rule of the dataset (price lag k only if k >= h-1; day statistics end at the last known day; weather as issued at lead min(h,7)).
Every candidate is scored on the rows where all compared columns exist. Horizons D+2..D+8 (`h` = days from the last known day + 1; the Nordic job publishes D+8, the EU frame stopped at D+7).
Candidates were declared before the runs (see the list in section 4; two additions made after seeing results are marked). Selection among candidates used the select period; the hold-out never chose.

## 2. The honest 13-zone table: the production model (`p0`, re-run on h 2..8, trained on h 2..9 as the cron does)

Gain % over level+shape, **whole backtest / hold-out** (`*` = passes the 5 % rule on both). Regret gain (the owner's metric) in the last block.

| zone | D+2 | D+3 | D+4 | D+5 | D+6 | D+7 | D+8 |
|---|---|---|---|---|---|---|---|
| dk1 | 21.3/24.0* | 20.5/23.6* | 18.4/22.0* | 15.7/20.0* | 12.5/16.2* | 12.1/15.2* | 12.2/13.7* |
| dk2 | 22.3/25.3* | 21.7/24.5* | 19.9/22.9* | 16.9/19.8* | 13.9/16.2* | 13.4/14.5* | 13.4/12.8* |
| no1 | -0.5/1.7 | -2.4/-3.2 | -2.2/-4.4 | -4.5/-8.1 | -3.2/-9.8 | -2.8/-9.4 | -1.4/-9.3 |
| no2 | -0.2/8.6 | -2.0/4.4 | -1.9/3.9 | -4.7/2.1 | -5.2/-0.3 | -5.0/-0.6 | -4.6/-2.2 |
| no3 | -3.7/10.4 | -3.5/8.5 | -3.0/9.7 | -4.0/7.3 | -2.8/6.5 | -1.0/4.1 | 1.2/4.1 |
| no4 | -4.2/-9.7 | -2.7/-8.1 | -1.8/-6.8 | -2.0/-9.7 | -1.1/-9.7 | 0.6/-12.5 | 2.7/-10.6 |
| no5 | -16.7/-11.4 | -17.6/-15.4 | -14.6/-15.1 | -15.9/-19.3 | -12.7/-18.1 | -10.3/-16.8 | -7.7/-15.3 |
| se1 | 12.7/16.0* | 12.9/13.5* | 13.0/13.5* | 12.1/9.9* | 11.9/6.6* | 11.8/6.3* | 12.5/6.1* |
| se2 | 11.2/17.9* | 11.3/16.2* | 11.4/16.0* | 10.5/14.5* | 9.7/10.1* | 9.7/11.5* | 10.6/12.3* |
| se3 | 23.6/26.0* | 23.0/24.6* | 21.6/24.0* | 19.3/19.2* | 18.4/17.8* | 17.2/14.6* | 18.2/14.9* |
| se4 | 22.6/22.4* | 21.7/20.4* | 20.5/20.0* | 17.8/17.0* | 16.4/16.1* | 15.4/14.9* | 15.9/14.7* |
| fi | 16.4/18.6* | 16.8/17.0* | 17.0/17.1* | 15.9/14.7* | 15.7/11.3* | 15.1/9.9* | 16.4/10.2* |
| nl | 18.2/20.2* | 16.3/16.8* | 15.3/15.2* | 13.2/13.1* | 10.1/11.5* | 9.8/10.1* | 9.7/8.6* |

(The earlier matrix numbers for Norway, e.g. NO1 D+2 2.3/2.7, came from a run trained on h <= 7 and scored on a different row set; both say "fails". Production fails 35 of 35 Norwegian cells on at least one of the two periods and passes 56 of 56 elsewhere.)
Regret gain, whole / hold-out, the production model: positive almost everywhere (D+2: 12-24 % / 6-25 %); NO5 is the exception (D+4 .. D+8 hold-out -2.6..1.4 %), NL D+4 hold-out -6.8 %, SE4 D+6 -1.5 %, DK2 D+7/D+8 -6.3/-5.5 %. So the model ranks hours better than level+shape even where its level is bad.

## 3. Why Norway is bad: diagnosed

Level vs shape, D+5, whole backtest, MAE EUR/MWh of the DAY-LEVEL error / within-day SHAPE error / mean bias since 2026-09-01 (forecast - actual), level+shape | production | the ensemble recipe of section 5
(`diag5.py`; D+2 and D+7 look the same):

| zone | mean price | level+shape | production | ensemble |
|---|---|---|---|---|
| no1 | 83.3 | 18.6 / 12.0 / -0.4 | 19.8 / 10.9 / **-17.5** | 15.6 / 11.2 / -1.4 |
| no2 | 88.9 | 18.7 / 11.8 / -1.3 | 19.7 / 11.0 / **-18.7** | 16.0 / 11.1 / 0.3 |
| no3 | 54.1 | 15.8 / 9.0 / 3.3 | 17.1 / 8.4 / -10.3 | 14.3 / 8.5 / 0.5 |
| no4 | 21.8 | 12.8 / 7.1 / -0.6 | 13.8 / 6.4 / -3.1 | 12.5 / 6.5 / -0.4 |
| no5 | 76.9 | 15.3 / 8.8 / 0.2 | 18.0 / 8.1 / **-16.8** | 13.6 / 8.2 / -0.2 |

* **It is a LEVEL problem, not a shape problem.** The level error (day mean) is 13-20 EUR/MWh against a shape error of 7-12; the production model's shape is 7-10 % better than level+shape in all five zones, its level is 2-18 % worse (NO5 18.0 vs 15.3 at D+5).
* **The level error is a bias.** Production runs 14-19 EUR/MWh too low in NO1, NO2, NO5 since September; in March 2026 it sat at 55-65 EUR/MWh while NO1 cleared at 90-130 (-45 EUR/MWh for the month), in July 2026 -29..-39. level+shape has no bias in any of these months (`diag2.py`, `diag3.py`).
* **Why (tested, not guessed; pooled over NO1-NO5 and D+2..D+7, mean gain %, select / hold-out):**

| test | result | verdict |
|---|---|---|
| raw price target -> target = price - level_7d (same pooled 13-zone tree, same data; fuel added) | -6.2 / -4.2 -> 2.0 / 5.7 | **the target is the main cause**: a tree on raw price must reproduce the level from calendar and reservoir columns and cannot extrapolate beyond what it has seen |
| drop month and doy from the tree | select 2.0 -> 4.0, hold-out 5.7 -> 2.3 | the date columns let it memorise last year; the effect is real but not stable, so not shipped |
| pooled 13 zones -> Norway only (`lrelno`) | 2.0 / 5.7 -> 2.0 / 9.8 | **pooling is not the problem** (select equal; hold-out better for the Norway-only tree, within the seed noise of about 1 point) |
| fuel inputs in the ridge off (`r365nofuel`) | 2.0 / 10.0 -> 2.6 / -0.1 | fuel helps the hold-out regime (gas rising with prices), not the select period |
| ridge window 365 -> 730 days | 2.0 / 10.0 / 4.8 -> 4.5 / 13.0 / 7.6 (select / hold / whole) | **longer history helps** (730 chosen on the select period); history is only 2.6 years, the window is complete from 2026-03 |
| fundamentals in the model: snow-store and 30-day rain proxy of the weather as issued, leak-free reservoir, 4-week change | ridge with them: select -11..-18; tree with them (`lrel13x`): 5.7 vs 5.2 without | **no gain**: the hydrology proxies hurt the ridge and add 0.5 to the tree; in the ensemble they add nothing (11.8 vs 11.8) |
| cross-zone context (continental / Norwegian / Swedish / bordering-zone levels) | tree select 2.0 -> 5.2-5.4; ridge select 4.5 -> 2.4-3.2; ensemble 10.1 -> 11.4-11.8 select, hold-out 17.5 -> 15.8-16.2 | helps the tree alone, ~neutral in the ensemble: not shipped (more code, no hold-out gain) |
| reservoir look-ahead | the dataset's reservoir columns use the whole series' maximum and weekly medians (they contain the future); leak-free versions: tree 2.0 -> -0.9 select, ensemble 10.1 -> 9.2 select, 17.5 -> 17.0 hold-out | the look-ahead is real (about 3 points of the tree alone, ~1 of the ensemble); **the shipped recipe uses the leak-free columns** |

* **Not an administered-water-value or weather-irrelevance story that the data can show:** adding reservoir state (A72, weekly, per NO bidding zone: all five NO zones are published back to 2021-12) was already in production and did not stop the bias; the snow/rain proxies do not help.
* **Why NO4 is different:** its price is 21.6 EUR/MWh on average in the hold-out (36 % of the hours <= 5 EUR/MWh over the whole backtest), flat, with spikes in the winter; daily level+shape is nearly exact there, so any model's noise costs more than its signal gains.
  Its correlation with SE1/SE2 daily means is 0.85-0.86 but prices are not coupled hour by hour; summer 2025 quarter gains are -48..-90 % (level+shape error 1-3 EUR/MWh).

## 4. Candidates (pooled over NO1-NO5 and D+2..D+7, mean gain % over level+shape; cells = zone-horizons passing both gates of 30)

| candidate | select | hold-out | whole | cells |
|---|---|---|---|---|
| `p0` production (hybrid / raw) | -5.8 / -6.2 | -4.0 / -4.2 | -5.0 / -5.4 | 0 |
| `lrel13` tree, rel target, pooled 13 | 2.0 | 5.7 | 3.2 | 6 |
| `lrelno` tree, Norway only | 2.0 | 9.8 | 4.3 | 14 |
| `lrel13nc` / `z` / `nb` / `x` / `lf` / `lrelnox` / `lrelnonb` | 4.0 / 5.2 / 5.4 / 5.7 / -0.9 / 2.5 / 4.1 | 2.3 / 6.9 / 7.8 / 6.2 / 7.9 / 9.5 / 7.4 | 4.0 / 5.9 / 6.3 / 6.1 / 1.7 / 4.7 / 5.3 | 11 / 18 / 15 / 20 / 4 / 12 / 12 |
| `r365` ridge, 365 d | 2.0 | 10.0 | 4.8 | 17 |
| `r730` ridge, 730 d | 4.5 | 13.0 | 7.6 | 21 |
| `r730xz` / `r730nb` / `r730xzh` | 2.4 / 3.2 / -10.8 | 13.0 / 13.1 / 12.9 | 6.0 / 6.7 / -3.6 | 17 / 20 / 6 |
| `r365nofuel`, `r365xzh`, `r365xzhr`, `r365hr` | 2.6, -12.4, -17.7, -14.8 | -0.1, 7.0, 6.9, 5.6 | 2.5, -6.2, -10.1, -8.4 | 10, 6, 4, 5 |
| level+shape + `r730`, 50/50 (shrunk; **added after the r730 result**, precedent `ens_lb` of the EU research) | 9.2 | 10.9 | 9.9 | 24 |
| **ensemble `r730 + lrel13`** (mean) | **10.1** | **17.5** | **12.3** | **30** |
| ensemble with `r365` | 10.1 | 16.1 | 11.8 | 27 |
| ensemble `r730 +` `lrel13z` / `nb` / `x` / `nc` / `lrelno` / `lrelnonb` | 11.8 / 11.4 / 11.8 / 11.0 / 10.9 / 11.6 | 16.0 / 16.2 / 15.1 / 14.4 / 17.2 / 15.8 | 13.3 / 13.1 / 13.2 / 12.4 / 13.0 / 13.2 | 24 each |
| hybrid (50/50 seasonal shape, the production post-processing) of the ensemble | 9.7 | 17.1 | 11.9 | 28 |
| **shipped: hybrid of `r730lf + lrel13lf`** (leak-free reservoir; **chosen for honesty and simplicity, NOT the select maximum**) | 8.8 | 16.5 | 11.2 | 24 (NO1,2,3,5 all 24, NO4 0) |
| same, second LightGBM seed | 9.6 | 15.0 | 11.4 | 24 (same cells) |
| shipped + level correction (lambda 0.5, 14 days, `level_correction.py`) | 9.5 | 16.0 | 11.4 | 24 |

* **The ensemble is what works**: the ridge (linear, extrapolates, sees the gas gap) and the tree (shape, interactions) make different errors; each alone passes 6-21 of 30 cells, the mean passes 24-30. Equal weights, nothing fitted.
* Level correction: no gain (select +0.7, hold-out -0.5, since September -4) - not used. The ensemble has no bias to correct (section 3).
* Variants of the ensemble differ by 2-3 points on select and 1-2 on the hold-out in opposite directions, which is the size of the seed noise (about 1 point): I did not chase the select maximum. The cross-zone variants would be a possible extension.
* Two decisions were made after seeing results and are disclosed: the 50/50 hybrid (because the owner judges by regret: the plain ensemble ranks hours worse than production in DK/NL at D+4..D+8, the hybrid keeps regret at production's level) and the leak-free reservoir (because the look-ahead check above).
  The 730-day window was chosen on the select period (4.5 vs 2.0), as the ridge is data-starved.
* **Not tried, and why:** GloFAS discharge forecasts need an EWDS account (creating one is not something the research could do) - the snow/rain proxy above is the free stand-in and did not help; the ECMWF IFS ensemble archive (dynamical.org, from 2024-04-01) would need per-init-time reads of 51-member 17 MB chunks
  for ~950 days and seven points (order of 100 GB) and the same number daily in production: not attempted; ENTSO-E outages and flows: no as-issued history retrievable without a token-authenticated vintage test, and the neighbour-price columns (which carry the same information with a lag) added ~0 to the ensemble;
  ENTSO-E reservoir A72 for NO1-NO5 exists per bidding zone (weekly, back to 2021-12) and is used (the dataset's version and the leak-free one); a per-zone Norway tree beat the pooled one only on the hold-out, within noise.

## 5. What the shipped recipe achieves (hybrid of `r730lf + lrel13lf`, gain % over level+shape, whole backtest / hold-out; select in the files' regret/low flags)

| zone | D+2 | D+3 | D+4 | D+5 | D+6 | D+7 | D+8 |
|---|---|---|---|---|---|---|---|
| no1 | 19.1/27.7 | 16.0/23.6 | 13.8/23.7 | 11.9/21.9 | 11.3/19.2 | 10.1/15.1 | 9.6/12.8 |
| no2 | 18.9/28.8 | 15.5/26.7 | 13.5/26.4 | 11.7/24.3 | 11.5/23.5 | 9.0/20.0 | 8.0/18.4 |
| no3 | 16.0/22.7 | 11.8/19.4 | 10.2/19.3 | 9.7/19.4 | 8.8/17.6 | 9.9/16.6 | 10.0/16.6 |
| no4 | 12.1/**3.5** | 8.9/**1.6** | 7.0/**1.9** | 5.0/**-0.8** | 4.1/**-0.4** | 5.5/**0.4** | 5.3/**-0.2** |
| no5 | 16.6/24.2 | 11.6/17.3 | 10.2/16.5 | 9.3/13.9 | 8.1/11.1 | 9.3/9.7 | 9.6/8.5 |

Day-block bootstrap of the hold-out gain (90 % interval, 1000 resamples of whole days; `report_nfr.py`): NO1 D+2 23.3-32.0, D+7 10.4-19.1; NO2 D+5 20.3-28.0; NO3 D+7 12.7-20.3; NO5 D+7 **4.8**-13.9 (the thinnest pass), NO4 D+2 -4.6..9.7, D+5 -7.4..5.0.
Quarters (`report_nfr.py`): the gains are **concentrated in 2026 Q3-Q4**, when southern Norway's price rose by 60 %; in 2025 Q4 - 2026 Q2 they are 2-17 % and sometimes below zero for single quarters
(NO2 2026 Q1 -3.4 % at D+5, NO3 2025 Q3 -7 %). The honest reading: the ensemble is at least as good as level+shape in every regime of the backtest on average, and much better when the level moves; if the regime reverses the gain will shrink toward the whole-backtest figures (8-12 %), not to zero.
The whole-backtest figures above are the ones the gate uses next to the hold-out.
Regret (3 cheapest hours): whole / hold-out gain for D+2 / D+5 / D+7: NO1 18.6/19.2, 13.4/11.6, 7.7/4.8; NO2 13.1/8.6, 7.8/4.4, 7.2/10.2; NO3 13.5/14.7, 9.3/8.8, 3.9/3.9; NO5 17.6/15.5, 6.9/5.9, 10.3/12.9 - production for NO5 had a hold-out regret gain of -2.6..1.4 % at D+4..D+8 (it ranked hours no better than level+shape there), for the other three the two are roughly equal.
All 13 zones with this recipe (research only; the staged job keeps the pooled model for the other 8): it would raise DK1 D+2 from 21.3/24.0 to 26.4/30.2 and NL D+7 from 9.8/10.1 to 15.2/22.1, but would LOSE the gate for FI D+6..D+8 (hold-out 1.9, -1.9, -2.4 against 11.3, 9.9, 10.2 for the pooled model); FI is the one zone where the ridge is poor.

## 6. All 13 zones get a gate and an accuracy block (what is on the branch)

* `scripts/forecast_model/nordic/publish_gate_nordic.json` (zone -> recipe `ens` | `pooled`, horizons), `accuracy_nordic.json` (the EU `accuracy_eu.json` cell, per zone and horizon: mae, baseMae, gain, gainHold, gainRecent, bias, baseBias, regret, baseRegret, rankGain, rankOk, coverage, coverageRecent, low, days),
  `calibration_nordic_v2.json` (P10/P90 offsets: 180 days x 1.2, the EU 'residual' recipe, per zone and horizon). Built by `research_no/build_gate_nordic.py` and `calibrate_nordic.py` with the EU scorer (`region_scores`, `build_gate.cell` and `coverage_table`), the rule unchanged.
  Recipe per zone: `ens` for NO1-NO5, `pooled` (= production) for the other eight; the gate publishes **84 of 91** zone-horizons: every cell of the 12 zones, none of NO4. 33 of the 84 are flagged `low` (a gain below 10 % in the whole backtest, the hold-out or since September, as in the EU files), 70 have `rankOk` (the page may claim hour ranking).
  Honest numbers inside: the pooled model's `bias` since September is -26 EUR/MWh in DK1 D+2 against -7 for level+shape; band coverage (rolling out of sample, not the nominal 80 %) is 0.72-0.86 over the backtest and 0.62-0.91 since September.
* **How it reaches the pages (no Worker change):** the Worker reads the Nordic feed `nordic-forecast-<zone>` as the PRICED feed (`zoneFeed`, `functions/api/[[catchall]].js`): `days[]` plus every other top-level field is passed through (`overlayNordicSettled` and `rebucketToLocalDays` keep `{...feed}`);
  it does not check horizons. So the gate must be applied by the JOB, exactly as the EU job does for `eu-forecast-<zone>`: forecast days only for allowed horizons, in a run starting the day after the last settled day, with `horizon`, a band on all 24 hours or none, and a top-level `accuracy` block of the horizons published.
  `train_daily_v2.py` does this (section 7). The EU zones' pages draw the accuracy line from `accuracy` because they are in the Worker's EU path (`C.band = !!cfg.eu`); the Nordic pages do not read `accuracy` yet: showing it there is a page change (outside this work, the Worker was not touched).
  Note the Worker keeps whatever forecast days the key carries: **without the job's gating NO4's forecast would stay on the site.**

## 7. What is staged (code and tests; NOT rolled out)

Files in `scripts/forecast_model/nordic/` (the cron job `train_daily.py` is untouched):

* `recipe_nordic.py` - the recipe as pure functions: leak-free reservoir, `augment` (the baseline and price-relative columns for training and live rows alike), `lear_predict` (730-day ridge per zone and horizon with the Nordic extras), the tree, `hybrid`, `live_rows`, `regional_weather`.
* `publish_nordic.py` - gate, accuracy block, bands, the run of consecutive days, the payload.
* `train_daily_v2.py` - the job: imports `train_daily` as a library for the refresh, the pooled model and the old feed (settled days); the `ens` zones' forecast days come from the ensemble; every zone's days go through the gate; writes `nordic-forecast-<zone>` and `nordic-forecast-archive-<zone>-<date>` only.
* `test_nordic_recipe.py` (19 tests, wired into `test-eu-forecast.mjs`): leakage rule of the live rows, nothing after the last known day moves a feature, the ridge cuts its window at T - h, the reservoir never sees the future, hybrid keeps the daily mean, gate cuts gaps/NaN/forbidden horizons, the checked-in gate files obey the 5 % rule, NO4 is not published.
* `research_no/verify_parity_nordic.py`: the live row builder against the research frame on real data (as of 2026-10-20, NO1, NO3, NO5, DK1: every non-weather column equal to 1e-6, NaN patterns equal): **PARITY OK**.
* Dry run on the Spark staging copy (`~/nordic-no-stage`, `--dry-run --skip-refresh`, 62 s): 13/13 zones, NO4 settled days only, ensemble forecasts for NO1/2/3/5 at D+2..D+8 with plausible levels (NO1 tomorrow 232, forecast 211, 208, 187, 185, 170, 167, 182 EUR/MWh) and bands.
  Not verified: a real KV write, the Worker's rendering of the new fields, a refreshed-data run (`--skip-refresh` was used: the refresh code is production's own and unchanged), the daily-refit live accuracy (the gate numbers are research: two-month folds / weekly ridge refits; production refits daily).

**Rollout (owner, not done):** 1. copy `train_daily_v2.py recipe_nordic.py publish_nordic.py publish_gate_nordic.json accuracy_nordic.json calibration_nordic_v2.json` into `~/nordic`, and from `~/eu-forecast` the helpers `region_models.py family_models.py fuel_features.py calendar_features.py fuel_live.py fetch_fuel.py fuel_daily.csv` (flat; no name collides with the Nordic job's);
2. `cd ~/nordic && set -a && . ~/.config/elpriser.env && set +a && nice -n 10 python3 train_daily_v2.py --dry-run` and compare the forecast days with `forecast_latest.json`; 3. one real run by hand, then `https://elpriser.org/api/nordic?zone=no1` (days, `horizon`, band, `accuracy`) and `zone=no4` (settled days only);
4. change the 12:40 UTC cron line from `train_daily.py` to `train_daily_v2.py` (**the old job's daily Hugging Face model upload stops with it**: v2 does not publish to the Hub; decide whether to keep that elsewhere);
5. refresh the gate and the calibration quarterly or when live accuracy alarms (re-run `nfr.py frame`, the candidates `lrel13lf r730lf p0`, `merge`, `build_gate_nordic.py`, `calibrate_nordic.py` as in section 6; a live monitor like `eu/monitor.py` is not built for the Nordic keys).
**Rollback:** put the old cron line back; at once, run `train_daily.py` by hand (it overwrites `nordic-forecast-<zone>` in the old format); the keys expire in 3 days by themselves.
**Open items:** the ensemble would make the Nordic job use the gas (MIBGAS) and carbon (EEX) inputs - the licence question of the EU job (docs/forecast-runbook.md, "Data licences") applies here too; without usable fuel the NO zones publish no forecast days; NO4: see below; the existing live skew found on the way:
`train_daily.score()` sums the 7-day regional rain from today 00:00 only (a shorter window for the first days than the training rows have) - `recipe_nordic.regional_weather` adds observed days before today; the pooled zones still carry the skew.

## 8. Recommendation

1. **Improve and ship the Norwegian zones NO1, NO2, NO3, NO5 with the ensemble** (staged above): they go from "fails the rule at every horizon, NO5 9-20 % worse than naive" to 8-29 % better at D+2..D+8, with a bias-free level; the gain is concentrated in the recent rising-price regime, say so on the page (`low` flags are in the file).
2. **Gate NO4 (publish settled days only) until something passes**, or label it: the options are (a) hide the forecast (what the gate does), (b) publish level+shape itself as a labelled naive forecast with `gain 0` (the precedent: Portugal's hour 23 publishes persistence and says so), (c) lift the rule for NO4 - not recommended (it fails on the hold-out by 5-10 points).
   What NO4 would need: a model of its water-value regime (northern reservoir inflow, SE1/SE2 export constraints), more history than 2.6 years, or an as-issued hydro forecast; none of the free proxies tried helped.
3. **Gate all 13 Nordic zones with the checked-in files** (`publish_gate_nordic.json` / `accuracy_nordic.json`): 8 of them lose nothing, and the site finally states what each forecast is worth. The Nordic pages need a small page change to print the accuracy line (not done: Worker untouched).
4. Optional next step, not staged: the ensemble would also improve DK, SE and NL (+3..+9 points) but loses FI D+6..D+8; a per-zone recipe table (the gate file already has a `recipe` field per zone) lets FI stay on the pooled model.
   **Done on the branch `nordic-ens`, see `docs/forecast-nordic-ens.md`:** a declared rule picked the recipe per zone (DK1, SE1-SE4, NL switch; DK2, FI stay pooled), with caveats on the regret of the 3 cheapest hours.
