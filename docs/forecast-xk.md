# Kosovo (`xk`) in the EU price forecast

Research of 2026-11-08, run on a COPY of the Spark job (`~/eu-forecast-xk`, never `~/eu-forecast`), with the same code, protocol and gate as the other 25
zones. Verdict: **xk passes the gate for D+2..D+6 (fuel mode) and D+2..D+5 (no-fuel mode); D+7 does not.** What the forecast means is in the
first section: read it before rolling anything out.

## What Kosovo's price is

* ENTSO-E (A44, EIC `10Y1001C--00100H`) carries a Kosovo day-ahead price from **2024-02-01 00:00 local** (nothing before 2024-01-31 23:00 UTC; the
  requests for 2022 to 2023-12 return no data). From then to 2026-11-08: 24,552 hourly values, **no missing hour, 60-minute resolution** (Kosovo has not
  moved to the 15-minute market time unit the other zones use since October 2025), one stretch of duplicate rows at the 90-day request seams with identical
  values, the harmonised limits show up (-500 EUR/MWh in 3 hours in May 2024, 4,000 in 2 hours in June 2024), 73 hours at exactly 0.
* **It is Albania's price in almost every hour.** Over the 24,285 hours both zones have: identical to the cent in **98.6 %**, correlation 0.994, mean
  absolute difference 0.8 EUR/MWh. Per month it is 99.7-100 % until June 2025 and 89-100 % from July 2025 (the two zones decouple when the cross-border capacity between them is
  used up: 347 hours in all, 84 days, mean absolute difference 56 EUR/MWh, Kosovo cheaper in 37 % of those hours and dearer in 63 %, most of them between 00:00 and 06:00
  and around noon, most in January 2026 with 82 hours). Against the neighbours that are not coupled to it the price is not a copy: Serbia, North Macedonia, Montenegro 0.4-0.8 % identical
  hours, correlation 0.71-0.75; HU, BG, GR, RO, HR, SI 0 % identical.
* Over the backtest (2025-04-01 onwards) 97.6 % of the hours are identical to Albania's.

So **a forecast for xk is, in effect, the Albanian forecast** (the xk and al forecasts differ by 4.5 EUR/MWh on average, correlation 0.992). It does not see the
decoupling hours coming: they are 2.4 % of the backtest hours and 3-3.5 % of the absolute error (the forecast's MAE on them is 40 EUR/MWh against 28-32 on the
coupled hours; level+shape is also worse on them, 46-49). The accuracy block the page prints is xk's own, measured against xk's own prices.

## The protocol

Option (a), xk added to the zone list and measured like the others: 2.75 years of hourly prices is as much as the other zones have inside the training window
(the weather archive starts 2024-03-15 for everyone), so the 2-month rolling-origin folds 2025-04..2026-11 are the same for xk. Added: `zones.py` (EIC, Europe/Belgrade
= CET/CEST, one weather point at Pristina), `calendar_features.py` (XK holidays: 1-2 Jan, 7 Jan, 17 Feb, 9 Apr, 1 May, 9 May, 25 Dec, Catholic and Orthodox Easter
Monday; a missing local holiday costs a little accuracy on one day a year, like for the other zones), `region_models.py` (xk in the `cee` group, +1 h standard offset).

On the Spark copy `~/eu-forecast-xk/xkrun` (prices of all 26 zones cut at 2026-11-02, like the research that built the checked-in gate; weather from the production
caches, xk's fetched the same way): `dataset.py` -> `fuel_dataset.py` -> `backtest.py` for `rel` (lgb_base) and `rel+fuel` (lgb_fuel) -> LEAR-365 with and without fuel
(`family_backtest.run_lear`, variant `lear_r365`; the Nordic rows are left out because the EU zones' per-zone ridge does not depend on them) -> `quantile_backtest.py`
-> `build_gate.py` and `calibrate_bands.py` unchanged. Nothing was chosen on the hold-out; no threshold or exclusion was added for xk.

Reproduction check: the same chain gives Albania the numbers the checked-in files have, to within 0.7 percentage points of gain in every cell
(AL D+2 fuel: 27.6 vs 27.6 EUR/MWh MAE, gain 18.0 % vs 17.5 %).

## The numbers (EUR/MWh MAE, 573 settled days; fuel mode; gain = 1 - MAE / level+shape MAE)

| horizon | MAE | level+shape | gain, whole backtest | gain, hold-out (2026-07-01..) | gain since 2026-09-01 | bias since 09-01 | regret vs base | band coverage | published |
|---|---|---|---|---|---|---|---|---|---|
| D+2 | 28.1 | 34.0 | 17.4 % | 14.6 % | 12.0 % | -10.1 | 8.9 vs 12.7 | 79 % | yes |
| D+3 | 29.4 | 34.9 | 15.7 % | 11.6 % | 7.8 % | -15.7 | 9.3 vs 12.6 | 78 % | yes, low confidence |
| D+4 | 30.4 | 35.6 | 14.4 % | 10.2 % | 5.1 % | -19.5 | 9.8 vs 12.7 | 78 % | yes, low confidence |
| D+5 | 31.3 | 36.1 | 13.2 % | 8.8 % | 2.8 % | -21.5 | 10.5 vs 12.8 | 77 % | yes, low confidence |
| D+6 | 32.1 | 36.6 | 12.4 % | 6.2 % | -0.0 % | -23.5 | 10.4 vs 12.8 | 78 % | yes, low confidence |
| D+7 | not published | | 11.3 % (whole backtest) | **4.95 %** | | | | | **no** (hold-out below 5 %) |

No-fuel mode (the fallback when the gas and carbon inputs are unavailable): D+2..D+5 pass (gain 16.1 / 14.6 / 13.1 / 12.4 %, hold-out 11.7 / 9.0 / 7.3 / 6.5 %); D+6 (hold-out 3.6 %) and D+7 (2.4 %) do not.

Like Albania, xk is worse than level+shape at the LEVEL since the September 2026 price shift (negative bias, gain since 09-01 falling to 0 at D+6), which is what the `low`
flag and the accuracy line on the page say; the forecast's value is the hour ordering (regret 25-30 % better at D+2..D+3) and the shape.

Side effect of the 26th zone on the others (pooled model and EU-level features): no published cell of the fuel mode moves by more than 0.7 percentage points of gain, no fuel-mode horizon
appears or disappears; in the no-fuel fallback IT-N would lose D+3 and D+4 and IE D+7. That is why `merge_zone.py` takes over only xk's cells.
The forecast values of the other zones move too, because the pooled model is retrained on 26 zones: two dry runs of `train_daily.py` on staged copies with the same caches (25-zone code of main vs the branch's 26-zone code)
differ by 4.7 EUR/MWh on average per zone-day (maximum 13, mean price 262); two consecutive daily production runs differ by 10.6 EUR/MWh for the same target day, so adding Kosovo is smaller than an ordinary day's revision.

## Dry run of the branch's production code

`train_daily.py --dry-run` on a staged copy (`~/eu-forecast-xkdry`: production caches of 2026-11-08, the branch's code and gate files, no KV writes): `FUEL on`, `DONE 26/26 zones (410s)`, xk "5 days (h 2,3,4,5,6), ens, with band",
the xk and al forecasts for the same five days differ by 2.8-7.2 EUR/MWh on average (means 318.7 / 320.0, 313.9 / 314.5, 322.3 / 321.4, 295.3 / 292.7, 289.6 / 291.6).

## What is in the branch

zone + calendar + group edits (above), `xk` entries in `publish_gate.json`, `accuracy_eu.json`, `calibration_eu.json` (all other cells untouched; the diff is only additions),
`merge_zone.py` (adds one zone's cells to the LIVE files), `zone_research.sh` + `zone_gate_frame.py` (the research chain used here, for the next zone), `fetch_weather.py --zone` (a zone's whole weather history without touching its group's caches), the OpenAPI text of
`/api/nordic` ("26 EU zones ... except `gb`"), tests (`test_eu_forecast.py`, `test_production.py`, `test_fuel_regions.py`, `test_hf.py`, `test-eu-forecast.mjs`, `test-api.mjs`).
`/api/nordic`, `zoneFeed` and the zone page need no change: xk is already in `EU_ZONES_ENTSOE`, `eu-forecast-xk` is read like the other keys, the page draws forecast days
whenever the feed has them (`prisHasFc`), and `tests/golden/zones.mjs` keeps `forecast: false` for every EU zone.

## Rollout (the owner does this; nothing here has been applied to production)

Outside 15:10-15:30 UTC (the cron) and with no run going (`flock -n /tmp/eu-forecast.lock true`).

1. Back up code and gate: `cd ~/eu-forecast && mkdir bak-xk-$(date +%Y%m%d) && cp *.py *.sh *.json bak-xk-$(date +%Y%m%d)/`.
2. Put the new code on the side: `rsync -a --exclude 'test_*' --exclude __pycache__ --exclude fixtures scripts/forecast_model/eu/ cc@spark:~/eu-forecast-stage/` and
   `rsync -a scripts/eu_prices/entsoe_parse.py scripts/eu_prices/energy_charts_parse.py cc@spark:~/eu-forecast-stage/`.
3. Merge the zone's cells into the live gate files without overwriting the rest (the live `calibration_eu.json` is refreshed weekly and newer than the checked-in one):
   `cd ~/eu-forecast-stage && python3 merge_zone.py --zone xk --from . --into ~/eu-forecast --dry-run`, then without `--dry-run`.
4. Code: `cd ~/eu-forecast-stage && rsync -a --exclude '*.json' ./ ~/eu-forecast/` (the JSON files stay as merged in step 3).
5. Price and weather history for xk (the daily job would fetch prices itself, but the weather would re-fetch the neighbouring zones' caches): `cd ~/eu-forecast && set -a && . ~/.config/elpriser.env && set +a && python3 -c "import fetch_prices; fetch_prices.main(['xk'])"` and `python3 fetch_weather.py --zone xk`.
6. Dry run, no KV writes, about 7 minutes: `nice -n 10 python3 train_daily.py --dry-run --zones xk` (expect `FUEL on`, "xk: would write ... with band", `DONE 1/1`), then `forecast_latest.json`.
7. One real run for the zone: `nice -n 10 python3 train_daily.py --zones xk` (writes `eu-forecast-xk` and the archive key). Check `https://elpriser.org/api/nordic?zone=xk` (settled days, then forecast days D+2..D+6 with band and the `accuracy` block of those five horizons), `/xk/cmimi-i-rrymes`, and that `al` and `mk` still serve their days.
8. The 15:15 cron then runs all 26 zones (`DONE 26/26 zones`, a run takes about 6 minutes). The weekly `refresh_calibration.sh` gives xk's band offsets automatically (its `quantile` section covers every zone in zones.py; the `residual` section stays as merged).
9. Deploy the site change (the OpenAPI text, the tests): the normal deploy gate. Nothing else on the site changes.

Rollback: delete the key (`wrangler kv key delete --namespace-id 126700e66e8d4a19b289b0e8afdaff69 eu-forecast-xk`; the API cache is 15 minutes) and put the backup back (`cp bak-xk-<date>/* ~/eu-forecast/`); the keys of the other zones are
unaffected, and without a key the xk page is an actual-prices page again. One horizon only: take it out of `publish_gate.json`, delete the key, the next run does not write it.

## Open points

* The open models on Hugging Face (`scripts/forecast_model/hf`) build their zone table from `zones.py`: the next snapshot would list 26 zones (the model card text says 25 in several places, and the weights are retrained on 26). The snapshot job is not installed; decide before it is.
* Holidays of Kosovo (the movable Eid holidays are not in the feature) and the single weather point (Pristina) are modelling choices, like for the other small zones.
* Whether Kosovo decouples from Albania more often from now on (it did in 3 of the last 6 months: May, September and October 2026) decides how long "an Albanian forecast" stays a good forecast for xk: the live accuracy (`monitor.py --days 21`) will show it after about three weeks.
* The forecast days' hold-out/low-confidence flags follow the generated files; the pages print them in all languages already.
