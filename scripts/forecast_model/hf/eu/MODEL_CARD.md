---
license: cc-by-4.0
tags:
  - electricity
  - energy
  - power-markets
  - europe
  - time-series
  - forecasting
  - tabular-regression
  - lightgbm
  - ridge-regression
library_name: lightgbm
pipeline_tag: tabular-regression
pretty_name: European Day-Ahead Electricity Price Forecast, 25 bidding zones (fuel-free variant)
---

# European day-ahead electricity price forecast, 25 zones: `eu-ens-v2`, fuel-free variant

**Dansk resume.** Åbne vægte og kode til den prognose, der ligger bag elpriserne for 25 europæiske budzoner på [elpriser.org](https://elpriser.org)
(Tyskland, Frankrig, Polen, Norditalien, Østrig, Belgien, Schweiz, Tjekkiet, Ungarn, Slovenien, Spanien, Portugal, Slovakiet, Grækenland, Rumænien, Bulgarien,
Kroatien, Serbien, Estland, Letland, Litauen, Irland, Montenegro, Nordmakedonien, Albanien). Modellen forudsiger børsprisen (day-ahead) time for time 2-7 dage frem,
med et P10-P90-bånd. **Det er ikke præcis den model, der kører på elpriser.org:** produktionsmodellen bruger også en gas- og en CO2-pris som input, men licensen på de
to dataserier er ikke bekræftet, så vægtene med gas/CO2 er holdt tilbage. Det her er den samme opskrift uden gas og CO2 (i gennemsnit ca. 3 % højere fejl,
se nedenfor). Modellen slår den simple metode "seneste niveau + ugeprofil" tydeligt i en bagudrettet test, men siden prisstigningen i september 2026 er forspringet
skrumpet (medianen over zoner falder fra 28 % til 22 % ved D+2 og fra 16 % til 5 % ved D+7), og modellen har ligget for lavt (bias -13 til -22 EUR/MWh).
Båndet dækker ca. 81 % i hele testperioden, men kun ca. 69 % siden september. Der findes endnu ingen måling af den faktiske fejl i drift (den blev sat i drift 3. november 2026).
Brug den til at finde de billigste timer, ikke som prisgaranti.

**English summary.** Open weights and code for the forecast behind the 25 European price zones on [elpriser.org](https://elpriser.org). Hourly day-ahead price
(EUR/MWh), 2-7 days ahead, with a P10-P90 band. **This is not exactly the production model:** production also feeds a gas price and a carbon price to the models,
whose data licences are unconfirmed, so the weights trained with them are withheld. This repo is the same recipe without them (about 3 % higher error on average, see
below). In the backtest it clearly beats the naive "latest level + weekday profile" method, but since the price rise of September 2026 the lead has shrunk (median over zones: 28 % to 22 % at D+2,
16 % to 5 % at D+7) and the model has run too low (bias -13 to -22 EUR/MWh). The P10-P90 band covered about 81 % over the whole backtest and about 69 % since September. There is no
measurement of the live error yet (the forecast went live on 2026-11-03). Use it to find the cheapest hours, not as a price guarantee.

## What is in this repo

| Path | What |
|---|---|
| `weights/lgb_base.txt` | LightGBM booster (median), pooled over the 25 zones, target = price minus the 7-day level. LightGBM text format, no pickles |
| `weights/ridge_nofuel.npz` | 132 ridge regressions (22 zones x D+2..D+7), standardisation + coefficients + intercept. Plain arrays, loads with `allow_pickle=False` |
| `weights/config.json` | feature lists, parameters, training cut-off (`trainedThrough`), snapshot date |
| `gate/publish_gate.json`, `gate/accuracy_nofuel.json` | which zone-horizons pass the publish gate, and the backtest numbers behind every one of them |
| `gate/calibration_residual.json` | P10/P90 offsets (measured error quantiles of the last 180 days, widened by 1.2) |
| `code/*.py` | the production modules, copied verbatim (features, calendar, ridge design, recipe, band logic, ENTSO-E price parser, Open-Meteo fetch) |
| `eu_infer.py`, `predict_eu.py` | the inference entry points |
| `DATA_LICENCES.md` | the licence audit of every data source behind the models |

`weights/` is a **snapshot**. Production refits the 365-day ridges and the LightGBM every day; this repo is meant to be refreshed weekly by a job on the maintainers' server (git tag `snapshot-YYYY-MM-DD`; the
date in `config.json` says which one you have). A snapshot ages: use the newest one, and expect the ridge in particular to drift when prices move fast.

## Quick start

```bash
pip install -r requirements.txt
export ENTSOE_TOKEN=...            # free: register at transparency.entsoe.eu, then ask transparency@entsoe.eu for "RESTful API access"
python3 predict_eu.py --zones de,es --out forecast.json
```

It downloads the last 60 days of day-ahead prices of the 25 zones (one request per zone) and the current Open-Meteo forecast (no key), builds the production feature rows,
applies the stored LightGBM and ridge coefficients, and prints per zone and day the mean, the minimum, the maximum and the three cheapest hours. Offline:
`--prices-dir` (one `price_<zone>.parquet` per zone with columns `t`, `eur_mwh`) and `--weather-pickle`. Programmatic use: `eu_infer.forecast(prices, live, "weights")`.

Reproduction check: on 2026-11-03 this code, run from a fresh download on frozen inputs, reproduced the production code path's central estimate for all 3,600 forecast hours to
within 1e-6 EUR/MWh (the production ridge and the stored coefficients are the same numbers).

## Task

For each of 25 bidding zones: the hourly day-ahead price of the days D+2 .. D+7, where D+1 is the newest day whose auction result is already published (with tomorrow's
prices out, D+2 is the day after tomorrow). Unit EUR/MWh, on the zone's own wall clock. Only horizons that pass the **publish gate** are produced: the recipe's MAE must be at least 5 %
below the naive method's on the hold-out (from 2026-07-01) *and* on the whole backtest. 146 of 150 zone-horizons pass (IT-N only D+2..D+4, AL not D+7).

## Method

* **Naive reference ("level + shape").** The mean of the last 7 known days plus the same weekday's hourly profile of the last 4 weeks. Every number below is measured against it.
* **LightGBM** (400 trees, 63 leaves, quantile objective alpha 0.5) pooled over all zones with `zone` as a categorical feature, ~4.0 million training rows (one row per zone, target hour and horizon),
  target = price minus the zone's 7-day level.
* **Ridge** per zone and horizon on the residual of the naive reference: last day's shape, last week's hour, level trend, calendar, wind/solar/temperature and their hour interactions
  (93 features), fitted on the last 365 days of settled targets.
* **Ensemble.** Mean of the two. EE, LV and LT use the LightGBM alone (the ridge did not help there).
* **Band.** P10/P90 = the central estimate plus measured error quantiles (10th and 90th percentile of the last 180 days of the ensemble's own error per zone and horizon, x1.2).
* **Features.** Price lags that were known at issue time only (a lag of k days exists only if k >= h-1), 7-/30-day levels, the EU-wide level, public holidays, and the weather *as forecast at the
  right lead* (Open-Meteo previous-runs API: wind at 100 m, direct radiation, temperature, precipitation at 1-3 points per zone).
* **Training data.** ENTSO-E day-ahead prices 2024-01-01 .. 2026-11-01 (hourly means in the zone's local time), Open-Meteo previous-runs forecasts from 2024-03-15.

## Backtest and its limits

Rolling origin, 2025-04-01 .. 2026-11-02, models retrained every two months (production retrains daily). **Out of sample, but one backtest:** the gate was built on the same period, and the
period contains a regime change (prices rose sharply from September 2026). All figures are MAE in EUR/MWh against actual day-ahead prices unless stated.

**Median over zones, per horizon** (24-25 zones per row; `gate/accuracy_nofuel.json` has every cell):

| Horizon | Gain vs naive, whole backtest | since 2026-09-01 | Band coverage (target 80 %), whole | since 2026-09-01 | Bias since Sept (naive) |
|---|---|---|---|---|---|
| D+2 | 27.8 % | 21.8 % | 82 % | 71 % | -13.4 (-8.5) |
| D+3 | 22.8 % | 16.0 % | 81 % | 69 % | -17.9 (-9.8) |
| D+4 | 20.6 % | 14.1 % | 81 % | 70 % | -19.9 (-11.1) |
| D+5 | 18.6 % | 11.5 % | 82 % | 69 % | -20.4 (-12.0) |
| D+6 | 16.7 % | 7.1 % | 82 % | 68 % | -21.9 (-12.8) |
| D+7 | 16.0 % | 4.9 % | 81 % | 67 % | -22.3 (-13.6) |

**All zones pooled** (every forecast hour weighted equally, so the large and expensive zones count more): hourly MAE D+2 22.3 vs 30.1 for the naive method over the whole backtest, 35.0 vs 44.3 since
September; D+7 since September 44.5 vs 47.1 (5.6 % better). The error of the **daily mean** (the price *level*, which is what "is Thursday cheaper than Friday" depends on) improves 30 % at D+2 over the whole backtest,
24.5 % at D+2 since September and **4.4 % at D+7 since September**. Pooled over D+2..D+7 since September the level error is 13.5 % better than the naive method (`scripts/forecast_model/hf/backtest_summary.py` in the GitHub repository reproduces these figures).

**What to take from it**

* The strength is the **shape**: picking the cheapest hours. Regret (the extra price paid for running a 3-hour load in the model's three cheapest hours instead of the true three cheapest) is 5.3 EUR/MWh against 7.1 for the naive method over the
  whole backtest (-25 %) and 10.0 against 11.6 since September (-14 %). 107 of the 146 published zone-horizons also pass a 5 % bar on regret (`rankOk` in the gate file).
* The **level advantage has shrunk a lot since the price rise of September 2026**, especially for the far days: median gain at D+7 fell from 16 % to 5 %; in GR, RS, ME and MK the D+7 forecast has been slightly *worse* than the naive
  method since September (-2 % to -6 %). The gate looks at the whole backtest and the hold-out, not at the recent months, so such cells are still published; 65 of 146 are flagged `low` (a gain under 10 % in some window, or marked weak by the owner).
* The model has been **too low** since September (bias -13 to -22 EUR/MWh in the median zone, about 1.6 times the naive method's bias). With gas and carbon inputs (production) the pooled bias is about a third smaller (below).
* **Bands are measured, not promised.** The P10-P90 band covered 77-84 % of the hours over the whole backtest (target 80 %) but only 52-88 % per zone-horizon since September (median 69 %): the offsets were fitted on a calmer period. Re-fit them (`calibration_residual.json`
  is refreshed with each snapshot) before relying on the band.
* **Backtest, not live.** The forecast went live on 2026-11-03. No live accuracy has been measured.

**Per zone** (D+2 and D+7 for the zones where D+7 is published; MAE in EUR/MWh with the naive method's MAE in brackets; coverage of the P10-P90 band at D+2):

ZONE_TABLE

### What the missing gas and carbon inputs cost

Production adds a gas-price index and a carbon-allowance price to the ridge and the LightGBM for 22 of the 25 zones (the Baltics never used them). Measured on the same backtest rows
(pooled over all zones, D+2..D+7): hourly MAE gain over the naive method **19.9 % fuel-free against 22.0 % with**, and **12.8 % against 16.7 % since September**; daily-mean (level) gain 23.3 % against 25.5 %, regret about equal
(5.32 against 5.26 EUR/MWh). Per zone and horizon the median MAE is about 3 % higher without the inputs; the bias since September is larger (-18.8 against -12.3 EUR/MWh pooled). That is the price of staying within licences that are confirmed.

## Limitations

* **A weekly snapshot, not the live model.** Daily refits are not reproduced; the stored ridge coefficients are those of `trainedThrough` in `config.json`.
* **Fuel-free.** See above; this is a weaker model than the one that runs on elpriser.org.
* **Prices rose in September 2026 and the model lags the level.** See above.
* **Unplanned outages, interconnector trips, negative-price spikes and market-rule changes are not modelled.** A forecast of the day-ahead price is an uncertain forecast of what the market will clear at.
* **Weather is a 1-3 point average per zone**, not a capacity-weighted field.
* **Not financial or trading advice.** This forecasts the wholesale day-ahead price, not a consumer bill (grid fees, taxes and supplier margin are not included). Not validated for trading, hedging or any other financial decision.
* **Intended use:** consumer decision support, e.g. "which hours this week are cheapest for the heat pump, dishwasher or EV", as on [elpriser.org](https://elpriser.org).

## Data sources and attribution

* Day-ahead prices: **ENTSO-E Transparency Platform** (transparency.entsoe.eu), hourly means calculated from the platform's data by elpriser.org. The platform's free-re-use list under CC BY 4.0 does not name day-ahead prices; see `DATA_LICENCES.md`. No price series is included in this repo.
* Weather: **Weather data by [Open-Meteo.com](https://open-meteo.com)** (CC BY 4.0). Note that Open-Meteo's *free API* (which `predict_eu.py` uses) is for non-commercial use only.
* Public holidays: computed in code.
* Gas and carbon prices (production variant only, **not in this repo**): the Iberian gas market operator MIBGAS and the EEX carbon-allowance auctions; licence confirmation pending.

## Licence

Weights, code and documentation: **CC BY 4.0**, credit "elpriser.org". The data sources keep their own terms (`DATA_LICENCES.md`).
More: [elpriser.org](https://elpriser.org), source repository [github.com/x2q/elpriser.org](https://github.com/x2q/elpriser.org), `scripts/forecast_model/eu` and `scripts/forecast_model/hf`.
