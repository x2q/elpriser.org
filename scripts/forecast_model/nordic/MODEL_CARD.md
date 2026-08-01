---
license: cc-by-4.0
tags:
  - electricity
  - energy
  - power-markets
  - nordic
  - denmark
  - norway
  - sweden
  - finland
  - netherlands
  - time-series
  - forecasting
  - tabular-regression
  - lightgbm
library_name: lightgbm
pipeline_tag: tabular-regression
pretty_name: Nordic + NL Electricity Price Forecast (13 bidding zones)
---

# Nordic + NL Electricity Price Forecast — 13 bidding zones

Day-ahead electricity price forecasts 2 to 9 days out, hourly, in EUR/MWh, for
every bidding zone in Denmark, Norway, Sweden, Finland and the Netherlands:

**DK1, DK2 · NO1, NO2, NO3, NO4, NO5 · SE1, SE2, SE3, SE4 · FI · NL**

Retrained and re-uploaded daily, so the weights here are what production runs.
A companion model specialised to Denmark alone lives at
[Elpriser/denmark-price-forecast](https://huggingface.co/Elpriser/denmark-price-forecast).

## Design: one pooled model, not thirteen

A single LightGBM quantile model covers all 13 zones, with `zone` as a
categorical feature. The zones share nearly all their structure — the same
calendar effects, the same weather physics, the same lag behaviour — so
pooling lets a thin zone borrow strength from a busy one, and leaves one
thing to maintain instead of thirteen.

Pooling only works because the model can identify a zone's price **level**
before it starts explaining deviations. NO4 averages 22 EUR/MWh and NL 90; a
pooled model on raw prices would otherwise spend its capacity rediscovering
that. Three features carry it: the zone id, `last_day_mean`, and `level_30d`
(the zone's own trailing 30-day average, measured to the last *known* day).

## Read the metrics carefully — most of them lie across zones

This is the single most important thing to understand about this model.

**Percentage MAE punishes cheap zones.** NO4's mean absolute error is
14.1 EUR/MWh — *lower* than DK1's 25.6 — but it reads as 64% because NO4's
mean price is only 22 EUR/MWh. Nothing is wrong with the forecast there; the
denominator is small.

**Min-hour hit-rate measures the daily price spread, not forecast skill.**
Hit-rate tracks how far apart a day's cheapest and dearest hours are:

| Zone | Median daily spread | Hit-rate |
|---|---|---|
| NL | 128 EUR/MWh | 77% |
| DK1 | 116 | 70% |
| NO3 | 27 | 28% |
| NO4 | 12 (28% of days essentially flat) | 24% |

When the day's hours differ by 12 EUR/MWh, ranking them is close to random —
and getting it wrong costs almost nothing.

**Use regret instead.** Regret is what following the forecast's three cheapest
hours costs versus perfect timing. It stays meaningful whatever the zone's
price level or spread.

## Performance

Rolling-origin backtest, monthly retrain, tested April 2025 → July 2026.

| Zone | Mean price | MAE | Regret | Regret, seasonal baseline | Captured |
|---|---|---|---|---|---|
| DK1 | 86.4 | 25.6 | **6.0** | 7.0 | 89% |
| DK2 | 87.8 | 26.9 | **7.2** | 8.3 | 87% |
| NL | 90.2 | 23.5 | **7.8** | 8.6 | 88% |
| SE4 | 70.6 | 27.0 | **7.4** | 8.5 | 83% |
| SE3 | 55.6 | 22.8 | **6.6** | 7.1 | 79% |
| NO2 | 80.4 | 19.0 | **6.6** | 7.2 | 79% |
| NO1 | 75.3 | 20.5 | **7.9** | 8.5 | 73% |
| FI | 49.1 | 31.8 | **10.7** | 12.4 | 65% |
| NO5 | 68.5 | 17.2 | **7.0** | 7.7 | 60% |
| SE1 | 30.2 | 21.3 | **7.0** | 7.5 | 55% |
| SE2 | 30.4 | 22.1 | **7.2** | 7.9 | 54% |
| NO3 | 46.8 | 16.6 | **7.8** | 8.3 | 46% |
| NO4 | 22.2 | 14.1 | **6.0** | 6.5 | 46% |

"Captured" is the share of the available timing saving the forecast captures
versus running at a random hour.

Two things to take from this. The model **beats a seasonal baseline in all 13
zones** on regret. And absolute regret is strikingly uniform — 6 to 8 EUR/MWh
almost everywhere, FI's 10.7 the only outlier — so in terms of what a user
actually loses by following it, the model performs comparably across a market
where mean prices differ fourfold. The lower "captured" figures in NO3, NO4,
SE1 and SE2 reflect there being less to capture, not worse forecasts.

Pooled MAE 22.2 EUR/MWh, against 25.7 for the seasonal baseline and 28.2 for
persistence. MAE by horizon rises gently from 20.1 (h=2) to 23.6 (h=9).

## Features

30 per row, at horizon `h` (2-9):

- **Zone & calendar** — `zone` (categorical), `h`, `hour`, `weekday`, `month`, `is_weekend`, `doy_sin`, `doy_cos`
- **Price history** — `lag1/2/3/7/14/21/28`, filled **only when known at issue time** (`k >= h-1`), `seasonal4w`, `last_day_mean`, `level_30d`
- **Own-zone weather at the right lead** — `wind`, `rad`, `temp`, `precip`, `precip_24h`
- **Regional state** — `reg_wind`, `reg_temp`, `hydro_precip`, `hydro_precip_7d`
- **Hydro reservoirs** — `reservoir_pct`, `reservoir_anom`, `nordic_reservoir_anom`

Weather comes from Open-Meteo's previous-runs archive: the forecast **as
issued** N days before delivery, so training rows carry the same information
quality the live model gets. Precipitation is included because NO and SE
prices are set by reservoir hydrology, where rainfall is a genuine driver in a
way it is not in Denmark.

### Why reservoirs are in

The first backtest had the model **losing to a plain seasonal average** in
NO1 (+1.3%) and NO2 (+8.1%) — the signature of a missing level driver. Nordic
prices follow water value: producers hold water back when reservoirs are low
and release when full. Adding weekly reservoir levels (ENTSO-E A72, lagged 14
days, expressed as share-of-maximum and as deviation from the zone's median
for that week of year) turned NO1 to −1.7% and NO2 to −0.3%. The Nordic
aggregate goes to *every* zone including DK and NL, because the market is
coupled and a dry Norwegian year lifts prices well beyond Norway.

## Post-processing

**Shape blend.** The model's daily level is kept, its intraday shape blended
50/50 with a 4-week seasonal profile. Carried over from the Danish model,
where that was measured to beat both parents on both accuracy and hour-ranking.

**Bands are additive empirical residual quantiles**, not scaled model
quantiles. Scaling was tried first, as the Danish model does it, and broke
down: DK, NL and SE3/SE4 needed a sensible ~1.8-2.0x, but NO4 needed **8.0x
and still missed 80% coverage**, NO5 up to 7.5x, SE1/SE2 up to ~5x. A band
inflated eightfold is not measuring uncertainty, it is being stretched to pass
a check. Taking the 10th and 90th percentiles of actual residuals per zone and
horizon gives correct coverage by construction.

## Limitations

- **The bands are only informative in the structured zones.** At 80% coverage
  the band width is 70-96% of the mean price in DK, NL, NO1/NO2/NO5 — wide but
  usable. In SE1 and SE2 it is 243-253%, and in FI and NO4 around 200%. Those
  zones sit near a stable level and then spike hard, so an honest 80% interval
  is nearly uninformative about level. The point forecast and the hour-ranking
  still work there; the interval does not.
- **One weather point per zone.** Deliberate, to keep 13 zones maintainable,
  but coarser than the 14-point setup the Denmark-only model uses. Large zones
  like NO4 and SE1 are poorly represented by a single coordinate.
- **No interconnector or congestion modelling.** The Denmark-only model
  includes month-ahead transfer capacity; this one does not.
- **Reservoir data is weekly and lagged.** Deliberately shifted 14 days to
  stay clear of publication timing, so fast hydrological swings arrive late.
- **Not financial or trading advice.** These are wholesale day-ahead prices,
  not retail bills, which add grid tariffs, taxes and VAT.

## Intended use

Consumer and household decision support — when in the coming week to run
flexible load — and research. Not validated for trading or hedging.

## Sources & license

CC BY 4.0. Prices and reservoir levels: ENTSO-E Transparency Platform.
Weather: Open-Meteo. Code: [elpriser.org on GitHub](https://github.com/x2q/elpriser.org),
`scripts/forecast_model/nordic/`.
