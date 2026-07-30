---
license: cc-by-4.0
tags:
  - electricity
  - energy
  - power-markets
  - denmark
  - time-series
  - forecasting
  - tabular-regression
  - lightgbm
library_name: lightgbm
pipeline_tag: tabular-regression
pretty_name: Denmark Day-Ahead Electricity Price Forecast (DK1/DK2)
---

# Denmark Day-Ahead Electricity Price Forecast

Quantile LightGBM models forecasting DK1 (West Denmark) and DK2 (East Denmark)
day-ahead spot electricity prices, 2 to 9 days ahead. This is the exact model
powering the [/prognose](https://elpriser.org/prognose) page on
[elpriser.org](https://elpriser.org).

**This repo is live**: it is retrained from scratch and re-uploaded daily
(14:10 UTC, after the day-ahead auction publishes), so the weights here are
always the model currently running in production — not a fixed checkpoint.
Training data comes from the sibling
[Denmark Power Market](https://huggingface.co/datasets/Elpriser/denmark-power-market)
dataset (prices, production) plus live weather.

## Why this exists

A naive version of this model — train on *actual* weather, predict with a
*weather forecast* at inference time — looks great in a backtest and is wrong
in production, because the model never sees the noisier forecast-vs-actual
gap it has to predict through. This model is trained specifically to avoid
that: every training row uses the weather forecast **as it looked when
issued**, not the eventual actual. See "Training data" below.

## Task & horizons

| Horizon | What it covers |
|---|---|
| Day 0-1 | Actual published day-ahead prices (not modeled — just passed through) |
| **Day 2-9** | This model: hourly quantile forecast (P10/P50/P90), DKK/MWh |

Day 10+ (month/season outlook) was built, backtested, and **deliberately
dropped** from the product — at that range the honest answer is "current
price level ± 50%", which reads as noise rather than signal. Not published
here.

## Architecture

Per area (DK1, DK2), three independent LightGBM quantile regressors
(`objective=quantile`, α = 0.1 / 0.5 / 0.9), each trained on ~166k rows
(2024-03-15 → present, 8 horizons × 24 hours). Plus two small weather→
production regressors (DK, DE) used to build one of the input features — see
`wind_estimator_*.txt`.

**Files in this repo:**

| File | What it is |
|---|---|
| `dk1_lo.txt` / `dk1_md.txt` / `dk1_hi.txt` | DK1 quantile boosters (P10/P50/P90), LightGBM text format |
| `dk2_lo.txt` / `dk2_md.txt` / `dk2_hi.txt` | Same for DK2 |
| `wind_estimator_dk1.txt` / `_dk2.txt` / `_de.txt` | Weather → wind+solar production estimators (feed the `est_prod*` features below) |
| `calibration_hourly.json` | Conformal band-widening factors per area/horizon (see "Uncertainty bands") |
| `config.json` | Feature list, horizons, quantile levels, weather coordinates, last training date |
| `train_daily.py` / `dataset.py` | The exact training + inference code (Python), including the post-processing formulas below |

Load a booster directly:

```python
import lightgbm as lgb
booster = lgb.Booster(model_file="dk1_md.txt")
```

## Features

23 features per row, computed at a specific forecast horizon `h` (2-9):

- **Calendar**: `hour`, `weekday`, `month`, `is_weekend`, `doy_sin`, `doy_cos`, `h` (the horizon itself)
- **Price history**: `lag1`/`lag2`/`lag3`/`lag7`/`lag14`/`lag21`/`lag28` (same hour, k days back) — **only populated when actually known at issue time** (`k >= h-1`; anything else would be leakage — e.g. at h=5 you don't know lag1-3 yet), `seasonal4w` (mean of lag7/14/21/28), `last_day_mean` (most recent fully-known day's average)
- **Weather at correct lead time**: `wind`, `rad` (DK, at the area's representative coordinate), `wind_de`, `rad_de` (Germany, since DK1 is heavily price-coupled to DE-LU), `temp` (DK — demand driver, not just a supply-side signal)
- **Derived production estimate**: `est_prod`, `est_prod_de` — the weather→production regressors' output, i.e. "how much wind+solar does this weather imply"

Weather features come from Open-Meteo's **previous-runs API**
(`previous_day{1..7}` — the forecast as issued N days before the delivery
hour, not the eventual actual), matched to the horizon: horizon `h` uses lead
`min(h, 7)`. The archive only goes back to 2024-03-15, which sets the
training window.

## Post-processing (not baked into the raw booster — apply this yourself)

Two things happen after the raw quantile prediction, both backed by backtest
evidence, both required to reproduce what elpriser.org actually shows:

**1. Hybrid shape.** The raw model's hour-to-hour curve is *worse* at
ranking hours than a dumb 4-week seasonal profile (61% vs 67% min-hour
hit-rate in backtest) — weather-driven noise hurts intraday ranking even
where it helps the daily level. The fix: keep the model's predicted **daily
average**, but blend its **intraday shape** 50/50 with the seasonal profile's
shape:

```python
seasonal = mean_price_by(weekday, hour)  # last 28 known days
hybrid[hr] = model_pred.mean() + 0.5 * (
    (model_pred[hr] - model_pred.mean()) + (seasonal[hr] - seasonal.mean())
)
```

This beat *both* parents on *both* metrics: MAE 192/204 DKK/MWh (DK1/DK2)
vs. 196/206 (pure model) and 224/239 (pure seasonal); hit-rate 70%/69% vs.
61%/68%.

**2. Conformal band widening.** The raw P10/P90 quantile gap covered only
~52% of actual outcomes in backtest (LightGBM quantile regression is not
naturally well-calibrated for this data). `calibration_hourly.json` holds a
per-area, per-horizon multiplier (~1.9-2.3×) fit so the widened band hits 80%
empirical coverage:

```python
half_lo = model_p50 - model_p10
half_hi = model_p90 - model_p50
factor = calibration_hourly[area][str(h)]
band_lo = hybrid - factor * half_lo
band_hi = hybrid + factor * half_hi
```

See `score_area()` in `train_daily.py` for the exact, complete implementation
(including the h<2 passthrough and the "day is already actual" branch).

## Training data

- **Prices**: Energinet EDS `DayAheadPrices` / `Elspotprices` — see
  [Denmark Power Market](https://huggingface.co/datasets/Elpriser/denmark-power-market)
- **Production** (estimator target): Energinet EDS `ProductionConsumptionSettlement`
- **Germany wind+solar** (estimator target): ENTSO-E `entsoe_delu_generation_per_type`
- **Weather**: [Open-Meteo](https://open-meteo.com) previous-runs API (forecast-as-issued)
  + archive API (actuals, for fitting the production estimators), 3 coordinates:
  DK1 (56.0, 9.5), DK2 (55.5, 12.0), Germany (54.0, 9.5)

## Performance

Rolling-origin backtest, monthly retrain, tested April 2025 → July 2026
(post-processing applied, i.e. these are the numbers that match what the
site shows):

| | DK1 | DK2 |
|---|---|---|
| MAE, T+1..2 (% of mean price) | 27.0-27.9% | 28.3-28.5% |
| MAE, T+3..9 (% of mean price) | 31.1-31.7% | 32.1-32.7% |
| MAE, hybrid (DKK/MWh, all horizons) | 192.2 | 203.9 |
| Min-hour hit-rate (actual cheapest hour in predicted top-3) | 70.1% | 68.5% |
| P10-P90 coverage after calibration | ~80% | ~80% |

Baselines on the same backtest: seasonal 4-week heuristic 34.7-38.2% MAE,
naive persistence (same hour, most recent known day) 40.7-46.5% MAE.

These numbers are a **floor**: the backtest deliberately uses a
weather-forecast lead *at least* as old as what the operational run would
see (conservative), so live accuracy should be at or above this.

## Limitations

- **Interconnector congestion is not modeled.** JAO's Nordic flow-based
  congestion data was investigated and explicitly excluded — both because
  its terms prohibit redistribution, and because it's only published ~1 day
  ahead of delivery, so it can't help a T+2..T+9 forecast anyway. Unplanned
  outages on DK1/DK2's interconnectors are a real, unmodeled source of error.
- **Single representative coordinate per area**, not a spatial average — a
  reasonable approximation, not a proper grid-weighted estimate.
- **The hybrid shape blend assumes the last 4 weeks' intraday pattern is
  still informative.** During a fast regime shift (e.g. a sudden large new
  solar/wind capacity coming online, or an extreme weather event outside
  recent experience), this will lag.
- **Not financial or trading advice.** This forecasts a wholesale spot price
  component, not your actual electricity bill, which includes grid tariffs,
  taxes and VAT that vary by network operator and change over time.

## Intended use

Household/consumer decision support — "when in the next week should I run
the dishwasher / charge the EV" — as implemented on
[elpriser.org/prognose](https://elpriser.org/prognose). Not validated for
wholesale trading, hedging, or any other financial decision.

## License

CC BY 4.0, matching the underlying data (Energinet, ENTSO-E — both CC BY
4.0; Open-Meteo is free for both commercial and non-commercial use with
attribution). Source code: [elpriser.org on GitHub](https://github.com/x2q/elpriser.org),
`scripts/forecast_model/v2/`.
