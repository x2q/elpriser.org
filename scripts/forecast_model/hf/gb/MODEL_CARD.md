---
license: cc-by-4.0
tags:
  - electricity
  - energy
  - power-markets
  - great-britain
  - ireland
  - portugal
  - time-series
  - forecasting
  - tabular-regression
  - lightgbm
  - ridge-regression
library_name: lightgbm
pipeline_tag: tabular-regression
pretty_name: Great Britain Intraday Electricity Price Estimate (gb-est-v1) and the Missing Hour 23 of Portugal and Ireland (hour23-v1)
---

# Great Britain price estimate `gb-est-v1` and the missing hour 23 of Portugal and Ireland `hour23-v1`

**Dansk resume.** Åbne vægte og kode til to små skøn på [elpriser.org](https://elpriser.org), hvor der mangler en pris. (1) **Storbritannien**: Elexons Market Index Price kommer time for time, så om
natten kender man kun få timer af i dag, og der er ingen "i morgen". Modellen skønner resten af dagen (opdateret hver time) og de næste 1-7 dage, med et P10-P90-bånd. (2) **Portugal og Irland**: den sidste lokale
time (23) af den nyeste dag mangler, til næste auktion er offentliggjort; den skønnes med en simpel regel (uden trænede vægte). I testen slår GB-modellen "niveau + ugeprofil" med 14-42 % (MAE), men **siden
prisstigningen i september 2026 er skønnet ligget 6-13 GBP/MWh for lavt, og båndet dækker kun ca. 61-71 % af timerne mod ca. 77-81 % i hele testperioden**. Ingen måling af den faktiske fejl i drift endnu.
Skønnet vises på elpriser.org som "Skøn", aldrig som en pris. Alle datakilder er licenseret til at blive brugt sådan her (se `DATA_LICENCES.md`); ingen gas- eller CO2-data indgår.

**English summary.** Open weights and code for two small estimators on [elpriser.org](https://elpriser.org) that fill in prices that do not exist yet. (1) **Great Britain**: Elexon's Market Index Price appears hour by hour, so at night only a few hours of today are
known and there is no tomorrow. The model estimates the rest of today (re-run every hour) and the next 1-7 days, with a P10-P90 band. (2) **Portugal and Ireland**: the last local hour (23) of the newest day has no price until the next auction is
published; a simple rule (no trained weights) estimates it. In the backtest the GB model beats "level + weekday profile" by 14-42 % (MAE), but **since the price rise of September 2026 the estimate has run 6-13 GBP/MWh too low and the P10-P90 band covered only about
61-71 % of the hours against about 77-81 % over the whole backtest**. No live error has been measured yet. The estimate is shown on elpriser.org as an "Estimate", never as a price. Every data source is licensed for this use (see `DATA_LICENCES.md`); no gas or carbon data are involved.

## What is in this repo

| Path | What |
|---|---|
| `weights/lgb50.txt`, `lgb10.txt`, `lgb90.txt` | LightGBM median, P10 and P90 boosters (text format, no pickles) |
| `weights/ridge_gb.npz` | 64 ridge regressions (8 as-of hours x 8 day offsets: the rest of today and D+1..D+7), plain arrays |
| `weights/config.json` | feature lists, training cut-off (`trainedThrough`), snapshot date |
| `gate/gb_gate.json`, `gate/gb_calibration.json` | which classes are published, their backtest numbers, and the band offsets |
| `gate/hour23_gate.json` | the hour-23 rule per zone, its backtest numbers and band offsets |
| `code/*.py` | the production modules, verbatim (features, models, Elexon parser, Open-Meteo fetch, hour-23 rule) |
| `gb_infer.py`, `predict_gb.py` | the inference entry points |
| `DATA_LICENCES.md` | licence audit of every data source |

`weights/` is a **snapshot**; production retrains daily. This repo is meant to be refreshed weekly by a job on the maintainers' server (git tag `snapshot-YYYY-MM-DD`; `config.json` has the date).

## Quick start (no keys needed)

```bash
pip install -r requirements.txt
python3 predict_gb.py --out estimate.json
```

It downloads the Elexon Market Index Price of the last 60 days (about ten requests) and the current Open-Meteo forecast for three points, builds the production feature rows for the current London hour and prints the estimate
for the rest of today and the forecast days that pass the gate. Programmatic: `gb_infer.estimate(price, wx_live, "weights")`.

Portugal and Ireland's hour 23 (`code/hour23.py`): `persist` = the price of hour 22; `med28` = hour 22 plus the median of (hour 23 minus hour 22) over the last 28 complete days. Which one a zone uses and the P10-P90 offsets are in `gate/hour23_gate.json`.

Reproduction check: on 2026-11-03, run from a fresh download on frozen inputs, this code reproduced the production prediction (point, P10 and P90 for all forecast hours) to within 1e-6 GBP/MWh.

## Great Britain: what is estimated

Elexon's **Market Index Price** (the volume-weighted price of the index providers' trades per half hour, averaged to an hour on the London clock; an hour counts only when both its half hours are priced). It is **not** the day-ahead auction price.
Classes: the rest of today from each of eight as-of hours (00, 02, 05, 08, 11, 14, 17, 20 London time; other hours use the nearest earlier class), and the days D+1 .. D+7.

**Method.** Naive reference "level + shape": the mean of the last 7 complete days plus the same weekday's profile of the last 4 weeks. The model is a **mean of a ridge (one per as-of hour and day offset, last 365 days) and a LightGBM**, both on the residual
of that reference. Features: the realised residuals of today's finished hours (decaying over the hours ahead), price lags that exist only if that day is complete, day-of-week and hour, England and Wales bank holidays, and the Open-Meteo forecast **as issued** (previous-runs API:
wind at 100 m, direct radiation, temperature, precipitation; three points: Scotland/North Sea, the Midlands, the southern North Sea). The trees get no absolute price level (a version with it was 17-25 GBP/MWh too low after the price rise: it cannot extrapolate).
P10/P90 from two LightGBM quantile models plus offsets (rolling 180-day error quantiles x 1.2). Training: Elexon prices from 2023-01-01, weather from 2024-04-25, 1.34 million rows, trained through the date in `config.json`.

**Backtest.** 2025-04-01 .. 2026-11-03, rolling origin with two-month refits (production retrains daily), hold-out from 2026-07-01, "since Sept" = from 2026-09-01. MAE in GBP/MWh (mean prices in these months were 70-210). One backtest, one regime change.
A class is published only if its MAE is at least 5 % below the naive reference on the whole backtest *and* the hold-out, and not above persistence (the last known price).

Rest of today:

GB_REST_TABLE

Forecast days (pooled over as-of 02, 08 and 14):

GB_DAYS_TABLE

**Read it like this**

* The model beats the reference everywhere it is published; the gain is largest for the hours just ahead (up to 42 % from 20:00) and smallest for D+6/D+7 (14 %; the cheapest-hours bar of 5 % on regret is not passed at D+7).
* **Since the price rise of September 2026 it runs too low** (bias -9.1 GBP/MWh for tomorrow, -12.7 at D+7; the gains in the tables are still measured against the reference).
* **Bands are measured, not promised:** 77-81 % of the hours over the whole backtest, 61-71 % since September.
* **Not live-measured.** The job went live on 2026-11-03.

## Portugal and Ireland: the missing hour 23

Both zones run one hour behind CET, so the day-ahead auction leaves the last local hour of the newest day without a price until the next auction is published (~11:45-12:45 UTC). One hour, estimated from the same day's hours 0..22 and the earlier days.
Backtest 2025-04-01 .. 2026-11-02 on about 580 days each:

HOUR23_TABLE

Portugal uses plain persistence (the median-step rule lost on the hold-out, so no gain is claimed); Ireland uses the median step (9.7 % better than persistence over the whole backtest, 2.6 % since September).
The Irish input in production is the SEMOpx day-ahead result (no licence stated by SEMOpx); this repo contains no SEMOpx data and the rule has no trained weights; the backtest used ENTSO-E prices.

## Limitations

* **A weekly snapshot, not the live model** (daily retrains are not reproduced).
* **Too low since September 2026**, and **bands too narrow** since then (see above).
* Intraday prices react to wind forecast errors, outages and interconnector flows within hours; none of that is known to the model beyond what today's finished hours reveal.
* The estimate is an **estimate**: do not treat it as a settled price, and do not use it for trading or hedging. Not financial advice.
* Intended use: consumer decision support (when is electricity cheap today and this week) as on [elpriser.org](https://elpriser.org).

## Data sources and attribution

* **Contains BMRS data (c) Elexon Limited copyright and database right 2026.** Licence: <https://www.elexon.co.uk/bsc/data/balancing-mechanism-reporting-agent/copyright-licence-bmrs-data/> (commercial use and redistribution allowed with this credit). No Elexon series is in this repo.
* Weather: **Weather data by [Open-Meteo.com](https://open-meteo.com)** (CC BY 4.0). Open-Meteo's free API, which `predict_gb.py` uses, is for non-commercial use only.
* Hour 23, Portugal: ENTSO-E Transparency Platform day-ahead prices (backtest only). Ireland: ENTSO-E in the backtest, SEMOpx in production (no licence stated; not in this repo).
* Public holidays: England and Wales bank holidays are computed in code.

## Licence

Weights, code and documentation: **CC BY 4.0**, credit "elpriser.org". The data sources keep their own terms (`DATA_LICENCES.md`).
More: [elpriser.org](https://elpriser.org), source repository [github.com/x2q/elpriser.org](https://github.com/x2q/elpriser.org), `scripts/forecast_model/gb` and `scripts/forecast_model/hf`.
