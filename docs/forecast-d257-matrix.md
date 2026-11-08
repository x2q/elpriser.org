# Forecast matrix: zone x D+2 / D+5 / D+7 (40 zones)

Owner's goal (2026-11-08): "We live by producing forecasts for D+2, D+5 and D+7. Make sure we have those forecasts for ALL areas." The site's period views are 2, 5 and 7 days, so D+2, D+5 and D+7 must exist in every zone.
This is the snapshot of **2026-11-08 about 14:40 UTC, before the 15:15 UTC run** (the live API, the KV keys on the Spark, the checked-in gates), made by `npm run forecast-coverage` (which now prints exactly these verdicts) and a read-only look at KV.
What was tried to get the blocked cells through is in [forecast-d257-experiments.md](forecast-d257-experiments.md).

## How to read it

* **D+n = the date today + n.** For the EU zones and `gb` the model's horizon `h` of that date is n when the run joined at tomorrow's prices (h = days from the last known price day, plus one; the gate and the accuracy numbers are per `h`).
  Before the 15:15 UTC run the API still carries the run of the morning, made before tomorrow's prices were in, and it ends at D+6: D+7 is then **due**, not missing (the coverage check says `due` before 16:00 UTC).
* **The site's 7-day view draws today .. today+6** (`PRIS_FC`, `days: 7`; index i = days from today), the 5-day view today .. today+4. D+7 as a DATE is therefore one day beyond what the 7-day chart draws; the business definition used here is the model horizon.
* Verdicts: **shown** (on the live API), **hidden-bug** (a model exists, the gate allows it, it is not on the API), **blocked-by-gate** (the gate or the owner's `forcedOff` does not let it through; documented, deliberate), **no-model** (nothing in production).
  `*` = shown **without any gate or accuracy block** (the 13 Nordic zones); "would fail the gate" = measured on the research backtest with the production Nordic model against level+shape, the same rule the EU zones are held to.
* Gate columns: gain of the published recipe over level+shape, whole backtest / hold-out (2026-07-01..), %. EU zones: `accuracy_eu.json` (fuel mode, the normal one; `low` = low-confidence flag); `gb`: `gb_gate.json`; Nordic zones: `forecast-per-region-scores.csv`, column `hyb_base` (what the Nordic job publishes) vs `b_lvlshape`.

## The matrix

| zone | job | D+2 | D+5 | D+7 | gate gain whole / hold-out, % (D+2 ; D+5 ; D+7) |
|---|---|---|---|---|---|
| dk1 | Nordic job | shown* | shown* | shown* | 23.0 / 25.9 ; 16.7 / 20.5 ; 12.7 / 15.9 |
| dk2 | Nordic job | shown* | shown* | shown* | 23.8 / 27.2 ; 17.6 / 20.2 ; 14.0 / 15.2 |
| no1 | Nordic job | shown* (would fail the gate) | shown* (would fail the gate) | shown* (would fail the gate) | 2.3 / 2.7 FAILS 5 % ; -2.5 / -6.7 FAILS 5 % ; -0.5 / -5.8 FAILS 5 % |
| no2 | Nordic job | shown* (would fail the gate) | shown* (would fail the gate) | shown* (would fail the gate) | 0.9 / 9.8 FAILS 5 % ; -5.2 / 1.6 FAILS 5 % ; -4.7 / 0.7 FAILS 5 % |
| no3 | Nordic job | shown* (would fail the gate) | shown* (would fail the gate) | shown* (would fail the gate) | -0.1 / 11.3 FAILS 5 % ; -3.0 / 3.3 FAILS 5 % ; 0.2 / 3.7 FAILS 5 % |
| no4 | Nordic job | shown* (would fail the gate) | shown* (would fail the gate) | shown* (would fail the gate) | 2.0 / 1.9 FAILS 5 % ; 2.6 / -2.1 FAILS 5 % ; 4.3 / -4.3 FAILS 5 % |
| no5 | Nordic job | shown* (would fail the gate) | shown* (would fail the gate) | shown* (would fail the gate) | -12.0 / -11.3 FAILS 5 % ; -13.7 / -20.1 FAILS 5 % ; -8.8 / -16.5 FAILS 5 % |
| se1 | Nordic job | shown* | shown* | shown* | 17.4 / 23.7 ; 14.2 / 16.2 ; 13.9 / 12.4 |
| se2 | Nordic job | shown* | shown* | shown* | 15.9 / 22.7 ; 13.2 / 17.6 ; 12.6 / 15.4 |
| se3 | Nordic job | shown* | shown* | shown* | 26.9 / 29.7 ; 21.3 / 22.2 ; 18.8 / 17.3 |
| se4 | Nordic job | shown* | shown* | shown* | 24.8 / 23.3 ; 18.5 / 16.4 ; 15.8 / 13.9 |
| fi | Nordic job | shown* | shown* | shown* | 19.5 / 23.0 ; 18.2 / 17.6 ; 17.4 / 14.4 |
| nl | Nordic job | shown* | shown* | shown* | 19.4 / 21.5 ; 13.5 / 12.7 ; 9.8 / 10.1 |
| de | EU job | shown | shown | shown | 38.1 / 40.2 ; 27.4 / 29.4 ; 22.4 / 26.3 |
| fr | EU job | shown | shown | shown (due) | 28.7 / 33.9 ; 17.6 / 24.3 ; 12.8 / 18.9 |
| pl | EU job | shown | shown | shown (due) | 30.2 / 29.3 ; 24.1 / 24.7 ; 19.0 / 19.9 |
| it-n | EU job | shown | shown | shown (due) | 28.5 / 25.5 low ; 20.2 / 14.4 low ; 17.3 / 12.2 low |
| at | EU job | shown | shown | shown | 33.3 / 33.1 ; 26.2 / 23.2 ; 23.1 / 21.5 |
| be | EU job | shown | shown | shown (due) | 32.1 / 35.3 ; 25.3 / 27.1 ; 19.6 / 22.0 |
| ch | EU job | shown | shown | shown | 33.6 / 35.6 ; 25.6 / 26.6 ; 22.3 / 23.5 |
| cz | EU job | shown | shown | shown (due) | 30.0 / 29.7 ; 25.0 / 24.3 ; 21.8 / 21.1 |
| hu | EU job | shown | shown | shown (due) | 33.0 / 35.7 ; 24.9 / 23.9 ; 22.2 / 21.7 low |
| si | EU job | shown | shown | shown (due) | 32.9 / 35.1 ; 26.4 / 24.7 ; 25.0 / 23.2 |
| es | EU job | shown | shown | shown (due) | 30.1 / 30.5 low ; 17.9 / 18.0 ; 11.9 / 13.9 |
| pt | EU job | shown | shown | shown (due) | 24.3 / 25.7 low ; 12.6 / 13.1 low ; 8.1 / 7.8 low |
| sk | EU job | shown | shown | shown (due) | 31.1 / 29.8 ; 24.7 / 21.1 low ; 22.3 / 20.4 low |
| gr | EU job | shown | shown | shown (due) | 26.4 / 25.7 low ; 17.9 / 14.2 low ; 15.4 / 13.8 low |
| ro | EU job | shown | shown | shown (due) | 31.2 / 37.5 ; 23.4 / 25.5 ; 20.9 / 23.3 low |
| bg | EU job | shown | shown | shown (due) | 28.2 / 30.6 ; 20.2 / 17.5 ; 17.4 / 15.5 low |
| hr | EU job | shown | shown | shown (due) | 33.6 / 36.0 ; 26.7 / 25.5 ; 24.1 / 23.1 low |
| rs | EU job | shown | shown | shown | 27.8 / 26.2 ; 19.5 / 14.8 low ; 15.9 / 13.9 low |
| ee | EU job | shown | shown | shown (due) | 18.5 / 16.9 ; 14.3 / 17.4 ; 12.3 / 13.2 |
| lv | EU job | shown | shown | shown (due) | 20.0 / 16.2 ; 18.2 / 18.1 ; 15.9 / 13.6 |
| lt | EU job | shown | shown | shown (due) | 20.4 / 17.3 ; 18.7 / 18.2 ; 16.0 / 12.2 low |
| me | EU job | shown | shown | shown | 27.9 / 23.9 low ; 19.4 / 12.8 low ; 17.8 / 10.1 low |
| mk | EU job | shown | shown | shown | 29.8 / 26.9 low ; 19.1 / 11.7 low ; 16.0 / 10.8 low |
| al | EU job | shown | shown | blocked-by-gate | 17.5 / 15.7 ; 13.0 / 10.0 low ; not published |
| xk | none | no-model | no-model | no-model | 17.4 / 14.6 ; 13.2 / 8.8 low ; not published |
| gb | gb job | shown | shown | shown | 23.0 / 27.0 ; 17.6 / 20.0 ; 13.9 / 12.6 |
| ie | EU job | shown | shown | shown (due) | 31.5 / 29.7 ; 21.3 / 19.6 ; 14.6 / 13.7 |

## Counts (2026-11-08 about 14:40 UTC, before the 15:15 UTC run)

```
D+2: {'shown': 39, 'no-model': 1}
D+5: {'shown': 39, 'no-model': 1}
D+7: {'shown': 20, 'due': 18, 'blocked-by-gate': 1, 'no-model': 1}
```

## What the matrix says

1. **EU job (25 zones) and `gb`:** every cell the gate allows is on the API. `de` and `at` were hidden-bug at the 12:20 UTC snapshot of 2026-11-08 and came back at once when the site's own Energy-Charts prices reached 2026-11-09 (the 14:00 UTC price job): see "de/at" below.
2. **Blocked by the gate: `al` D+7 only.** It is not blocked by the numbers (5.9 % on the hold-out in the checked-in run, 7.8-8.5 % with the 730-day ridge, [experiments](forecast-d257-experiments.md)) but by `forcedOff` in `publish_gate.json`, the owner's explicit exclusion. Lifting it is the owner's call.
3. **No model: `xk` (all three).** Offline it passes the gate for D+2..D+6; D+7 fails by 0.05 points in the checked-in run (4.95 %) and passes in four of five re-runs of the same recipe and with a longer ridge window. Not rolled out (the owner has not decided).
4. **The 13 Nordic zones are shown at D+2, D+5 and D+7 with NO gate, no accuracy block and no horizon label.** `nordic-forecast-<zone>` is written by `~/nordic/train_daily.py` (cron 12:40 UTC; `scripts/forecast_model/nordic/train_daily.py`: one pooled LightGBM, days today..today+8, bands from residual quantiles); the Worker joins it without a per-horizon check.
   Measured with the EU gate's own rule on the research backtest of that model (rolling origin 2025-04..2026-10, level+shape baseline): `dk1 dk2 se1-se4 fi nl` pass at D+2, D+5 and D+7 (whole backtest and hold-out both over 5 %); **`no1 no2 no3 no4 no5` fail at every one of the three horizons** (some by a few points, `no5` is 12-20 % WORSE than level+shape),
   which is the honest reading of "the Nordic model has no skill in the hydro zones beyond the seasonal pattern" (its model card says it beats a seasonal baseline on regret). Even the best research recipe of [forecast-per-region.md](forecast-per-region.md) (`ens_lt`) would pass `no3` at D+2/D+5/D+7, `no2` at D+2/D+5, `no1` and `no5` at D+2 only, and `no4` at none.
   So with the honesty gate applied, NO1, NO2, NO4, NO5 would lose D+5 and/or D+7 (and NO4 all three): "all areas" and "only what is 5 % better than level+shape" cannot both hold for them with today's models. This is the largest open decision of the matrix.
5. **`dk1`/`dk2`** also have the Danish model (`/api/forecast`, prognose3, cron 12:10 UTC, days to D+9) which the Danish pages draw; the figures above are for the Nordic feed `/api/nordic?zone=dk1`.
6. **`gb`** has its own gate (`gb_gate.json`, horizons 1-7, all pass: D+2 23.0 / 27.0, D+5 17.6 / 20.0, D+7 13.9 / 12.6).

## Raw: what was in KV at the time

`eu-forecast-<zone>` (date:h, h = the model's horizon) and `nordic-forecast-<zone>` (dates only, no horizon):

| zone | KV run | KV days (date:h) |
|---|---|---|
| dk1 | 2026-11-08 | 11-10: 11-11: 11-12: 11-13: 11-14: 11-15: 11-16: |
| dk2 | 2026-11-08 | 11-10: 11-11: 11-12: 11-13: 11-14: 11-15: 11-16: |
| no1 | 2026-11-08 | 11-10: 11-11: 11-12: 11-13: 11-14: 11-15: 11-16: |
| no2 | 2026-11-08 | 11-10: 11-11: 11-12: 11-13: 11-14: 11-15: 11-16: |
| no3 | 2026-11-08 | 11-10: 11-11: 11-12: 11-13: 11-14: 11-15: 11-16: |
| no4 | 2026-11-08 | 11-10: 11-11: 11-12: 11-13: 11-14: 11-15: 11-16: |
| no5 | 2026-11-08 | 11-10: 11-11: 11-12: 11-13: 11-14: 11-15: 11-16: |
| se1 | 2026-11-08 | 11-10: 11-11: 11-12: 11-13: 11-14: 11-15: 11-16: |
| se2 | 2026-11-08 | 11-10: 11-11: 11-12: 11-13: 11-14: 11-15: 11-16: |
| se3 | 2026-11-08 | 11-10: 11-11: 11-12: 11-13: 11-14: 11-15: 11-16: |
| se4 | 2026-11-08 | 11-10: 11-11: 11-12: 11-13: 11-14: 11-15: 11-16: |
| fi | 2026-11-08 | 11-10: 11-11: 11-12: 11-13: 11-14: 11-15: 11-16: |
| nl | 2026-11-08 | 11-10: 11-11: 11-12: 11-13: 11-14: 11-15: 11-16: |
| de | 2026-11-08 | 11-10:2 11-11:3 11-12:4 11-13:5 11-14:6 11-15:7 |
| fr | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 11-14:7 |
| pl | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 11-14:7 |
| it-n | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 11-14:7 |
| at | 2026-11-08 | 11-10:2 11-11:3 11-12:4 11-13:5 11-14:6 11-15:7 |
| be | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 11-14:7 |
| ch | 2026-11-08 | 11-10:2 11-11:3 11-12:4 11-13:5 11-14:6 11-15:7 |
| cz | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 11-14:7 |
| hu | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 11-14:7 |
| si | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 11-14:7 |
| es | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 11-14:7 |
| pt | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 11-14:7 |
| sk | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 11-14:7 |
| gr | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 11-14:7 |
| ro | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 11-14:7 |
| bg | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 11-14:7 |
| hr | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 11-14:7 |
| rs | 2026-11-08 | 11-10:2 11-11:3 11-12:4 11-13:5 11-14:6 11-15:7 |
| ee | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 11-14:7 |
| lv | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 11-14:7 |
| lt | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 11-14:7 |
| me | 2026-11-08 | 11-10:2 11-11:3 11-12:4 11-13:5 11-14:6 11-15:7 |
| mk | 2026-11-08 | 11-10:2 11-11:3 11-12:4 11-13:5 11-14:6 11-15:7 |
| al | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 |
| xk | 2026-11-08 | 11-10:2 11-11:3 11-12:4 11-13:5 11-14:6 |
| gb | 2026-11-08 | 11-09:1 11-10:2 11-11:3 11-12:4 11-13:5 11-14:6 11-15:7 |
| ie | 2026-11-08 | 11-09:2 11-10:3 11-11:4 11-12:5 11-13:6 11-14:7 |


## de/at: root cause, the cap, what is left

* **Root cause (confirmed):** the EU job trains on ENTSO-E prices; the site's de/at prices come from Energy-Charts (`build_eu_prices.py`, cron 11:30 and 14:00 UTC and later retries). On the Saturday run the Spark's ENTSO-E cache already held Monday 2026-11-09 for DE/AT (`price_de.parquet` ended 2026-11-09 23:00), the site's `eu-prices-de` ended 2026-11-08 until the 14:00 UTC job on Sunday. `build_rows` counted h from the cache's last day, so the forecast started one day too late; the Worker shows forecast days only if the first one is the day after the last settled day, so it showed none.
* **The cap in `forecast.py` works (confirmed live):** the Spark ran the patched code from 11:13 UTC (backup `~/eu-forecast/bak-20261108-coverage/`); its forecast for de/at starts 2026-11-10 (h2 from tomorrow). At 12:20 UTC it was hidden because the site had settled prices to 11-08 only; as soon as the 14:00 UTC Energy-Charts job wrote 11-09 to `eu-prices-de` / `eu-prices-at`, `forecast-coverage` showed both zones PASS with D+2, D+5 and D+7 shown (h2-7, 11-10..11-15).
* **What is left is a data-source race, not a forecast bug:** if the site's price feed for a zone is later than the job (or the cache is ahead of the site again), the forecast is hidden until the site catches up. The data-source fix is owned by the `price-sources` work (de/at and possibly other Energy-Charts zones to ENTSO-E with fallbacks); **nothing in `scripts/eu_prices/`, the price builders or the Worker's price sources was changed here.**
* **Considered on the forecast side and NOT done** (they belong with, and must not collide with, the price-source change): (a) let `train_daily` read the site's last settled day from `eu-prices-<zone>` and join there, so a late feed shortens the forecast by one day instead of hiding it (a 20-line change; it was written and tested and then withdrawn because `test-eu-forecast.mjs` pins "the job never touches an eu-prices key" and because the price-source agent changes what that key holds);
  (b) a second forecast run at about 17:15 UTC for the zones that came out hidden (a second 7-minute run, does not help when the feed is later still).

## Coverage check, and what must happen for "all areas"

`npm run forecast-coverage` now ends with the table above and exits 1 when a zone FAILs or lacks one of D+2, D+5, D+7 without a gate reason (hidden-bug, no-model). Today that is `xk` (no model). `al` D+7 is a documented gate reason and passes.
Decisions for the owner: (1) `xk`: roll out D+2..D+6 as it stands, or wait for D+7 with the 730-day ridge; (2) `al` D+7: lift `forcedOff`; (3) the Nordic zones: leave ungated (and say so), gate them with the EU rule (NO1, NO2, NO4, NO5 would lose horizons), or move them to the EU recipe (`ens_lt`: higher gains than the Nordic job's model in the zones where it passes, e.g. dk1 D+2 30.6 % against 23.0 %; still nothing for NO4); (4) whether to adopt the 730-day ridge for all zones (experiments, section 3).
