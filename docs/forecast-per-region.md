# EU price forecast: fuel anchor and per-region models (research, nothing deployed)

Status 2026-11-02. Research and backtest only: no KV write, no deploy, no crontab change. The code is in `scripts/forecast_model/eu/`
(`fetch_fuel.py`, `fuel_features.py`, `fuel_dataset.py`, `region_models.py`, `region_backtest.py`, `family_models.py`,
`family_backtest.py`, `catboost_backtest.py`, `quantile_backtest.py`, `region_all.py`, `region_scores.py`, `region_report.py`,
`nordic_backtest.py`; tests in `test_fuel_regions.py`, run by `npm run test:gate`). The full result tables are committed as CSV next to
this file (`forecast-per-region-*.csv`).

**Production (2026-11-03).** The owner decided to roll the best model out automatically; the deployable system and how to run it are in
[forecast-runbook.md](forecast-runbook.md) (`train_daily.py`, `recipe.py`, `gate.py`, `build_gate.py`, `calibrate_bands.py`). What differs from the tables below:
the published recipe is ONE uniform recipe, not the per-group component choices of the winner tables: the mean of `lear_r365_g` and `lgb_fuel` for the 22 zones other
than EE/LV/LT, and the plain `lgb_base` for EE/LV/LT (as recommended in section 1). `build_gate.py` rescores exactly that recipe on the same rows and applies the 5 % rule
(hold-out and whole backtest) afresh: 149 of 150 EU zone-horizons pass (the winner tables' 'publish' column is not used), and the owner's list switches AL D+7 off as well. Its
accuracy block (`accuracy_eu.json`) and the band offsets (`calibration_eu.json`) are generated from the same files as the tables here.

## 1. Answers first

**Gas and carbon.** A usable, free, keyless, programmatically fetchable pair exists, but not the one first suspected. Gas: the
**MIBGAS** day-ahead index of the Spanish gas balancing point (PVB), daily, history from 2015, same-day. Carbon: the **EEX EUA primary-auction
clearing price**, daily on auction days, history from 2012. Neither is TTF itself. Against the World Bank's monthly TTF the gas proxy has
correlation 0.987 over 45 months and a mean absolute difference of 1.05 EUR/MWh (June to September 2026: +0.1 .. +2.3, PVB above TTF). A Yahoo TTF
future (Dec-26, 93.45) against MIBGAS month-ahead for the same month (93.62) agreed on 2 November. TTF, API2 coal and gas-storage fill
could **not** be obtained legally and reliably for free in this run (table in section 2); the storage feature was therefore **not measured**.

**Does the fuel anchor help?** Yes on the continental, Iberian, Italian, CEE/SEE and Irish zones; no on the Baltics and the Nordic hydro zones.

* EU 25 zones pooled, LightGBM with fuel vs the current one: MAE -7.1 % (D+2) to -5.7 % (D+7) over the whole period, **-8.8 % to -11.6 %
  after 2026-09-01**. Bias after 1 September falls from -20.6 .. -30.6 to -8.8 .. -21.3 EUR/MWh. Regret improves only 0-4 %.
* Per zone: 22 continental, CEE/SEE, Iberian, IT-N and Irish zones gain 3-20 % over the whole period (it-n 20 %, ch 13 %, de 11 % at D+2) and up to
  22 % after 1 September; **EE/LV/LT gain nothing** (0 .. -1 % overall, -1 .. -7 % after 1 September); the Nordic zones gain 1-5 % at D+2
  overall but lose after 1 September in SE1-SE4 and FI (-1 .. -7 %).
* Gas alone (no carbon) is no better than no fuel after 1 September (40.7 vs 40.3 at D+2, 50.3 vs 49.0 at D+7) and clearly worse than gas +
  carbon (35.6). The tree model cannot extrapolate to a gas price (~100 EUR/MWh in October) above what it saw in training (monthly means of
  28-78 up to September); this is the likely reason, not proven.
* **The post-September lag does not disappear in the tree model** (bias still -9 .. -21), but **it does in the linear models that get the fuel
  features**: bias after 1 September is +0.1 / -1.4 / -2.7 EUR/MWh (D+2/4/7) for the per-zone ridge with fuel against -5.9 / -10.2 / -13.5
  without. The MAE hardly moves (32.0 vs 32.2 at D+2): after the bias is gone, weather and outage noise dominate.

**Which model per region?** One recipe wins almost everywhere: **the mean of a 365-day rolling ridge (LEAR; with the fuel features) and the
LightGBM model (with fuel)**, called `ens_lt` below (it is the group winner in 35 of the 42 group-horizon cells). Against 'level + shape'
(28.3 EUR/MWh at D+2 over the 38 zones) it is 28 % better at D+2 and 16 % better at D+7, and 28 % / 10 % better after 1 September. Each part
alone is worth about 23 % at D+2. The
region-specific ideas (exponentially weighted level, reference zone plus spread, PT copy of ES, Kalman level, rank-only model) did not beat
the pooled models; the rank-only model is useful only for timing (section 6).

**Publish rule (at least 5 % better MAE than level+shape out of sample, and the model chosen on 2025-04..2026-06 only):** 210 of 228
zone-horizon cells pass. The 18 that do not: NO4 all horizons, NO1 and NO5 D+4..D+7, NO2 D+7, FI D+6/D+7, AL D+7. Timing (regret) rule:
185 of 228 pass.

**What I would do next, in this order:** (1) add the MIBGAS/EEX features to the LightGBM job for every zone except the Baltics and the Nordic
hydro zones; (2) add the 365-day ridge and publish the mean; (3) leave the Baltic and Nordic hydro zones on the current model (the ensemble
still passes the rule there, but fuel is not what helps); (4) replace the 180-day x 1.2 band by the same recipe applied to quantile-model
edges (section 7); (5) ask MIBGAS and EEX in writing before launch (section 2).

## 2. Gas and carbon sources

Verified in this session by fetching the URLs (2026-11-02). "Model input" = may the number be used as a feature if it is never displayed or
redistributed.

| Source | What | URL | Licence / terms found | Lag | History | Verdict |
|---|---|---|---|---|---|---|
| **MIBGAS** (Iberian gas market operator) | PVB day-ahead index `GDAES_D+1` and month-ahead `GMAES`, EUR/MWh | `https://www.mibgas.es/en/file-access/MIBGAS_Data_<year>.csv?path=AGNO_<year>/XLS` (keyless, one ~64 kB CSV per year) | No dataset licence on the site. The legal notice's microsite and app clauses say public, free information may be used freely if the original content is kept intact and the source is cited. **Not a licence for this use**: confirm with info@mibgas.es. | same trading day (weekends included) | 2015- | **Chosen (gas).** Proxy for TTF, not TTF: +/- 1 EUR/MWh monthly, Spanish PVB trades at a small premium |
| **EEX** EUA primary auctions | clearing price per auction (11:00 CET), EUR/tCO2 | `https://public.eex-group.com/eex/eua-auction-report/emission-spot-primary-market-auction-report-<year>-data.xlsx` (keyless) | Sheet is marked "Public"; EEX's licensing-conditions page could not be read here. Ask auctions@eex.com | same day, weekdays only | 2012- | **Chosen (carbon).** Primary-market price, a few cents from spot EUA |
| Yahoo Finance `TTF=F`, `TTF<m><yy>.NYM`, `MTF=F` | futures | `query1.finance.yahoo.com/v8/finance/chart/<symbol>` | Not a data licence; its terms were not reviewed and automated use should be assumed not allowed | live | `TTF=F` returned **one** bar; only unexpired contracts have history (`TTFZ26.NYM` since 2023), expired ones answer 404; `MTF=F` (API2 coal) stops in 2025-12 | **Not usable**: no front-month history. Used only for the one-day cross-check above |
| Energy-Charts API (Fraunhofer ISE) | power, prices, shares | `https://api.energy-charts.info` | CC BY 4.0, attribution; 2 requests/min | - | - | **No gas, carbon or coal endpoint** in the v2.0 catalogue (checked `openapi.json`) |
| Ember | electricity data, carbon-price viewer (now inside "European electricity prices and costs") | `ember-energy.org/data/` | site content CC BY 4.0; the EUA/gas figures inside the tool come from Montel, GME and MIBGAS | daily | - | **No downloadable fuel-price series**; API (free key) covers electricity only |
| World Bank Pink Sheet | monthly "Natural gas, Europe" (TTF), coal (Australian, South African) | `thedocs.worldbank.org/.../CMO-Historical-Data-Monthly.xlsx` | CC BY 4.0 | 2 days after month end (Oct 2: September) | 1960- | **Validation only** (monthly, and a month-average is not known when the month is in progress) |
| ECB data portal | EUR/USD | `data-api.ecb.europa.eu` | free reuse | - | - | used to convert the Pink Sheet; carries no gas price |
| Trading Hub Europe | imbalance prices, neutrality | `tradinghub.eu/.../Imbalance-Prices` | not found | daily | - | JavaScript page, no documented machine endpoint; not tested |
| EEX gas spot / EGSI | THE, TTF spot indices | `eex.com/en/markets/natural-gas/gas-spot` | Market Data Hub is licensed | - | - | only a capacity CSV is free |
| GIE **AGSI+** | EU storage fill | `https://agsi.gie.eu/api` | needs a free registered API key; answers "Invalid or missing API key"; terms not read | daily | not checked | **Not measured**: registering an account is outside what this run may do. `fetch_fuel.py` reads `GIE_API_KEY`; parser tested against a synthetic fixture only; feature columns `full`, `full_d28` are ready |
| FRED / IMF, GME (IT PSV), Stooq | - | - | - | - | - | FRED returned an empty body; the GME URL tried was 404; Stooq serves a JavaScript bot check. Not evaluated |

Credit MIBGAS and EEX as sources wherever the methodology is described. The raw numbers are inputs only: nothing in `functions/` or the
site reads them. Coal (API2) has no free source found; it is the missing third fuel.

Leak-free definition (`fuel_features.py`, pinned by tests): for target day T at horizon h the forecast is issued on T-h; the fuel value
is the one of day **T-h-1**, the close before issue (a day more cautious than the data allows), weekends carried forward, plus
`fuel_age` (days since a real gas print, so a dead feed is visible). Features: gas level, 7-/28-day change, month-ahead minus day-ahead,
EUA level and changes, CCGT marginal cost (gas/0.55 + 0.202/0.55 x EUA) and its gap to the zone's 7-day level.

## 3. Fuel features in the existing backtest

Same rolling backtest as `backtest.py` (expanding window, retrained every 2 months, 2025-04-01 .. 2026-11-02, variant `rel`), same
metrics, features added. MAE and regret in EUR/MWh, hour-weighted over the zones, each zone scored on identical hours for every column.
"LGB now" is the existing model re-scored on that sample (24.3 .. 28.5, the earlier report).

### EU 25 zones

**EU 25 zones, period `full`** (MAE and regret in EUR/MWh, gain in %)

| h | level+shape | LGB now | LGB +gas | LGB +gas+EUA | gain MAE | bias now | bias +fuel | regret now | regret +fuel | regret l+s |
|---|---|---|---|---|---|---|---|---|---|---|
| D+2 | 30.1 | 24.3 | 23.6 | 22.6 | 7.1 | -2.4 | -1.1 | 5.0 | 4.8 | 7.0 |
| D+3 | 31.1 | 25.7 | 25.1 | 24.0 | 6.5 | -3.0 | -1.9 | 5.2 | 5.0 | 7.0 |
| D+4 | 31.7 | 26.5 | 25.9 | 24.8 | 6.2 | -3.0 | -2.0 | 5.3 | 5.2 | 7.1 |
| D+5 | 32.1 | 27.2 | 26.6 | 25.6 | 5.8 | -2.9 | -1.9 | 5.6 | 5.5 | 7.1 |
| D+6 | 32.4 | 28.0 | 27.5 | 26.4 | 5.9 | -2.4 | -1.5 | 5.8 | 5.7 | 7.1 |
| D+7 | 32.7 | 28.5 | 28.0 | 26.9 | 5.7 | -2.1 | -1.3 | 5.8 | 5.8 | 7.1 |

**EU 25 zones, period `before`** (MAE and regret in EUR/MWh, gain in %)

| h | level+shape | LGB now | LGB +gas | LGB +gas+EUA | gain MAE | bias now | bias +fuel | regret now | regret +fuel | regret l+s |
|---|---|---|---|---|---|---|---|---|---|---|
| D+2 | 28.4 | 22.4 | 21.6 | 21.0 | 6.2 | -0.2 | -0.2 | 4.5 | 4.3 | 6.5 |
| D+3 | 29.3 | 23.4 | 22.7 | 22.2 | 5.4 | -0.3 | -0.4 | 4.6 | 4.5 | 6.5 |
| D+4 | 29.9 | 24.2 | 23.4 | 22.9 | 5.2 | -0.1 | -0.2 | 4.8 | 4.7 | 6.5 |
| D+5 | 30.3 | 24.9 | 24.1 | 23.6 | 5.1 | 0.1 | 0.1 | 5.0 | 4.9 | 6.5 |
| D+6 | 30.6 | 25.6 | 24.9 | 24.3 | 5.2 | 0.8 | 0.6 | 5.2 | 5.1 | 6.6 |
| D+7 | 31.0 | 26.1 | 25.3 | 24.8 | 4.9 | 1.3 | 1.1 | 5.3 | 5.2 | 6.6 |

**EU 25 zones, period `after`** (MAE and regret in EUR/MWh, gain in %)

| h | level+shape | LGB now | LGB +gas | LGB +gas+EUA | gain MAE | bias now | bias +fuel | regret now | regret +fuel | regret l+s |
|---|---|---|---|---|---|---|---|---|---|---|
| D+2 | 44.3 | 40.2 | 40.6 | 35.6 | 11.6 | -20.5 | -8.8 | 9.6 | 9.2 | 11.6 |
| D+3 | 45.9 | 44.4 | 45.3 | 39.3 | 11.6 | -26.1 | -14.5 | 9.8 | 9.6 | 11.4 |
| D+4 | 46.9 | 46.0 | 47.3 | 41.2 | 10.5 | -27.8 | -17.1 | 9.7 | 9.5 | 11.3 |
| D+5 | 47.5 | 46.6 | 47.9 | 42.3 | 9.2 | -27.9 | -18.4 | 10.3 | 10.2 | 11.4 |
| D+6 | 47.3 | 48.1 | 49.3 | 43.9 | 8.8 | -29.0 | -19.8 | 10.8 | 10.7 | 11.5 |
| D+7 | 46.9 | 49.0 | 50.3 | 44.4 | 9.4 | -30.6 | -21.4 | 10.4 | 10.5 | 11.6 |

### Nordic 13 zones (DK1 DK2 NO1-5 SE1-4 FI, NL), the Nordic model re-run to 2026-10

**Nordic 13 (DK1 DK2 NO1-5 SE1-4 FI NL), period `full`** (MAE and regret in EUR/MWh, gain in %)

| h | level+shape | LGB now | LGB +gas | LGB +gas+EUA | gain MAE | bias now | bias +fuel | regret now | regret +fuel | regret l+s |
|---|---|---|---|---|---|---|---|---|---|---|
| D+2 | 24.7 | 20.7 |  | 20.0 | 3.2 | -6.3 | -5.9 | 5.3 | 5.3 | 6.5 |
| D+3 | 25.9 | 22.0 |  | 21.5 | 2.3 | -7.6 | -7.2 | 5.6 | 5.5 | 6.5 |
| D+4 | 26.4 | 22.8 |  | 22.5 | 1.7 | -7.9 | -7.6 | 6.0 | 6.0 | 6.6 |
| D+5 | 26.8 | 23.9 |  | 23.5 | 1.5 | -8.3 | -8.1 | 6.4 | 6.3 | 6.6 |
| D+6 | 27.1 | 24.5 |  | 24.2 | 1.2 | -8.1 | -7.9 | 6.4 | 6.3 | 6.6 |
| D+7 | 27.5 | 24.9 |  | 24.6 | 1.2 | -7.8 | -7.4 | 6.8 | 6.8 | 6.6 |

**Nordic 13 (DK1 DK2 NO1-5 SE1-4 FI NL), period `before`** (MAE and regret in EUR/MWh, gain in %)

| h | level+shape | LGB now | LGB +gas | LGB +gas+EUA | gain MAE | bias now | bias +fuel | regret now | regret +fuel | regret l+s |
|---|---|---|---|---|---|---|---|---|---|---|
| D+2 | 23.1 | 19.6 |  | 19.0 | 3.2 | -5.4 | -5.2 | 4.8 | 4.8 | 6.0 |
| D+3 | 24.2 | 20.9 |  | 20.3 | 2.5 | -6.6 | -6.3 | 5.1 | 5.0 | 6.0 |
| D+4 | 24.7 | 21.6 |  | 21.2 | 1.9 | -6.8 | -6.6 | 5.5 | 5.5 | 6.0 |
| D+5 | 25.2 | 22.6 |  | 22.2 | 1.9 | -7.3 | -7.0 | 5.8 | 5.8 | 6.0 |
| D+6 | 25.6 | 23.2 |  | 22.8 | 1.6 | -7.0 | -6.9 | 5.8 | 5.7 | 6.0 |
| D+7 | 26.1 | 23.6 |  | 23.2 | 1.7 | -6.7 | -6.3 | 6.2 | 6.2 | 6.0 |

**Nordic 13 (DK1 DK2 NO1-5 SE1-4 FI NL), period `after`** (MAE and regret in EUR/MWh, gain in %)

| h | level+shape | LGB now | LGB +gas | LGB +gas+EUA | gain MAE | bias now | bias +fuel | regret now | regret +fuel | regret l+s |
|---|---|---|---|---|---|---|---|---|---|---|
| D+2 | 38.4 | 29.5 |  | 28.7 | 2.9 | -13.7 | -11.9 | 9.5 | 9.2 | 11.3 |
| D+3 | 40.1 | 31.6 |  | 31.1 | 1.5 | -15.8 | -14.6 | 9.6 | 9.6 | 11.3 |
| D+4 | 40.7 | 32.9 |  | 32.9 | 0.0 | -16.8 | -15.9 | 10.3 | 10.5 | 11.3 |
| D+5 | 40.6 | 34.5 |  | 34.8 | -0.9 | -17.5 | -16.8 | 10.8 | 10.8 | 11.3 |
| D+6 | 40.0 | 35.6 |  | 35.8 | -0.6 | -17.1 | -16.6 | 11.5 | 10.8 | 11.3 |
| D+7 | 39.4 | 36.1 |  | 36.6 | -1.5 | -17.5 | -17.1 | 11.5 | 11.7 | 11.3 |

(The gas-only variant was run for the EU model only.)

Per zone (MAE gain of LightGBM+fuel over the current LightGBM, %; **negative = fuel hurts**):

| zone | D+2 full | D+2 after | D+5 full | D+5 after | D+7 full | D+7 after |
|---|---|---|---|---|---|---|
| de | 10.8 | 13.4 | 6.9 | 8.9 | 7.0 | 7.7 |
| fr | 5.8 | 14.2 | 4.2 | 10.1 | 4.4 | 10.1 |
| be | 10.1 | 17.7 | 7.9 | 13.3 | 7.4 | 10.8 |
| at | 9.4 | 16.8 | 9.3 | 15.4 | 8.6 | 16.8 |
| ch | 12.8 | 19.9 | 11.8 | 19.5 | 11.3 | 18.9 |
| cz | 9.4 | 14.7 | 8.7 | 13.8 | 7.7 | 12.2 |
| pl | 5.6 | 12.6 | 4.7 | 10.6 | 4.8 | 10.1 |
| es | 9.5 | 22.3 | 7.4 | 15.9 | 6.7 | 15.0 |
| pt | 8.6 | 18.3 | 7.9 | 13.8 | 7.4 | 13.0 |
| it-n | 20.2 | 22.2 | 18.1 | 17.3 | 16.8 | 16.5 |
| hu | 9.3 | 13.8 | 7.4 | 11.0 | 6.8 | 11.8 |
| sk | 9.2 | 11.9 | 7.9 | 10.7 | 7.7 | 10.8 |
| ro | 8.6 | 17.2 | 7.0 | 13.0 | 6.4 | 13.3 |
| bg | 7.2 | 13.6 | 6.2 | 10.8 | 5.9 | 11.2 |
| gr | 7.5 | 12.3 | 6.5 | 12.1 | 6.4 | 13.2 |
| hr | 10.1 | 17.0 | 8.7 | 15.4 | 8.4 | 15.6 |
| si | 10.0 | 18.0 | 9.0 | 16.3 | 9.1 | 16.6 |
| rs | 6.3 | 9.4 | 4.0 | 4.5 | 4.1 | 4.4 |
| me | 8.0 | 9.6 | 7.0 | 8.7 | 7.0 | 8.8 |
| mk | 7.4 | 8.3 | 4.8 | 4.5 | 5.0 | 5.9 |
| al | 4.4 | 9.5 | 3.5 | 6.7 | 3.3 | 6.4 |
| ee | -0.8 | -4.1 | -1.1 | -5.9 | -0.9 | -7.1 |
| lv | -0.3 | -2.5 | -1.2 | -5.4 | -0.3 | -1.5 |
| lt | -0.0 | -3.5 | -1.0 | -5.6 | -0.1 | -0.9 |
| ie | 9.4 | 14.9 | 8.2 | 14.5 | 7.4 | 13.2 |
| no1 | 3.5 | 5.7 | 1.9 | -1.8 | 1.6 | -1.4 |
| no2 | 5.3 | 7.1 | 3.9 | 1.4 | 3.3 | 0.2 |
| no3 | 3.8 | 0.3 | 1.7 | -0.2 | 1.0 | -2.2 |
| no4 | 4.9 | -2.0 | 2.6 | 1.9 | 2.0 | -1.2 |
| no5 | 4.1 | 11.3 | 2.4 | 3.3 | 2.0 | 3.5 |
| se1 | 1.9 | -5.6 | -0.5 | -4.1 | -0.4 | -6.6 |
| se2 | 1.8 | -1.8 | -1.4 | -4.2 | -0.7 | -3.9 |
| se3 | 1.4 | -2.6 | 0.1 | -7.0 | 0.2 | -5.7 |
| se4 | 1.9 | 2.9 | -0.0 | -3.3 | 0.1 | -3.5 |
| fi | 1.0 | -1.3 | -0.5 | -1.9 | -0.3 | -3.2 |
| dk1 | 3.9 | 4.2 | 3.1 | 0.3 | 2.5 | -0.1 |
| dk2 | 3.6 | 4.4 | 2.5 | 0.8 | 2.0 | 0.2 |
| nl | 5.3 | 5.9 | 3.5 | 1.7 | 2.7 | 0.8 |

Reading: the gain is largest where gas sets the price (it-n, ch, at, be, de) and largest after the September shift; in the Baltics
(coupled to the Nordics and to Poland) and in the Nordic hydro zones (water value, not gas) it is zero or negative, so the fuel features
should not be switched on there.

## 4. Candidate models per region

Folds, windows, metrics as above. "Select" = 2025-04-01..2026-06-30 (winners are chosen here), "hold-out" = 2026-07-01..2026-11-02 (not used
for choosing), "after" = from 2026-09-01. Cells: MAE of the candidate relative to level+shape, % (negative = better), mean over the
group's zones. Candidates: `a_ewm7` exponentially weighted level (half-life 7 d; 5 d is in the notes below) + weekday-hour shape;
`b_ridge_*` per-zone, per-horizon ridge on the residual of level+shape (last-day shape, last week's hour, level trend, weekday, hour,
holiday, wind/solar/temperature forecast and their hour interactions; `_gas` adds the fuel features); `c_rank` LightGBM on the within-day
deviation only; `d_lin` daily-mean ridge on the fuel cost + shape (the IT-N idea, run for every zone); `e*` reference zone forecast + spread
(`e1` weekday-hour spread of the last 4 weeks, `e2` + 7-day level spread with the spread's shape; refs: DE-LU for CEE/SEE, FI and SE4
for the Baltics; the reference forecast is that zone's best LightGBM variant); `f_ptes` PT = the ES forecast; `lgb_base` the current model
(for the Nordic group: the Nordic job's model re-run to 2026-10); `lgb_fuel`; `cb_fuel` and `ens_lt` as in section 7.

**D+2, hold-out % (MAE vs level+shape, mean over the group zones; negative = better)**

| model           | nordic   | core   | iberia   | it-n   | cee   | baltics   | ie    |
|:----------------|:---------|:-------|:---------|:-------|:------|:----------|:------|
| a_ewm7          | -1.5     | -0.8   | 0.2      | 10.7   | 2.0   | -2.4      | -3.2  |
| b_ridge_nogas   | -22.5    | -27.8  | -27.6    | -17.8  | -19.6 | -20.7     | -21.6 |
| b_ridge_gas     | -20.0    | -27.4  | -27.6    | -15.8  | -18.3 | -20.0     | -22.8 |
| d_lin           | -17.3    | -24.2  | -21.5    | -14.7  | -16.2 | -19.0     | -16.6 |
| c_rank          | -4.8     | -6.3   | 2.2      | 6.7    | -1.4  | -4.6      | -9.3  |
| k_gas           | -2.0     | -4.1   | -2.4     | 1.5    | -0.9  | -1.4      | -6.5  |
| lear_r365       | -19.0    | -31.5  | -28.3    | -22.5  | -25.6 | -21.1     | -28.3 |
| lear_r365_g     | -20.7    | -31.7  | -26.4    | -21.9  | -25.2 | -20.4     | -31.0 |
| lgb_base        | -16.5    | -17.3  | -1.2     | 15.1   | -16.1 | -17.3     | -3.5  |
| lgb_fuel        | -17.7    | -29.0  | -20.6    | -18.7  | -27.0 | -15.4     | -21.5 |
| cb_fuel         | -16.2    | -30.0  | -22.7    | -9.3   | -26.9 | -18.8     | -17.7 |
| e1_de           |          |        |          |        | 3.3   |           |       |
| e2_de           |          |        |          |        | -6.4  |           |       |
| e1_fi           |          |        |          |        |       | -13.2     |       |
| e2_fi           |          |        |          |        |       | -11.0     |       |
| e1_se4          |          |        |          |        |       | -19.7     |       |
| e2_se4          |          |        |          |        |       | -19.0     |       |
| f_ptes_lgb_fuel |          |        | -23.9    |        |       |           |       |
| ens_lt          | -25.1    | -33.7  | -29.4    | -25.5  | -29.6 | -20.8     | -29.7 |

**D+2, after 09-01 % (MAE vs level+shape, mean over the group zones; negative = better)**

| model           | nordic   | core   | iberia   | it-n   | cee   | baltics   | ie    |
|:----------------|:---------|:-------|:---------|:-------|:------|:----------|:------|
| a_ewm7          | -6.0     | -1.1   | -3.0     | 14.1   | 4.3   | -5.2      | -4.5  |
| b_ridge_nogas   | -23.8    | -29.3  | -22.7    | -17.5  | -17.2 | -24.9     | -25.8 |
| b_ridge_gas     | -21.9    | -29.7  | -23.4    | -13.9  | -15.9 | -24.0     | -29.9 |
| d_lin           | -17.9    | -25.8  | -18.7    | -13.7  | -12.2 | -21.8     | -22.6 |
| c_rank          | -8.9     | -5.3   | -1.3     | 10.1   | 2.4   | -6.9      | -11.3 |
| k_gas           | -4.4     | -6.1   | -4.7     | 2.7    | -0.7  | -4.8      | -8.0  |
| lear_r365       | -22.6    | -32.7  | -25.6    | -23.3  | -22.8 | -24.6     | -32.3 |
| lear_r365_g     | -23.1    | -33.3  | -26.1    | -22.4  | -22.6 | -23.5     | -35.9 |
| lgb_base        | -21.5    | -11.1  | 1.2      | 2.6    | -7.2  | -16.3     | -8.5  |
| lgb_fuel        | -23.1    | -24.1  | -19.2    | -20.2  | -19.0 | -13.5     | -22.1 |
| cb_fuel         | -20.0    | -25.6  | -23.5    | -16.4  | -20.7 | -16.3     | -21.8 |
| e1_de           |          |        |          |        | 23.6  |           |       |
| e2_de           |          |        |          |        | 2.1   |           |       |
| e1_fi           |          |        |          |        |       | -13.2     |       |
| e2_fi           |          |        |          |        |       | -10.8     |       |
| e1_se4          |          |        |          |        |       | -17.4     |       |
| e2_se4          |          |        |          |        |       | -19.6     |       |
| f_ptes_lgb_fuel |          |        | -23.8    |        |       |           |       |
| ens_lt          | -28.6    | -31.5  | -28.0    | -26.3  | -24.0 | -21.0     | -32.0 |

**D+7, hold-out % (MAE vs level+shape, mean over the group zones; negative = better)**

| model           | nordic   | core   | iberia   | it-n   | cee   | baltics   | ie    |
|:----------------|:---------|:-------|:---------|:-------|:------|:----------|:------|
| a_ewm7          | -4.7     | -4.6   | -2.8     | 8.4    | -0.8  | -5.0      | -4.5  |
| b_ridge_nogas   | -9.0     | -18.4  | -16.2    | -13.6  | -10.8 | -9.9      | -7.3  |
| b_ridge_gas     | -2.7     | -19.4  | -14.8    | -10.8  | -11.0 | -7.2      | -8.2  |
| d_lin           | -4.8     | -18.1  | -15.2    | -8.4   | -11.1 | -6.2      | -7.9  |
| c_rank          | -6.7     | -7.0   | 2.8      | 6.7    | -0.8  | -6.7      | -6.2  |
| k_gas           | 3.3      | -8.8   | -4.4     | -2.0   | -4.8  | 1.3       | -7.3  |
| lear_r365       | 7.1      | -18.3  | -12.9    | -16.4  | -12.8 | -8.2      | -12.3 |
| lear_r365_g     | -6.6     | -19.6  | -5.2     | -12.6  | -12.1 | -9.8      | -14.6 |
| lgb_base        | -6.7     | -7.5   | 3.6      | 29.2   | -5.1  | -13.0     | 9.8   |
| lgb_fuel        | -5.7     | -17.8  | -10.6    | -3.4   | -15.1 | -12.2     | -7.0  |
| cb_fuel         | -5.2     | -18.6  | -10.7    | 3.8    | -15.7 | -13.5     | -1.0  |
| e1_de           |          |        |          |        | -3.8  |           |       |
| e2_de           |          |        |          |        | -2.2  |           |       |
| e1_fi           |          |        |          |        |       | -10.9     |       |
| e2_fi           |          |        |          |        |       | -6.8      |       |
| e1_se4          |          |        |          |        |       | -9.5      |       |
| e2_se4          |          |        |          |        |       | -6.3      |       |
| f_ptes_lgb_fuel |          |        | -13.5    |        |       |           |       |
| ens_lt          | -9.6     | -20.2  | -16.1    | -13.1  | -16.4 | -12.1     | -10.2 |

**D+7, after 09-01 % (MAE vs level+shape, mean over the group zones; negative = better)**

| model           | nordic   | core   | iberia   | it-n   | cee   | baltics   | ie    |
|:----------------|:---------|:-------|:---------|:-------|:------|:----------|:------|
| a_ewm7          | -6.9     | -1.2   | -4.3     | 13.5   | 6.9   | -6.4      | -4.7  |
| b_ridge_nogas   | -9.6     | -14.1  | -14.2    | -12.9  | -1.3  | -10.1     | -7.9  |
| b_ridge_gas     | -2.4     | -17.2  | -13.0    | -4.3   | -1.2  | -9.8      | -13.6 |
| d_lin           | -4.1     | -16.7  | -13.7    | -2.6   | -1.2  | -8.8      | -12.6 |
| c_rank          | -8.7     | -2.8   | 1.6      | 12.6   | 8.4   | -7.9      | -6.3  |
| k_gas           | 3.5      | -7.0   | -5.4     | 3.9    | 1.4   | -2.9      | -9.5  |
| lear_r365       | -6.4     | -15.5  | -13.4    | -18.7  | -2.6  | -8.1      | -11.8 |
| lear_r365_g     | -7.9     | -18.4  | -11.8    | -10.3  | -1.1  | -10.5     | -16.9 |
| lgb_base        | -7.5     | 3.2    | 12.0     | 28.7   | 10.4  | -11.2     | 7.4   |
| lgb_fuel        | -5.8     | -8.4   | -3.6     | 7.4    | -1.5  | -8.5      | -6.7  |
| cb_fuel         | -2.6     | -11.4  | -6.3     | 7.3    | -3.7  | -9.5      | -3.7  |
| e1_de           |          |        |          |        | 12.8  |           |       |
| e2_de           |          |        |          |        | 8.4   |           |       |
| e1_fi           |          |        |          |        |       | -9.1      |       |
| e2_fi           |          |        |          |        |       | -6.3      |       |
| e1_se4          |          |        |          |        |       | -4.7      |       |
| e2_se4          |          |        |          |        |       | -0.6      |       |
| f_ptes_lgb_fuel |          |        | -6.5     |        |       |           |       |
| ens_lt          | -10.5    | -13.8  | -13.9    | -7.3   | -5.2  | -10.6     | -11.5 |

What the tables say:

* **Exponentially weighted level + shape (a):** at best 7 % better than level+shape (Nordic and Baltic zones after 1 September), **11-14 % worse
  in IT-N** and 2-7 % worse in CEE/SEE. Half-life 5 days is 0-6 points better than 7 days in IT-N and CEE/SEE and equal elsewhere. Not a model.
* **Ridge (b):** the surprise. With 110 linear features it is 16-28 % better than level+shape at D+2 in every group on the hold-out, equal to or
  better than LightGBM+fuel in 5 of 7 groups (not CEE/SEE: -19.6 % vs -27.0 %; not core: -27.8 % vs -29.0 %), and it beats the current LightGBM
  after 1 September in every group at D+2 and in 6 of 7 at D+7 (not the Baltics).
* **Rank-only (c):** timing only (regret), not a level forecast; see section 6.
* **IT-N linear on gas + shape (d):** -14.7 % hold-out at D+2, better than the current LightGBM (+15 %) but worse than the ridge (-17.8 %),
  LightGBM+fuel (-18.7 %) and the ensemble (-25.5 %).
* **Reference zone + spread (e):** CEE/SEE: 3 % worse than level+shape at D+2 on the hold-out (e1), **24 % worse after 1 September**; the DE
  forecast is no anchor for the Balkans when prices decouple. Baltics: SE4 as reference is slightly better than the current LightGBM at D+2
  (hold-out -19.7 % vs -17.3 %, after -17.4 % vs -16.3 %) and better than FI (-13.2 %), but worse at D+7 (-9.5 % vs -13.0 %) and well behind the
  365-day ridge. Not worth a separate model.
* **PT = ES copy (f):** PT alone, hold-out gain over level+shape at D+2/D+5/D+7: own LightGBM+fuel -17.6 / -13.5 / -9.6 %, the **copy of ES's
  LightGBM+fuel -23.9 / -15.3 / -13.5 %**, own ensemble -27.6 / -19.5 / -14.1 %. The copy beats PT's own tree model at every horizon and costs
  nothing; it is not better than the ensemble at D+2..D+5 and is chosen for PT only where the select period says so (D+7).
* **Nordic hydro:** the existing model is fine (-16.5 % hold-out at D+2, -6.7 % at D+7); fuel adds nothing; the ensemble adds 3-9 points.
* **Ireland:** gas matters (ridge with fuel -22.8 % vs -21.6 % without), the ensemble -29.7 %.

## 5. The publish decision, per zone and horizon

Winner per (region group, horizon) = lowest mean MAE ratio on the **select** period over models defined for every zone of the group. Then
per zone: PUBLISH if the winner is at least 5 % better than level+shape on the **hold-out** and on the **full** period. PT may take the ES
copy of the winner when it was better on the select period. Machine-readable full tables (all six horizons, MAE and regret, before / after /
hold-out / full, gain against level+shape and against the best naive): `forecast-per-region-winners-mae.csv`,
`forecast-per-region-winners-regret.csv`; all scores: `forecast-per-region-scores.csv`.

Which models win (final group winners; components in `forecast-per-region-ensembles.csv`): `ens_lt` in 35 of the 42 group-horizon cells. The
exceptions: CEE/SEE D+5..D+7 CatBoost+fuel (a single model, 1-2 points ahead of LightGBM+fuel: within noise), core D+7 LightGBM+fuel, Iberia D+7
the hybrid of LightGBM+fuel, Baltics D+6/D+7 the **current** LightGBM. The linear component of `ens_lt` (42 cells) is the 365-day ridge in 34 (with fuel features in 22, without in 12), `d_lin` in 5 (Nordic D+5..D+7,
Ireland D+6/D+7), the per-zone ridge without fuel in 2 (Iberia D+5/D+6) and the daily-refit weighted ridge in 1 (CEE D+2). The tree component is
LightGBM+fuel in 18, its hybrid-shape variant in 14 (Iberia, IT-N, Nordic at longer horizons), CatBoost+fuel in 5 (CEE/SEE) and the current LightGBM
in 5 (Baltics).

Verdict matrix, MAE rule (yes = publish; **"-" = do not publish**):

| zone | group | D+2 | D+3 | D+4 | D+5 | D+6 | D+7 |
|---|---|---|---|---|---|---|---|
| no1 | nordic | yes | yes | - | - | - | - |
| no2 | nordic | yes | yes | yes | yes | yes | - |
| no3 | nordic | yes | yes | yes | yes | yes | yes |
| no4 | nordic | - | - | - | - | - | - |
| no5 | nordic | yes | yes | - | - | - | - |
| se1 | nordic | yes | yes | yes | yes | yes | yes |
| se2 | nordic | yes | yes | yes | yes | yes | yes |
| se3 | nordic | yes | yes | yes | yes | yes | yes |
| se4 | nordic | yes | yes | yes | yes | yes | yes |
| fi | nordic | yes | yes | yes | yes | - | - |
| dk1 | nordic | yes | yes | yes | yes | yes | yes |
| dk2 | nordic | yes | yes | yes | yes | yes | yes |
| de | core | yes | yes | yes | yes | yes | yes |
| fr | core | yes | yes | yes | yes | yes | yes |
| nl | core | yes | yes | yes | yes | yes | yes |
| be | core | yes | yes | yes | yes | yes | yes |
| at | core | yes | yes | yes | yes | yes | yes |
| ch | core | yes | yes | yes | yes | yes | yes |
| cz | core | yes | yes | yes | yes | yes | yes |
| pl | core | yes | yes | yes | yes | yes | yes |
| es | iberia | yes | yes | yes | yes | yes | yes |
| pt | iberia | yes | yes | yes | yes | yes | yes |
| it-n | it-n | yes | yes | yes | yes | yes | yes |
| hu | cee | yes | yes | yes | yes | yes | yes |
| sk | cee | yes | yes | yes | yes | yes | yes |
| ro | cee | yes | yes | yes | yes | yes | yes |
| bg | cee | yes | yes | yes | yes | yes | yes |
| gr | cee | yes | yes | yes | yes | yes | yes |
| hr | cee | yes | yes | yes | yes | yes | yes |
| si | cee | yes | yes | yes | yes | yes | yes |
| rs | cee | yes | yes | yes | yes | yes | yes |
| me | cee | yes | yes | yes | yes | yes | yes |
| mk | cee | yes | yes | yes | yes | yes | yes |
| al | cee | yes | yes | yes | yes | yes | - |
| ee | baltics | yes | yes | yes | yes | yes | yes |
| lv | baltics | yes | yes | yes | yes | yes | yes |
| lt | baltics | yes | yes | yes | yes | yes | yes |
| ie | ie | yes | yes | yes | yes | yes | yes |

Verdict matrix, regret ("which hours are cheap") rule. Noisy: a cell flips when the gain sits near 5 %.

| zone | group | D+2 | D+3 | D+4 | D+5 | D+6 | D+7 |
|---|---|---|---|---|---|---|---|
| no1 | nordic | yes | yes | yes | yes | yes | yes |
| no2 | nordic | yes | yes | yes | yes | yes | yes |
| no3 | nordic | yes | yes | yes | yes | yes | yes |
| no4 | nordic | yes | yes | yes | yes | - | - |
| no5 | nordic | yes | yes | - | yes | - | - |
| se1 | nordic | yes | yes | yes | yes | - | - |
| se2 | nordic | yes | yes | yes | yes | yes | yes |
| se3 | nordic | yes | yes | yes | yes | yes | yes |
| se4 | nordic | yes | yes | yes | yes | yes | yes |
| fi | nordic | yes | yes | yes | yes | yes | yes |
| dk1 | nordic | yes | yes | yes | yes | yes | yes |
| dk2 | nordic | yes | yes | yes | yes | yes | - |
| de | core | yes | yes | yes | yes | yes | yes |
| fr | core | yes | yes | yes | yes | yes | yes |
| nl | core | yes | yes | - | - | - | - |
| be | core | yes | yes | yes | yes | yes | yes |
| at | core | yes | - | yes | - | yes | yes |
| ch | core | yes | yes | yes | - | - | - |
| cz | core | - | yes | yes | yes | - | yes |
| pl | core | yes | yes | yes | yes | yes | - |
| es | iberia | yes | yes | yes | yes | yes | - |
| pt | iberia | yes | - | - | yes | - | yes |
| it-n | it-n | yes | yes | yes | yes | yes | yes |
| hu | cee | yes | yes | yes | yes | yes | yes |
| sk | cee | yes | - | yes | yes | - | - |
| ro | cee | yes | yes | yes | - | yes | yes |
| bg | cee | yes | yes | yes | yes | yes | yes |
| gr | cee | yes | yes | yes | - | - | - |
| hr | cee | yes | yes | yes | yes | yes | yes |
| si | cee | yes | yes | yes | - | yes | yes |
| rs | cee | yes | yes | yes | yes | yes | yes |
| me | cee | yes | yes | yes | yes | yes | yes |
| mk | cee | yes | - | - | - | yes | - |
| al | cee | yes | yes | yes | yes | - | yes |
| ee | baltics | - | yes | yes | yes | yes | - |
| lv | baltics | yes | yes | yes | yes | - | yes |
| lt | baltics | yes | yes | yes | yes | yes | yes |
| ie | ie | yes | yes | yes | - | - | - |

Detail for D+2, D+4 and D+7. `MAE bef/aft` = the winner's MAE before / after 2026-09-01, `l+s` = level+shape's on the same hours, `vs l+s`
and `vs naive` = full-period gain against level+shape and against the best of the four naive baselines (lag7, seasonal4w, persist,
level+shape), `hold` = gain on the hold-out, `rank model` = the regret winner with its regret, level+shape's regret and gain.

| zone | h | model | MAE bef | l+s bef | MAE aft | l+s aft | vs l+s % | hold % | vs naive % | publish | rank model | regret | regret l+s | rank gain % | rank publish |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| no1 | D+2 | ens_lt | 15.3 | 18.8 | 20.7 | 29.6 | 20.2 | 21.8 | 9.1 | PUBLISH | c_rank | 5.2 | 6.9 | 25.4 | PUBLISH |
| no1 | D+4 | ens_lt | 17.3 | 20.1 | 28.4 | 31.8 | 13.2 | 4.9 | 13.2 | no | c_rank | 5.4 | 6.9 | 20.7 | PUBLISH |
| no1 | D+7 | ens_lt | 20.3 | 21.5 | 27.2 | 31.1 | 6.5 | 1.9 | 1.7 | no | c_rank | 5.8 | 6.9 | 15.5 | PUBLISH |
| no2 | D+2 | ens_lt | 15.3 | 18.0 | 24.2 | 36.5 | 18.6 | 27.1 | 7.5 | PUBLISH | c_rank | 4.4 | 5.4 | 18.4 | PUBLISH |
| no2 | D+4 | ens_lt | 17.3 | 19.2 | 32.4 | 39.2 | 11.1 | 13.5 | 8.6 | PUBLISH | c_rank | 4.7 | 5.4 | 13.0 | PUBLISH |
| no2 | D+7 | ens_lt | 19.8 | 20.2 | 32.2 | 37.7 | 4.3 | 10.8 | -2.1 | no | c_rank | 4.7 | 5.4 | 12.4 | PUBLISH |
| no3 | D+2 | ens_lt | 12.7 | 15.3 | 16.0 | 21.7 | 18.0 | 23.6 | 9.5 | PUBLISH | c_rank | 6.7 | 7.9 | 15.4 | PUBLISH |
| no3 | D+4 | ens_lt | 15.3 | 16.8 | 19.0 | 23.5 | 10.1 | 11.7 | 10.1 | PUBLISH | c_rank | 6.8 | 7.9 | 14.4 | PUBLISH |
| no3 | D+7 | ens_lt | 16.9 | 18.2 | 20.8 | 24.7 | 8.7 | 7.6 | 8.5 | PUBLISH | c_rank | 6.7 | 7.9 | 15.5 | PUBLISH |
| no4 | D+2 | ens_lt | 10.9 | 13.0 | 10.8 | 11.6 | 15.2 | 3.2 | 4.7 | no | c_rank | 4.1 | 5.4 | 24.4 | PUBLISH |
| no4 | D+4 | ens_lt | 13.0 | 14.4 | 11.8 | 11.8 | 8.9 | 3.5 | 8.9 | no | c_rank | 4.4 | 5.4 | 19.7 | PUBLISH |
| no4 | D+7 | ens_lt | 13.9 | 15.6 | 13.0 | 12.1 | 9.2 | -4.5 | 9.2 | no | c_rank | 4.2 | 5.4 | 22.6 | no |
| no5 | D+2 | ens_lt | 12.1 | 13.5 | 18.3 | 26.5 | 14.5 | 16.9 | -5.3 | PUBLISH | c_rank | 5.5 | 6.6 | 17.4 | PUBLISH |
| no5 | D+4 | ens_lt | 14.0 | 15.2 | 25.3 | 29.3 | 9.0 | -0.0 | 9.0 | no | c_rank | 5.8 | 6.6 | 12.0 | no |
| no5 | D+7 | ens_lt | 16.3 | 17.3 | 25.6 | 28.8 | 6.5 | -0.7 | 6.5 | no | c_rank | 6.4 | 6.6 | 3.6 | no |
| se1 | D+2 | ens_lt | 15.6 | 20.4 | 18.0 | 24.6 | 24.0 | 26.3 | 15.7 | PUBLISH | c_rank | 4.9 | 6.4 | 23.6 | PUBLISH |
| se1 | D+4 | ens_lt | 18.7 | 22.3 | 18.8 | 25.0 | 17.2 | 15.5 | 17.2 | PUBLISH | c_rank | 5.2 | 6.5 | 19.9 | PUBLISH |
| se1 | D+7 | ens_lt | 20.6 | 23.9 | 22.3 | 23.9 | 13.2 | 9.5 | 13.2 | PUBLISH | c_rank | 5.4 | 6.4 | 16.3 | no |
| se2 | D+2 | ens_lt | 16.1 | 21.1 | 21.3 | 28.8 | 24.2 | 25.6 | 15.9 | PUBLISH | c_rank | 4.9 | 7.1 | 30.4 | PUBLISH |
| se2 | D+4 | ens_lt | 19.2 | 23.0 | 22.8 | 30.1 | 17.5 | 14.6 | 17.5 | PUBLISH | c_rank | 5.3 | 7.2 | 25.6 | PUBLISH |
| se2 | D+7 | ens_lt | 21.5 | 24.7 | 26.2 | 30.0 | 12.9 | 13.6 | 12.9 | PUBLISH | c_rank | 5.9 | 7.1 | 16.8 | PUBLISH |
| se3 | D+2 | ens_lt | 17.5 | 26.7 | 28.4 | 44.7 | 34.7 | 34.7 | 29.3 | PUBLISH | c_rank | 5.1 | 6.7 | 24.4 | PUBLISH |
| se3 | D+4 | ens_lt | 20.5 | 28.6 | 33.8 | 46.3 | 28.0 | 25.6 | 28.0 | PUBLISH | c_rank | 5.9 | 6.6 | 11.1 | PUBLISH |
| se3 | D+7 | ens_lt | 24.1 | 30.2 | 38.8 | 44.3 | 18.9 | 17.2 | 16.6 | PUBLISH | c_rank | 5.9 | 6.7 | 11.9 | PUBLISH |
| se4 | D+2 | ens_lt | 21.9 | 32.5 | 43.4 | 64.9 | 32.8 | 31.4 | 27.0 | PUBLISH | c_rank | 5.5 | 7.9 | 30.4 | PUBLISH |
| se4 | D+4 | ens_lt | 25.2 | 34.4 | 53.6 | 67.9 | 25.6 | 21.5 | 23.9 | PUBLISH | c_rank | 5.7 | 7.9 | 28.4 | PUBLISH |
| se4 | D+7 | ens_lt | 30.1 | 35.6 | 58.4 | 65.8 | 14.7 | 15.1 | 10.7 | PUBLISH | c_rank | 6.6 | 8.0 | 17.1 | PUBLISH |
| fi | D+2 | ens_lt | 25.8 | 33.6 | 31.3 | 41.2 | 23.3 | 21.7 | 19.6 | PUBLISH | c_rank | 7.3 | 10.6 | 31.3 | PUBLISH |
| fi | D+4 | ens_lt | 29.3 | 35.8 | 33.2 | 41.6 | 18.4 | 11.9 | 18.4 | PUBLISH | c_rank | 8.1 | 10.7 | 24.7 | PUBLISH |
| fi | D+7 | ens_lt | 32.3 | 37.8 | 38.5 | 39.9 | 13.5 | 0.9 | 13.5 | no | c_rank | 8.1 | 10.7 | 24.1 | PUBLISH |
| dk1 | D+2 | ens_lt | 20.9 | 29.7 | 38.8 | 59.2 | 30.6 | 34.4 | 24.5 | PUBLISH | c_rank | 2.9 | 4.3 | 33.3 | PUBLISH |
| dk1 | D+4 | ens_lt | 23.8 | 31.2 | 47.7 | 63.3 | 23.8 | 25.5 | 19.2 | PUBLISH | c_rank | 2.9 | 4.3 | 33.6 | PUBLISH |
| dk1 | D+7 | ens_lt | 26.3 | 31.9 | 49.9 | 60.2 | 17.3 | 21.9 | 11.5 | PUBLISH | c_rank | 3.3 | 4.4 | 24.3 | PUBLISH |
| dk2 | D+2 | ens_lt | 22.0 | 31.4 | 38.6 | 59.3 | 30.8 | 34.9 | 25.8 | PUBLISH | c_rank | 3.4 | 5.5 | 37.5 | PUBLISH |
| dk2 | D+4 | ens_lt | 24.8 | 32.8 | 47.7 | 63.6 | 24.4 | 25.0 | 20.0 | PUBLISH | c_rank | 3.8 | 5.5 | 31.0 | PUBLISH |
| dk2 | D+7 | ens_lt | 27.7 | 33.7 | 50.2 | 60.0 | 17.4 | 21.9 | 11.7 | PUBLISH | c_rank | 4.4 | 5.6 | 20.9 | no |
| de | D+2 | ens_lt | 17.9 | 28.8 | 35.3 | 57.0 | 37.8 | 39.1 | 31.2 | PUBLISH | ens_lt | 2.1 | 4.1 | 48.4 | PUBLISH |
| de | D+4 | ens_lt | 20.8 | 30.1 | 41.8 | 62.4 | 31.5 | 33.1 | 26.0 | PUBLISH | c_rank | 2.4 | 4.1 | 40.8 | PUBLISH |
| de | D+7 | lgb_fuel | 23.5 | 30.6 | 52.4 | 60.4 | 21.3 | 20.0 | 14.5 | PUBLISH | c_rank | 2.7 | 4.1 | 35.9 | PUBLISH |
| fr | D+2 | ens_lt | 18.8 | 26.2 | 34.0 | 51.4 | 29.2 | 34.0 | 15.7 | PUBLISH | ens_lt | 2.7 | 4.2 | 35.7 | PUBLISH |
| fr | D+4 | ens_lt | 23.4 | 28.6 | 42.5 | 56.2 | 19.6 | 25.6 | 19.6 | PUBLISH | c_rank | 3.1 | 4.2 | 26.0 | PUBLISH |
| fr | D+7 | lgb_fuel | 26.5 | 30.1 | 47.9 | 54.8 | 12.1 | 18.3 | 10.1 | PUBLISH | c_rank | 3.2 | 4.2 | 23.0 | PUBLISH |
| nl | D+2 | ens_lt | 18.4 | 26.8 | 34.4 | 51.2 | 31.6 | 34.5 | 26.1 | PUBLISH | ens_lt | 2.7 | 4.3 | 37.0 | PUBLISH |
| nl | D+4 | ens_lt | 20.6 | 27.8 | 42.1 | 55.4 | 25.6 | 26.0 | 19.6 | PUBLISH | c_rank | 2.9 | 4.3 | 32.9 | no |
| nl | D+7 | lgb_fuel | 24.5 | 28.4 | 51.8 | 53.1 | 11.6 | 11.4 | 3.7 | PUBLISH | c_rank | 3.6 | 4.3 | 16.4 | no |
| be | D+2 | ens_lt | 18.2 | 26.6 | 33.3 | 51.5 | 32.1 | 35.0 | 25.8 | PUBLISH | ens_lt | 3.1 | 4.7 | 33.1 | PUBLISH |
| be | D+4 | ens_lt | 20.6 | 27.9 | 40.8 | 56.4 | 26.4 | 26.6 | 21.6 | PUBLISH | c_rank | 3.2 | 4.7 | 31.2 | PUBLISH |
| be | D+7 | lgb_fuel | 22.7 | 28.6 | 48.9 | 54.2 | 18.6 | 18.6 | 12.2 | PUBLISH | c_rank | 3.5 | 4.7 | 25.3 | PUBLISH |
| at | D+2 | ens_lt | 16.4 | 25.1 | 25.0 | 34.3 | 33.5 | 33.0 | 25.3 | PUBLISH | ens_lt | 3.2 | 5.0 | 36.8 | PUBLISH |
| at | D+4 | ens_lt | 18.5 | 26.2 | 28.6 | 35.2 | 28.0 | 25.3 | 23.6 | PUBLISH | c_rank | 3.8 | 5.1 | 26.2 | PUBLISH |
| at | D+7 | lgb_fuel | 20.1 | 27.2 | 34.5 | 36.3 | 23.3 | 19.3 | 15.6 | PUBLISH | c_rank | 3.8 | 5.1 | 25.6 | PUBLISH |
| ch | D+2 | ens_lt | 13.3 | 20.2 | 17.2 | 25.9 | 34.0 | 35.7 | 24.0 | PUBLISH | ens_lt | 1.9 | 2.8 | 31.5 | PUBLISH |
| ch | D+4 | ens_lt | 15.4 | 21.3 | 20.1 | 27.4 | 27.4 | 29.2 | 26.2 | PUBLISH | c_rank | 2.1 | 2.8 | 24.5 | PUBLISH |
| ch | D+7 | lgb_fuel | 17.4 | 22.5 | 27.1 | 29.1 | 20.6 | 18.1 | 14.4 | PUBLISH | c_rank | 2.7 | 2.8 | 5.2 | no |
| cz | D+2 | ens_lt | 18.7 | 27.1 | 35.3 | 46.8 | 29.9 | 29.3 | 23.9 | PUBLISH | ens_lt | 3.7 | 6.0 | 38.9 | no |
| cz | D+4 | ens_lt | 20.2 | 28.0 | 39.3 | 49.5 | 26.5 | 24.9 | 19.9 | PUBLISH | c_rank | 4.3 | 6.1 | 30.4 | PUBLISH |
| cz | D+7 | lgb_fuel | 21.2 | 28.7 | 44.7 | 48.2 | 22.8 | 18.3 | 14.7 | PUBLISH | c_rank | 4.5 | 6.2 | 27.4 | PUBLISH |
| pl | D+2 | ens_lt | 20.6 | 30.0 | 34.7 | 47.2 | 30.7 | 28.9 | 27.1 | PUBLISH | ens_lt | 4.5 | 8.0 | 43.3 | PUBLISH |
| pl | D+4 | ens_lt | 22.9 | 31.0 | 37.1 | 48.7 | 25.8 | 26.0 | 20.7 | PUBLISH | c_rank | 5.7 | 8.0 | 29.1 | PUBLISH |
| pl | D+7 | lgb_fuel | 24.2 | 31.7 | 42.9 | 47.8 | 21.5 | 18.1 | 14.8 | PUBLISH | c_rank | 6.3 | 8.0 | 20.5 | no |
| es | D+2 | ens_lt | 15.7 | 22.7 | 26.3 | 38.4 | 30.8 | 31.2 | 14.1 | PUBLISH | c_rank | 1.6 | 2.3 | 29.9 | PUBLISH |
| es | D+4 | ens_lt | 19.2 | 24.8 | 30.1 | 39.9 | 22.7 | 23.5 | 22.7 | PUBLISH | c_rank | 1.5 | 2.3 | 33.6 | PUBLISH |
| es | D+7 | hyb_fuel | 22.4 | 26.0 | 35.8 | 39.6 | 13.3 | 15.1 | 10.7 | PUBLISH | hyb_base | 1.9 | 2.3 | 18.0 | no |
| pt | D+2 | ens_lt | 17.1 | 22.9 | 29.3 | 38.8 | 25.1 | 27.6 | 5.9 | PUBLISH | c_rank | 2.4 | 3.1 | 23.8 | PUBLISH |
| pt | D+4 | ens_lt | 21.5 | 25.1 | 34.0 | 40.3 | 14.4 | 17.3 | 14.4 | PUBLISH | c_rank | 2.6 | 3.1 | 17.4 | no |
| pt | D+7 | f_ptes_hyb_fuel | 22.3 | 26.4 | 36.0 | 40.2 | 14.9 | 16.8 | 11.9 | PUBLISH | hyb_base | 2.6 | 3.1 | 16.4 | PUBLISH |
| it-n | D+2 | ens_lt | 10.7 | 15.0 | 14.3 | 19.5 | 28.5 | 25.5 | 25.6 | PUBLISH | ens_lt | 3.4 | 5.1 | 32.1 | PUBLISH |
| it-n | D+4 | ens_lt | 12.1 | 15.7 | 17.3 | 20.5 | 21.6 | 18.8 | 21.6 | PUBLISH | ens_lt | 4.0 | 5.1 | 21.0 | PUBLISH |
| it-n | D+7 | ens_lt | 13.5 | 16.6 | 20.7 | 22.3 | 17.1 | 13.1 | 15.2 | PUBLISH | c_rank | 3.8 | 5.0 | 24.0 | PUBLISH |
| hu | D+2 | ens_lt | 20.2 | 30.8 | 31.4 | 41.5 | 33.0 | 35.0 | 23.8 | PUBLISH | ens_lt | 3.0 | 5.9 | 48.9 | PUBLISH |
| hu | D+4 | ens_lt | 23.1 | 32.1 | 36.8 | 43.5 | 26.2 | 25.7 | 19.5 | PUBLISH | lgb_fuel | 3.5 | 6.0 | 41.3 | PUBLISH |
| hu | D+7 | cb_fuel | 23.9 | 33.2 | 44.2 | 44.0 | 24.1 | 18.7 | 14.5 | PUBLISH | lgb_fuel | 3.6 | 6.0 | 39.1 | PUBLISH |
| sk | D+2 | ens_lt | 19.4 | 29.0 | 34.8 | 43.2 | 31.1 | 29.8 | 24.9 | PUBLISH | ens_lt | 3.6 | 6.1 | 41.1 | PUBLISH |
| sk | D+4 | ens_lt | 21.5 | 30.2 | 38.1 | 45.0 | 26.7 | 24.1 | 21.0 | PUBLISH | lgb_fuel | 4.2 | 6.3 | 32.4 | PUBLISH |
| sk | D+7 | cb_fuel | 22.7 | 31.2 | 42.6 | 45.4 | 24.0 | 20.2 | 15.7 | PUBLISH | lgb_fuel | 4.3 | 6.3 | 31.5 | no |
| ro | D+2 | ens_lt | 20.5 | 30.1 | 27.7 | 40.2 | 31.8 | 37.5 | 23.5 | PUBLISH | ens_lt | 4.5 | 7.0 | 35.4 | PUBLISH |
| ro | D+4 | ens_lt | 23.5 | 31.5 | 34.0 | 42.1 | 24.5 | 26.9 | 18.1 | PUBLISH | lgb_fuel | 4.4 | 7.1 | 37.8 | PUBLISH |
| ro | D+7 | cb_fuel | 24.4 | 32.8 | 40.9 | 42.4 | 22.7 | 20.8 | 13.1 | PUBLISH | lgb_fuel | 5.1 | 7.2 | 28.7 | PUBLISH |
| bg | D+2 | ens_lt | 20.0 | 27.9 | 28.4 | 40.0 | 28.6 | 30.5 | 22.0 | PUBLISH | ens_lt | 6.6 | 9.1 | 28.3 | PUBLISH |
| bg | D+4 | ens_lt | 22.6 | 29.2 | 34.8 | 42.1 | 21.7 | 21.0 | 17.0 | PUBLISH | lgb_fuel | 6.6 | 9.3 | 29.1 | PUBLISH |
| bg | D+7 | cb_fuel | 23.7 | 30.1 | 40.4 | 43.1 | 19.2 | 13.6 | 11.7 | PUBLISH | lgb_fuel | 7.1 | 9.4 | 24.3 | PUBLISH |
| gr | D+2 | ens_lt | 18.7 | 26.0 | 33.5 | 44.3 | 27.4 | 27.8 | 17.2 | PUBLISH | ens_lt | 5.7 | 7.6 | 24.1 | PUBLISH |
| gr | D+4 | ens_lt | 21.4 | 27.3 | 41.6 | 45.9 | 19.6 | 16.0 | 15.2 | PUBLISH | lgb_fuel | 7.2 | 7.6 | 5.6 | PUBLISH |
| gr | D+7 | cb_fuel | 23.6 | 28.3 | 46.1 | 47.3 | 14.2 | 11.5 | 6.6 | PUBLISH | lgb_fuel | 8.0 | 7.6 | -5.2 | no |
| hr | D+2 | ens_lt | 18.2 | 28.0 | 25.2 | 35.7 | 34.1 | 36.0 | 26.3 | PUBLISH | ens_lt | 3.8 | 6.4 | 40.8 | PUBLISH |
| hr | D+4 | ens_lt | 20.8 | 29.2 | 28.7 | 37.0 | 28.0 | 28.2 | 20.8 | PUBLISH | lgb_fuel | 4.3 | 6.5 | 33.6 | PUBLISH |
| hr | D+7 | cb_fuel | 21.7 | 30.3 | 35.0 | 37.3 | 25.5 | 21.4 | 15.4 | PUBLISH | lgb_fuel | 4.6 | 6.5 | 28.6 | PUBLISH |
| si | D+2 | ens_lt | 18.6 | 28.1 | 25.7 | 35.5 | 33.1 | 34.5 | 26.0 | PUBLISH | ens_lt | 4.6 | 6.9 | 33.6 | PUBLISH |
| si | D+4 | ens_lt | 20.8 | 29.3 | 28.0 | 36.5 | 28.3 | 28.5 | 21.2 | PUBLISH | lgb_fuel | 4.9 | 7.0 | 29.8 | PUBLISH |
| si | D+7 | cb_fuel | 21.8 | 30.3 | 33.6 | 36.9 | 25.8 | 22.4 | 15.9 | PUBLISH | lgb_fuel | 5.1 | 7.0 | 27.9 | PUBLISH |
| rs | D+2 | ens_lt | 19.7 | 27.6 | 33.9 | 41.9 | 27.3 | 25.9 | 21.1 | PUBLISH | ens_lt | 4.3 | 7.0 | 38.8 | PUBLISH |
| rs | D+4 | ens_lt | 21.9 | 29.2 | 41.5 | 44.2 | 22.0 | 17.1 | 18.9 | PUBLISH | lgb_fuel | 4.6 | 7.0 | 34.9 | PUBLISH |
| rs | D+7 | cb_fuel | 23.6 | 30.3 | 45.6 | 46.4 | 19.0 | 14.5 | 12.3 | PUBLISH | lgb_fuel | 5.0 | 7.0 | 28.3 | PUBLISH |
| me | D+2 | ens_lt | 15.4 | 21.9 | 26.6 | 34.9 | 28.6 | 25.6 | 19.0 | PUBLISH | ens_lt | 4.7 | 6.7 | 29.6 | PUBLISH |
| me | D+4 | ens_lt | 17.6 | 23.4 | 34.1 | 37.1 | 22.0 | 16.7 | 18.8 | PUBLISH | lgb_fuel | 5.4 | 6.7 | 19.7 | PUBLISH |
| me | D+7 | cb_fuel | 19.8 | 24.8 | 37.8 | 38.0 | 17.3 | 11.0 | 9.2 | PUBLISH | lgb_fuel | 6.0 | 6.7 | 10.9 | PUBLISH |
| mk | D+2 | ens_lt | 17.0 | 25.2 | 27.6 | 35.6 | 30.9 | 27.3 | 16.9 | PUBLISH | ens_lt | 3.3 | 6.0 | 44.5 | PUBLISH |
| mk | D+4 | ens_lt | 20.3 | 26.7 | 35.7 | 38.5 | 21.5 | 15.4 | 20.3 | PUBLISH | lgb_fuel | 4.3 | 6.0 | 28.1 | no |
| mk | D+7 | cb_fuel | 22.6 | 28.2 | 39.2 | 41.9 | 18.0 | 14.2 | 11.6 | PUBLISH | lgb_fuel | 4.5 | 6.0 | 25.4 | no |
| al | D+2 | ens_lt | 25.6 | 31.9 | 41.5 | 48.1 | 18.8 | 15.3 | 17.0 | PUBLISH | ens_lt | 8.7 | 12.3 | 28.9 | PUBLISH |
| al | D+4 | ens_lt | 28.0 | 33.4 | 45.6 | 50.4 | 15.3 | 12.3 | 14.9 | PUBLISH | lgb_fuel | 10.0 | 12.2 | 17.9 | PUBLISH |
| al | D+7 | cb_fuel | 29.9 | 34.9 | 50.8 | 50.5 | 12.4 | 3.9 | 8.4 | no | lgb_fuel | 9.8 | 12.3 | 19.9 | PUBLISH |
| ee | D+2 | ens_lt | 33.5 | 43.1 | 45.0 | 56.6 | 21.9 | 18.0 | 21.9 | PUBLISH | lgb_fuel | 10.6 | 14.7 | 27.8 | no |
| ee | D+4 | ens_lt | 37.2 | 44.8 | 48.1 | 60.1 | 17.4 | 16.8 | 17.4 | PUBLISH | lgb_fuel | 10.5 | 14.4 | 27.1 | PUBLISH |
| ee | D+7 | lgb_base | 40.5 | 46.1 | 51.1 | 59.6 | 12.3 | 13.1 | 11.2 | PUBLISH | lgb_fuel | 11.8 | 14.8 | 20.0 | no |
| lv | D+2 | ens_lt | 31.9 | 42.4 | 58.9 | 74.3 | 24.1 | 21.4 | 20.0 | PUBLISH | lgb_fuel | 8.7 | 12.5 | 30.6 | PUBLISH |
| lv | D+4 | ens_lt | 35.8 | 44.5 | 63.7 | 79.7 | 19.6 | 18.9 | 18.7 | PUBLISH | lgb_fuel | 8.4 | 12.4 | 32.2 | PUBLISH |
| lv | D+7 | lgb_base | 38.2 | 45.8 | 67.9 | 76.6 | 15.9 | 13.5 | 13.3 | PUBLISH | lgb_fuel | 9.4 | 12.6 | 25.2 | PUBLISH |
| lt | D+2 | ens_lt | 31.8 | 42.5 | 58.4 | 74.7 | 24.6 | 23.1 | 20.6 | PUBLISH | lgb_fuel | 8.6 | 12.3 | 30.6 | PUBLISH |
| lt | D+4 | ens_lt | 35.8 | 44.7 | 63.9 | 80.1 | 19.8 | 18.5 | 18.4 | PUBLISH | lgb_fuel | 8.8 | 12.1 | 27.2 | PUBLISH |
| lt | D+7 | lgb_base | 37.9 | 46.0 | 70.7 | 76.9 | 16.0 | 12.3 | 13.0 | PUBLISH | lgb_fuel | 9.6 | 12.4 | 22.4 | PUBLISH |
| ie | D+2 | ens_lt | 21.3 | 31.0 | 35.2 | 51.7 | 31.5 | 29.7 | 31.5 | PUBLISH | c_rank | 7.1 | 10.3 | 31.6 | PUBLISH |
| ie | D+4 | ens_lt | 24.4 | 32.3 | 41.5 | 56.2 | 24.9 | 24.0 | 24.8 | PUBLISH | c_rank | 7.5 | 10.4 | 27.7 | PUBLISH |
| ie | D+7 | ens_lt | 28.3 | 33.1 | 49.1 | 55.5 | 14.1 | 10.2 | 12.7 | PUBLISH | c_rank | 9.8 | 10.5 | 6.0 | no |

Note the `vs naive` column: against the *best* naive baseline of each cell the gains are smaller than against level+shape. NO5 at D+2 is 14.5 %
better than level+shape but 5.3 % **worse** than the best naive baseline (it is published under the stated rule, which names level+shape; if the
rule were "better than every naive", it would not be); PT D+2 is only 5.9 % better than the best naive.

## 6. Rank-only model (timing)

`c_rank` predicts only the deviation of an hour from its day's mean. Mean regret over each group's zones, whole period, EUR/MWh (lower is
better; the cost of following the 3 cheapest hours of the forecast against the best 3):

| group | level+shape D+2 | LGB now | LGB+fuel | rank-only | ensemble | level+shape D+7 | LGB now | LGB+fuel | rank-only | ensemble |
|---|---|---|---|---|---|---|---|---|---|---|
| Nordic | 6.73 | 5.45 | 5.38 | **4.98** | 4.98 | 6.77 | 6.86 | 6.94 | **5.63** | 6.34 |
| core | 4.88 | 3.49 | 3.33 | 3.05 | **2.99** | 4.94 | 4.43 | 4.29 | **3.80** | 4.32 |
| Iberia | 2.71 | 2.43 | 2.42 | **2.00** | 2.11 | 2.71 | 2.81 | 3.07 | **2.27** | 2.60 |
| IT-N | 5.07 | 3.83 | 3.67 | **3.44** | 3.44 | 5.03 | 4.58 | 4.47 | **3.82** | 4.14 |
| CEE/SEE | 7.36 | 5.10 | 4.92 | 5.18 | **4.80** | 7.44 | 5.82 | **5.74** | 5.89 | 5.79 |
| Baltics | 13.16 | 9.46 | **9.27** | 9.53 | 9.39 | 13.23 | **10.26** | 10.27 | 11.26 | 11.22 |
| Ireland | 10.34 | 7.93 | 7.43 | **7.07** | 7.35 | 10.46 | 10.70 | 10.06 | 9.83 | **9.47** |

The rank-only model is the regret winner for 15-24 of the 38 zones depending on the horizon (LightGBM+fuel 3-14, the ensemble 0-20): 26-37 %
better than level+shape at D+2 and 6-24 % at D+7 in the Nordic, core, Iberian, IT-N and Irish groups. As a price forecast it is no use (MAE -1 ..
-9 % vs level+shape in the hydro and Baltic groups, +10 % in IT-N after 1 September). Use it for "cheapest hours" and "best time to run", never for
the price; the pooled LightGBM with fuel is the better timing model in CEE/SEE and the Baltics. On the regret rule 185 of 228 cells pass (36, 34,
34, 30, 26, 25 per horizon D+2..D+7); the matrix above shows where.

## 7. Model families (the added bake-off)

All with the same folds, windows, metrics and the same select / hold-out rule. Pooled over 38 zones, hour-weighted, MAE relative to level+shape
(%), then bias after 2026-09-01.

**38 zones pooled, `full`: MAE vs level+shape (%; negative = better)**

| model | MAE D+2 (EUR) | D+2 | D+3 | D+4 | D+5 | D+6 | D+7 |
|---|---|---|---|---|---|---|---|
| b_lvlshape | 28.3 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| a_ewm7 | 28.3 | 0.2 | -0.1 | -1.0 | -1.9 | -2.8 | -3.4 |
| b_ridge_nogas | 23.1 | -18.3 | -14.4 | -12.5 | -10.7 | -9.3 | -8.3 |
| b_ridge_gas | 23.4 | -17.3 | -13.1 | -10.7 | -8.7 | -7.5 | -6.6 |
| d_lin | 23.8 | -15.7 | -12.4 | -11.4 | -10.5 | -8.8 | -7.7 |
| k_level | 27.9 | -1.2 | -0.3 | -0.9 | -2.0 | -3.1 | -4.0 |
| k_gas | 27.9 | -1.2 | -0.1 | -0.2 | -0.9 | -1.6 | -2.4 |
| lear_r90 | 24.0 | -15.1 | -6.7 | -2.4 | 2.2 | 7.1 | 10.5 |
| lear_r90_g | 25.1 | -11.3 | -2.4 | 4.5 | 8.9 | 12.6 | 17.0 |
| lear_r180 | 23.1 | -18.2 | -10.6 | -6.9 | -3.3 | 1.1 | 2.9 |
| lear_r180_g | 23.6 | -16.6 | -8.5 | -3.6 | 0.5 | 4.5 | 7.2 |
| lear_r365 | 21.9 | -22.7 | -16.6 | -14.0 | -11.5 | -9.1 | -7.8 |
| lear_r365_g | 21.8 | -22.9 | -17.3 | -14.5 | -11.9 | -9.7 | -8.2 |
| lear_r365w | 22.0 | -22.1 | -15.5 | -12.0 | -8.7 | -5.9 | -3.7 |
| lear_r365w_g | 22.3 | -21.2 | -14.5 | -10.0 | -6.6 | -4.1 | -1.6 |
| lear_l180 | 22.6 | -20.0 | -13.2 | -9.7 | -6.6 | -2.9 | -1.0 |
| lear_l180_g | 22.8 | -19.5 | -12.7 | -8.4 | -5.0 | -1.4 | 1.0 |
| lear_r180_d1 | 22.7 | -19.8 | -12.6 | -9.0 | -5.9 | -1.4 | 1.4 |
| lear_r365w_d1 | 21.8 | -22.9 | -16.3 | -13.4 | -10.2 | -7.4 | -5.4 |
| lear_r365w_g_d1 | 21.8 | -22.8 | -16.2 | -13.1 | -9.5 | -6.6 | -4.3 |
| lgb_base | 23.1 | -18.4 | -16.6 | -15.5 | -13.9 | -12.3 | -11.7 |
| lgb_fuel | 21.7 | -23.3 | -21.0 | -19.6 | -17.8 | -16.2 | -15.5 |
| hyb_fuel | 22.2 | -21.4 | -19.7 | -18.6 | -17.2 | -15.9 | -15.4 |
| cb_fuel | 22.1 | -21.9 | -20.0 | -18.7 | -17.1 | -15.9 | -14.9 |
| ens_lt | 20.3 | -28.3 | -24.1 | -22.0 | -19.7 | -17.5 | -16.2 |
| ens_lb | 23.1 | -18.4 | -16.7 | -15.5 | -14.6 | -13.8 | -13.3 |

**38 zones pooled, `before`: MAE vs level+shape (%; negative = better)**

| model | MAE D+2 (EUR) | D+2 | D+3 | D+4 | D+5 | D+6 | D+7 |
|---|---|---|---|---|---|---|---|
| b_lvlshape | 26.6 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| a_ewm7 | 26.8 | 0.6 | 0.2 | -0.7 | -1.8 | -2.9 | -3.8 |
| b_ridge_nogas | 22.0 | -17.2 | -13.4 | -11.6 | -9.7 | -8.9 | -8.1 |
| b_ridge_gas | 22.3 | -16.0 | -11.9 | -9.3 | -7.3 | -6.8 | -6.2 |
| d_lin | 22.7 | -14.8 | -11.5 | -10.6 | -9.8 | -8.5 | -7.5 |
| k_level | 26.4 | -0.7 | 0.1 | -0.6 | -1.9 | -3.3 | -4.3 |
| k_gas | 26.4 | -0.6 | 0.7 | 0.6 | -0.3 | -1.3 | -2.3 |
| lear_r90 | 23.0 | -13.4 | -4.7 | -0.2 | 4.5 | 9.2 | 12.6 |
| lear_r90_g | 24.1 | -9.3 | -0.0 | 7.0 | 11.5 | 15.1 | 19.3 |
| lear_r180 | 22.1 | -16.7 | -8.9 | -5.2 | -1.7 | 2.6 | 4.1 |
| lear_r180_g | 22.6 | -15.0 | -6.7 | -1.7 | 2.4 | 6.0 | 8.4 |
| lear_r365 | 20.8 | -21.9 | -15.8 | -13.3 | -10.7 | -8.6 | -7.5 |
| lear_r365_g | 20.7 | -22.1 | -16.4 | -13.6 | -11.0 | -9.2 | -7.7 |
| lear_r365w | 21.0 | -21.1 | -14.4 | -10.8 | -7.4 | -5.1 | -2.9 |
| lear_r365w_g | 21.2 | -20.1 | -13.3 | -8.7 | -5.1 | -3.1 | -0.6 |
| lear_l180 | 21.6 | -18.8 | -11.9 | -8.4 | -5.3 | -1.9 | -0.3 |
| lear_l180_g | 21.7 | -18.4 | -11.5 | -7.1 | -3.7 | -0.4 | 1.7 |
| lear_r180_d1 | 21.7 | -18.4 | -11.0 | -7.4 | -4.4 | -0.0 | 2.5 |
| lear_r365w_d1 | 20.8 | -21.9 | -15.2 | -12.3 | -9.1 | -6.7 | -4.9 |
| lear_r365w_g_d1 | 20.8 | -21.8 | -15.2 | -12.0 | -8.4 | -6.0 | -4.0 |
| lgb_base | 21.5 | -19.3 | -18.1 | -17.1 | -15.5 | -14.2 | -13.9 |
| lgb_fuel | 20.3 | -23.6 | -21.8 | -20.5 | -18.9 | -17.7 | -17.2 |
| hyb_fuel | 20.9 | -21.5 | -20.2 | -19.4 | -18.1 | -17.2 | -17.0 |
| cb_fuel | 20.8 | -21.9 | -20.6 | -19.3 | -17.9 | -17.0 | -16.4 |
| ens_lt | 19.0 | -28.4 | -24.3 | -22.4 | -20.0 | -18.2 | -17.2 |
| ens_lb | 21.5 | -19.0 | -17.3 | -16.1 | -15.3 | -14.7 | -14.4 |

**38 zones pooled, `after`: MAE vs level+shape (%; negative = better)**

| model | MAE D+2 (EUR) | D+2 | D+3 | D+4 | D+5 | D+6 | D+7 |
|---|---|---|---|---|---|---|---|
| b_lvlshape | 42.3 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| a_ewm7 | 41.5 | -1.8 | -2.1 | -2.4 | -2.4 | -2.0 | -1.4 |
| b_ridge_nogas | 32.0 | -24.3 | -19.8 | -17.8 | -15.8 | -11.7 | -8.9 |
| b_ridge_gas | 32.2 | -23.9 | -19.5 | -18.0 | -15.9 | -11.1 | -8.8 |
| d_lin | 33.7 | -20.3 | -16.7 | -15.7 | -14.5 | -10.8 | -8.8 |
| k_level | 40.8 | -3.5 | -2.4 | -2.4 | -2.3 | -2.3 | -2.3 |
| k_gas | 40.4 | -4.5 | -4.3 | -4.6 | -4.3 | -3.4 | -2.5 |
| lear_r90 | 32.2 | -23.8 | -17.2 | -13.7 | -10.2 | -4.4 | -1.2 |
| lear_r90_g | 32.9 | -22.2 | -15.0 | -8.3 | -5.3 | -0.9 | 4.0 |
| lear_r180 | 31.2 | -26.2 | -19.7 | -16.0 | -12.2 | -7.3 | -4.0 |
| lear_r180_g | 31.8 | -24.7 | -17.8 | -13.6 | -9.3 | -3.9 | 0.6 |
| lear_r365 | 30.9 | -26.8 | -20.9 | -17.7 | -15.4 | -11.6 | -9.0 |
| lear_r365_g | 30.8 | -27.1 | -21.9 | -19.4 | -16.7 | -12.2 | -10.6 |
| lear_r365w | 30.8 | -27.3 | -21.2 | -18.0 | -15.2 | -10.2 | -7.9 |
| lear_r365w_g | 30.9 | -27.0 | -20.7 | -16.8 | -14.2 | -9.3 | -6.9 |
| lear_l180 | 31.3 | -26.0 | -20.1 | -16.6 | -13.3 | -8.3 | -5.0 |
| lear_l180_g | 31.5 | -25.4 | -19.1 | -15.3 | -11.9 | -6.6 | -2.6 |
| lear_r180_d1 | 30.8 | -27.1 | -20.7 | -17.4 | -13.8 | -8.6 | -4.8 |
| lear_r365w_d1 | 30.4 | -28.2 | -22.1 | -19.1 | -16.2 | -11.2 | -7.9 |
| lear_r365w_g_d1 | 30.4 | -28.0 | -21.8 | -18.4 | -15.2 | -9.9 | -6.3 |
| lgb_base | 36.6 | -13.5 | -8.8 | -7.3 | -5.9 | -2.2 | 0.7 |
| lgb_fuel | 33.2 | -21.5 | -16.9 | -14.4 | -11.9 | -8.3 | -5.8 |
| hyb_fuel | 33.5 | -20.9 | -16.9 | -14.7 | -12.3 | -8.9 | -6.2 |
| cb_fuel | 33.0 | -21.9 | -17.3 | -15.6 | -12.9 | -9.9 | -6.2 |
| ens_lt | 30.6 | -27.8 | -23.5 | -19.9 | -17.7 | -13.7 | -10.3 |
| ens_lb | 35.9 | -15.1 | -13.3 | -11.9 | -10.6 | -8.9 | -7.3 |

**Bias after 2026-09-01 (EUR/MWh; forecast minus actual, negative = too low)**

| model | bias D+2 | bias D+4 | bias D+7 |
|---|---|---|---|
| b_lvlshape | -6.0 | -7.8 | -9.2 |
| a_ewm7 | -10.3 | -12.1 | -13.9 |
| b_ridge_nogas | -5.9 | -10.2 | -13.5 |
| b_ridge_gas | 0.1 | -1.4 | -2.7 |
| d_lin | -0.1 | -1.8 | -4.2 |
| k_level | -7.8 | -9.7 | -11.1 |
| k_gas | -3.6 | -3.2 | -4.0 |
| lear_r90 | -5.0 | -9.2 | -13.0 |
| lear_r90_g | -3.2 | -8.5 | -10.9 |
| lear_r180 | -4.3 | -8.9 | -13.0 |
| lear_r180_g | -5.0 | -7.9 | -11.9 |
| lear_r365 | -5.4 | -10.2 | -13.1 |
| lear_r365_g | -0.8 | -2.8 | -3.5 |
| lear_r365w | -4.1 | -8.5 | -11.1 |
| lear_r365w_g | -2.5 | -5.2 | -7.4 |
| lear_l180 | -5.1 | -9.3 | -13.3 |
| lear_l180_g | -5.2 | -8.5 | -12.2 |
| lear_r180_d1 | -3.7 | -8.2 | -12.3 |
| lear_r365w_d1 | -3.4 | -7.5 | -10.4 |
| lear_r365w_g_d1 | -1.9 | -4.5 | -6.7 |
| lgb_base | -18.2 | -24.1 | -26.2 |
| lgb_fuel | -9.9 | -16.7 | -19.9 |
| hyb_fuel | -9.9 | -16.7 | -19.9 |
| cb_fuel | -9.7 | -16.6 | -20.3 |
| ens_lt | -6.1 | -11.6 | -13.9 |
| ens_lb | -5.7 | -12.2 | -14.5 |

**LEAR (rolling-window ridge/lasso)** (`family_models.py`, `family_backtest.py`). Pooled over hours (hour dummies and hour x wind/solar), one
model per zone and horizon, target = residual of level+shape, features as in `b_ridge` plus D-1/D-2/D-7/D-14 same-hour prices relative to
the 7-day level; refit every 7 days (daily for two configurations); the training window ends at the newest target settled when the block's
first forecast is issued.

* **Window: 365 days is best, 90 and 180 days are worse than the naive at D+5..D+7** (r90: +10.5 % at D+7, r180: +2.9 %, r365: -7.8 %). A
  180-day window is as good as 365 days only at D+2 after 1 September (-26.2 % vs -26.8 %).
* **Recency weighting (half-life 45 d, 365-day window):** full-period D+2 -22.1 % vs -22.7 % unweighted; after 1 September -27.3 % vs -26.8 % at
  D+2 but -7.9 % vs -9.0 % at D+7, bias after -4.1 vs -5.4 (D+2). A wash: it does not remove the level lag by itself.
* **Gas/carbon in the linear model:** with a 365-day window the bias after 1 September goes from -5.4 / -10.2 / -13.1 to **-0.8 / -2.8 / -3.5**
  and the MAE improves 0.2-1.7 pp (after 1 September); with 90-180-day windows adding 14 features makes it worse (variance).
* **Lasso (180 d)** vs ridge (180 d): lasso is 1.8-3.9 pp better pooled (-20.0 vs -18.2 at D+2, -1.0 vs +2.9 at D+7), still behind the 365-day ridge.
* **Daily refit instead of weekly:** r180 -19.8 vs -18.2, r365w -22.9 vs -22.1 at D+2 (1-2 pp at D+2..D+7): small; weekly is enough.

**Kalman local level with drift + weekday-hour shape** (`kalman_filter`, level-variance ratio per zone from the grid on data before 2025-04-01: 0.005 for 16 zones, 0.02 for 12, 0.05 for 9, 0.1 for 1, drift 0 for all, so
the level is very smooth and slow after the shift): -1.2 % (D+2) .. -4 % (D+7) over level+shape. With the gas error-correction term: -1.2 .. -2.4 % overall, but -4.5 % (D+2)
after 1 September and bias -3.6 vs -7.8. The state-space level is a better 'level' than the 7-day mean by a few percent and no more. It does
not pass the 5 % rule in any group at D+2 except Ireland (hold-out -6.5 %); not recommended.

**CatBoost as a drop-in for LightGBM** (EU 25 zones, same features, target and folds, MAE loss, 500 iterations depth 8). Pooled EU-25 MAE
with fuel: D+2 22.84 vs 22.60 (LightGBM), D+7 26.92 vs 26.93 over the whole period; after 1 September CatBoost is 2.5-3.1 % better at D+2..D+4
(34.9 vs 35.8 at D+2) and 2.4 % at D+7, before it 0.5-1.8 % worse. On the 13 Nordic zones CatBoost+fuel is worse (hold-out D+2 -16.2 % vs -17.7 %).
It costs 4-6x the Spark time (section 8). Not worth the switch; the only cells it wins are D+5..D+7 of CEE/SEE, by 1-2 points.

**Quantile regression and the P10-P90 band.** LightGBM with the quantile objective at 0.1/0.5/0.9 (EU 25 zones, fuel features), compared with the
current recipe (empirical residual quantiles of the last 180 days x 1.2, bands rolling out of sample) on the same hours (from 2025-10-06):

Coverage of the nominal 80 % band (%), mean width (EUR/MWh) and interval score (lower is better); 'recipe' = the current 180 days x 1.2 band on the median, 'raw' = the P10/P90 models, 'QR+recipe' = their edges moved by the same rolling recipe.

| period   | h   |   cover recipe % |   cover raw % |   cover QR+recipe % |   width recipe |   width raw |   width QR+recipe |   int. score recipe |   raw |   QR+recipe |
|:---------|:----|-----------------:|--------------:|--------------------:|---------------:|------------:|------------------:|--------------------:|------:|------------:|
| full     | D+2 |             81.1 |          68.3 |                80.1 |           77.9 |        62.5 |              77.6 |               128.3 | 120.3 |       117.6 |
| full     | D+4 |             80.6 |          64.9 |                79.5 |           85.4 |        63.2 |              83.8 |               140.9 | 134.9 |       129.7 |
| full     | D+7 |             80.6 |          64.6 |                79.1 |           93.6 |        67.7 |              90   |               151.2 | 145.4 |       139.8 |
| before   | D+2 |             83.4 |          68.5 |                80.8 |           76.5 |        57   |              71.9 |               118.8 | 110.1 |       108.1 |
| before   | D+4 |             83.1 |          65.2 |                80.5 |           83.6 |        57.8 |              78   |               129.4 | 122.9 |       118.9 |
| before   | D+7 |             83   |          65.1 |                80.1 |           91.9 |        62.6 |              84.4 |               139.3 | 132.9 |       128.6 |
| after    | D+2 |             68.7 |          67.3 |                76.4 |           85.5 |        92.1 |             108.2 |               179.1 | 174.6 |       168.5 |
| after    | D+4 |             67   |          63.4 |                74.5 |           94.8 |        92.2 |             114.8 |               201.9 | 198.7 |       187.3 |
| after    | D+7 |             67.3 |          62.1 |                73.9 |          103   |        95.2 |             120.1 |               214.5 | 212.2 |       199.8 |

* The raw P10/P90 models cover only 62-69 % of hours (nominal 80 %) and are too narrow, as the Nordic lesson said.
* The **current recipe covers 81 % overall but only 67-69 % after 1 September** (bands fitted on a calm half year meet a doubled price level).
* **Quantile-model edges widened by the same recipe** (`qr_recipe`: each edge moved by the rolling 10th/90th percentile of its own miss x 1.2) cover
  79-80 % overall, 74-76 % after 1 September, and have a lower interval score everywhere (full period -8 % at D+2 and D+7; after
  1 September -6 .. -7 %). Equal coverage, tighter bands at D+2 (77.6 vs 77.9 wide), a bit tighter at D+7 (90.0 vs 93.6). Worth adopting, not a fix for the
  regime shift. Linear quantile regression was not run.

**Ensembles** (`region_all.py`; components chosen per group and horizon on the select period). `ens_lt` = mean(best linear model, best tree
model); `ens_lb` = mean(level+shape, best single model). `ens_lt` is the group winner in 35 of 42 cells. Pooled over 38 zones it is 5.0 pp
better than LightGBM+fuel alone at D+2 (-28.3 % vs -23.3 %), 5.4 pp better than the 365-day ridge with fuel (-22.9 %), and 0.7 pp better than
LightGBM+fuel at D+7 (-16.2 % vs -15.5 %). `ens_lb` (pulling the best model toward level+shape) costs about 5 pp at D+2 (-18.4 %): the naive
baseline adds only error.

## 8. Spark time (nice 10, the box was shared; ~8 cores used)

| job | wall clock | notes |
|---|---|---|
| `fetch_fuel.py` (3 years) | ~10 s | 4 MIBGAS CSV + 4 EEX xlsx |
| `fuel_dataset.py` (EU 4.0 M rows, Nordic 2.4 M) | not timed (about a minute) | |
| LightGBM `rel+fuel` backtest, 10 folds | 4 min 37 s, 12 GB | the baseline run was 2 min 53 s (the box was busier this time) |
| Nordic model re-run (median only), base / fuel | 2 min 41 s / 2 min 44 s | 10 folds |
| ridge x2 + daily linear + rank-only LightGBM + reference models | 3 min 40 s, 12.6 GB | all 38 zones, 10 folds |
| LEAR, 10 variants, weekly refit, 38 zones | 4 min 23 s | 6 processes |
| LEAR daily refit, 2 configurations x 2 | 10 min 52 s | |
| quantile LightGBM (3 models x 10 folds) | 8 min 32 s | |
| CatBoost, EU 25 zones / Nordic 13 | 27 min 29 s / 11 min 25 s | 8 threads; 4-6x the LightGBM runs |
| scoring and tables (`region_all.py`) | ~3 min | |

Daily production cost of the recommended recipe: the LightGBM retrain as today (11 more features) plus 228 closed-form ridge solves (seconds). The whole
study took about 85 minutes of Spark wall-clock time, a third of it CatBoost.

## 9. Caveats, honestly

* **Two months of the new regime.** "After 2026-09-01" is ~60 days of one price shock (power 97 -> 177, gas 30 -> 100 EUR/MWh); the hold-out is four
  months. The gains after the shift are real in this sample and could be partly this episode.
* **Researcher freedom.** The first bake-off (ridge, rank, reference, EWM, daily linear) was seen before the families were added; LEAR windows, the
  Kalman grid, ridge strength and lasso alpha were fixed in advance and not tuned, but the families are a second look at the same data. Winners are
  chosen on the select period and judged on the hold-out; the same hold-out has now been looked at more than once.
* **Gas is a proxy** (Spanish PVB, daily index), carbon is an auction price, both EU-wide for all zones; no coal, no outages, no flows, no storage.
  Zone-specific hub spreads (PSV, CEGH, PEG) are not modelled.
* **Fuel cut-off is one day more cautious than reality**; a live system would see the issue-day gas index and the 11:00 auction, which is more
  than the backtest used.
* **Trees do not extrapolate**; the current LightGBM and CatBoost lag when the gas price leaves the training range. The live job retrains daily
  while the backtest retrains every two months, so the backtest probably overstates the lag of the trees relative to the live job (not measured).
* **Fold boundaries:** the 2-month folds let up to h-1 days of newer targets into training (inherited from the existing backtest); the LEAR
  refits do not.
* **Common-sample scoring** removes rows where any candidate column is missing (0.2 % of hours at the median, at most 1.1 %, in AL); published numbers on a zone's full sample
  differ slightly.
* **Nordic baseline** is the Nordic job's model re-run with the median only and 2-month folds; the stored `backtest_nordic.parquet` ends 2026-07-30.
  NL is scored in that framework. No holiday calendar exists for the Nordic zones and NL (flag = 0).
* **Regret verdicts are fragile:** near-threshold cells flip between neighbouring horizons.
* **Licences:** MIBGAS and EEX are used under "public data, cite the source"; get it confirmed in writing before relying on it.
* **Untested here:** AGSI+ storage (needs a key), linear quantile regression, outages, daily-refit for all variants, neural nets and foundation models
  (not asked).
