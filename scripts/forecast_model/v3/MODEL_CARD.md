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

# Denmark Day-Ahead Electricity Price Forecast — v3

Quantile LightGBM models forecasting DK1 (West Denmark) and DK2 (East Denmark)
day-ahead spot electricity prices, 2 to 9 days ahead. This is the exact model
powering [elpriser.org/prognose](https://elpriser.org/prognose).

**This repo is live**: retrained from scratch and re-uploaded daily (14:10 UTC,
after the day-ahead auction publishes), so the weights here are always what
production is running. Training data comes from the sibling
[Denmark Power Market](https://huggingface.co/datasets/Elpriser/denmark-power-market)
dataset plus live weather and ENTSO-E capacity data.

## What changed in v3

v3 was built specifically to remove the three limitations v2's model card
admitted to. All three are addressed, and the backtest below reports what each
change was actually worth rather than asserting that it helped.

**1. Interconnector congestion is now modelled** (v2: "not modelled").
Two complementary features. *Neighbouring-zone weather* (NO2, SE3, SE4, NL) at
the same forecast leads as Denmark: congestion binds when a price spread pushes
flow past what a border can carry, and those spreads are driven by the
neighbours' weather — which, unlike congestion data itself, genuinely exists 10
days out. *Month-ahead transfer capacity* (ENTSO-E A61, contract type A03)
covers the capacity side: scheduled derating and maintenance, published a month
ahead and therefore leakage-free at every horizon here.

**2. Weather is now spatially resolved** (v2: "single representative
coordinate per area"). Fourteen points: the offshore wind clusters that dominate
Danish wind (Horns Rev, Anholt, Rødsand), German wind in the north and German
solar in the south, plus the four neighbouring zones. Points enter as individual
features rather than hand-weighted averages. `wind_spread` — the max-minus-min
across an area's points — is its own signal: a wide spread means a front is
crossing, which is exactly when production forecasts are least reliable.

**3. The shape blend now has a regime guard** (v2: "assumes the last 4 weeks'
intraday pattern is still informative"). See "Post-processing" below.

## Task & horizons

| Horizon | What it covers |
|---|---|
| Day 0-1 | Actual published day-ahead prices (passed through, not modelled) |
| **Day 2-9** | This model: hourly quantile forecast (P10/P50/P90), DKK/MWh |

## Architecture

Per area, three LightGBM quantile regressors (`objective=quantile`,
α = 0.1 / 0.5 / 0.9) trained on ~166k rows (2024-03-15 → present, 8 horizons ×
24 hours), plus small weather→production regressors used to build two of the
features.

**The two areas do not use the same feature set, on purpose.** The
interconnector-capacity block helps DK1 but measurably *hurt* DK2 in backtest
(see the ablation). DK1 has four borders to DK2's two, so the same block carries
much less signal in DK2 and mostly adds variance. `config.json` records which
variant each area uses.

| File | What it is |
|---|---|
| `dk1_lo/md/hi.txt`, `dk2_lo/md/hi.txt` | Quantile boosters, LightGBM text format |
| `wind_estimator_dk1/dk2/de.txt` | Weather → wind+solar production estimators |
| `calibration_hourly.json` | Conformal band-widening factors per area/horizon |
| `config.json` | Per-area feature lists, horizons, quantile levels, blend settings |
| `train_daily.py`, `dataset.py`, `fetch_ntc.py`, `fetch_weather_v3.py` | The exact training, inference and data-collection code |

```python
import lightgbm as lgb
booster = lgb.Booster(model_file="dk1_md.txt")
```

## Features

Roughly 55-60 per row depending on area, computed at a specific horizon `h` (2-9):

- **Calendar** — `hour`, `weekday`, `month`, `is_weekend`, `doy_sin`, `doy_cos`, `h`
- **Price history** — `lag1/2/3/7/14/21/28` (same hour, k days back), populated
  **only when actually known at issue time** (`k >= h-1`; at h=5 you do not yet
  know lag1-3, and using them would be leakage), plus `seasonal4w` and
  `last_day_mean`
- **Weather, per point, at the correct lead** — `wind_p0..p3`, `rad_p0..p3`,
  `temp_p0..p3` for the area's own points; `wind_de0..2`, `rad_de0..2` for
  Germany; `wind_{no2,se3,se4,nl}`, `rad_{...}` for neighbours; plus means and
  `wind_spread`
- **Derived production** — `est_prod`, `est_prod_de`
- **Interconnector capacity (DK1 only)** — `ntc_{border}_{exp,imp}` scaled by
  each border's own maximum, plus `ntc_exp_mean`, `ntc_imp_mean`, `ntc_min`

Weather comes from Open-Meteo's **previous-runs API** (`previous_day{1..7}` —
the forecast as issued N days before the delivery hour, not the eventual
actual), matched to the horizon: horizon `h` uses lead `min(h, 7)`. That archive
starts 2024-03-15, which sets the training window.

## Post-processing (apply this yourself — the raw booster is not the whole model)

**1. Hybrid shape with a regime guard.** The raw model's hour-to-hour curve
ranks hours *worse* than a plain 4-week seasonal profile, so the model's daily
**level** is kept while its intraday **shape** is blended with the seasonal
profile's:

```python
seasonal = mean_price_by(weekday, hour)   # last 28 known days
hybrid[hr] = pred.mean() + (1-a)*(pred[hr] - pred.mean()) + a*(seasonal[hr] - seasonal.mean())
```

`a` is 0.5 by default. The guard tracks how well the seasonal profile's *shape*
has tracked reality over the last 14 days versus its own 90-day median (lagged
10 days so nothing inside any horizon's unknown window leaks in). Only when that
ratio exceeds 1.15 does `a` fall, toward 0 as the profile degrades further.

The guard is deliberately one-directional and conservative, because the
alternative was tried and rejected: a freely-fitted blend weight (grid-searched
on a held-out recent slice each month) improved MAE but **cost min-hour
hit-rate in both areas** — DK1 69.3% → 67.9% — i.e. it got worse at the one
thing the forecast is actually used for. A weight fitted on 30 days of holdout
simply does not generalise to the next month. The guard keeps the MAE gain
without that cost.

**2. Conformal band widening.** LightGBM's raw quantile spread covers only
~50-55% of outcomes here. `calibration_hourly.json` holds per-area, per-horizon
multipliers (~1.7-2.2×) fitted so the widened band reaches 80% empirical
coverage:

```python
factor = calibration_hourly[area][str(h)]
band_lo = hybrid - factor * (p50 - p10)
band_hi = hybrid + factor * (p90 - p50)
```

`score_area()` in `train_daily.py` is the complete, authoritative implementation.

## Performance

Rolling-origin backtest, monthly retrain, tested April 2025 → July 2026, with
post-processing applied. Each row adds to the one above it, so the ablation
shows what each change was actually worth:

| Variant | DK1 MAE | DK2 MAE |
|---|---|---|
| v2-equivalent baseline | 187.3 | 201.8 |
| + spatial (multi-point weather) | 184.5 (−1.5%) | 197.8 (−2.0%) |
| + neighbouring-zone weather | 181.8 (−3.0%) | 192.2 (−4.8%) |
| + interconnector capacity | 179.5 (−4.2%) | 194.8 (−3.5%) ⚠ |
| **+ regime guard — shipped v3** | **178.4 (−4.8%)** | **189.9 (−5.9%)** |

⚠ is the reason the configuration is asymmetric: capacity features help DK1 and
hurt DK2, so DK2 ships without them (its shipped figure builds on the
neighbour-weather row).

| | DK1 | DK2 |
|---|---|---|
| MAE, T+1..2 (% of mean price) | ~25% | ~27% |
| MAE, T+3..9 (% of mean price) | ~30% | ~31% |
| Min-hour hit-rate (cheapest hour in predicted top-3) | 69.0% | 70.0% |
| P10-P90 coverage after calibration | 80.5% | 80.3% |

Baselines on the same backtest: seasonal 4-week heuristic ~35-38% MAE, naive
persistence ~41-46%.

These figures are a **floor**: the backtest deliberately uses a weather-forecast
lead at least as old as the operational run would see.

## Why this exact configuration (Pareto analysis)

MAE and min-hour hit-rate are genuinely competing objectives here: leaning on
the model's own intraday shape sharpens the price level, leaning on the
seasonal profile ranks the cheap hours better. `pareto.py` sweeps the whole
achievable set — 4 feature variants × 21 blend weights per area — and
`pareto_plot.py` plots it.

Two results worth stating:

- **The shipped configuration sits on the Pareto frontier in both areas.**
  Nothing available is better on one objective without being worse on the
  other, so there is no free improvement left in this design space.
- **v2 is dominated.** In DK1 a v3 config reaches ~4.6% lower MAE at the same
  hit-rate; in DK2 v3 is better on *both* objectives at once. The v3 changes
  moved the frontier outward rather than just sliding along it.

Moving *along* the frontier was tested and deliberately not done. Raising the
guard's base weight looks tempting (DK1 hit-rate 69.0% → 69.7%), but a paired
bootstrap over 486 days puts the MAE cost firmly outside zero (+1.06 to +1.63
DKK/MWh, 95% CI) while the hit-rate gain barely clears it (+0.05 to +1.49).
That is paying something certain for something that may not be there — and
picking the best-looking point from the same backtest the numbers are reported
from would be selection on the test set. Anyone wanting a different balance
should treat it as a product decision and re-validate on fresh data, not tune
against this backtest.

## Limitations

- **Unplanned outages are still invisible.** v3 models *scheduled* capacity
  (published a month ahead) and the weather-driven price spreads that make
  congestion bind. A forced trip on an interconnector remains unmodelled and is
  the largest remaining source of large errors — nothing published far enough
  ahead can capture it.
- **Fourteen points is better than one, but it is still not a grid-weighted
  field.** No generation-capacity weighting is applied; the model infers what
  each point is worth from data, which needs enough history to do well.
- **The regime guard reacts, it does not predict.** It needs roughly two weeks
  of degraded seasonal tracking before it moves, so the first days of a sharp
  regime change are still forecast with the old assumption.
- **The DK1/DK2 asymmetry is empirical, not theoretical.** Capacity features
  hurting DK2 is a single backtest result with a plausible explanation, not an
  established fact; it should be re-checked as history accumulates.
- **Not financial or trading advice.** This forecasts a wholesale spot price
  component, not a household bill, which also includes grid tariffs, taxes and
  VAT that vary by network operator.

## Intended use

Household and consumer decision support — "when this week should I run the
dishwasher or charge the car" — as implemented on
[elpriser.org/prognose](https://elpriser.org/prognose). Not validated for
wholesale trading, hedging, or any other financial decision.

## License

CC BY 4.0, matching the underlying data (Energinet and ENTSO-E, both CC BY 4.0;
Open-Meteo free for commercial and non-commercial use with attribution).
Source: [elpriser.org on GitHub](https://github.com/x2q/elpriser.org),
`scripts/forecast_model/v3/`.
