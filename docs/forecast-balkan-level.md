# The level since September 2026: diagnosis, six candidates, and a regional level correction for me mk rs xk al gr (2026-11-08; staged on `balkan-level`, nothing rolled out)

Question (owner, "proposal 1"): restore forecast skill in the weakest zones since the September 2026 price-level shift: `me` and `mk` (D+5 gain since 2026-09-01: 0 %), `rs` (2 %), `xk` (3 %), `al` (4 %), `gr` (8 %); also watch `it-n`, `sk`, `hu`.
Everything ran on the Spark in **copies** (`~/eu-forecast-bl`, `~/eu-forecast-bl-stage`; production `~/eu-forecast`, `~/nordic`, `~/prognose3`, the crontab, the three gate files, KV and the Worker were not touched; no push, no deploy).
Scripts: `scripts/forecast_model/eu/research_balkan/` (`diag_*.py` diagnosis, `bl_frame.py` / `bl_ridge.py` / `bl_lgb.py` candidates, `bl_eval.py` / `bl_candidates_table.py` scoring, `bl_gate.py` / `bl_cells.py` / `merge` chain, `fetch_a72.py`, `fetch_ecmwf.py`, `bl_ecmwf_frame.py`).

## Answer in eight lines

1. **It is a level problem in five of the six zones, and it is regional.** Since 2026-09-01 the model's day LEVEL is no better than "the mean of the last 7 days" in `me mk rs xk al` (D+5 level MAE 31.6 / 34.0 / 37.2 / 40.0 / 39.3 against 29.6 / 32.2 / 37.0 / 37.8 / 38.0) and better only in the within-day SHAPE (20-36 against 24-40). `gr` is the opposite: its level is better (26.8 against 34.5), its shape worse (31.9 against 30.8).
2. **What moved the level is a price run the trailing level cannot see.** Balkan prices: Aug 135-150, Sep 150-171, Oct 225-242, Nov 261-287 EUR/MWh; the day-level error is 70 % explained by "how far the actual day mean ran away from `level_7d`" (R^2 0.70), only 24 % by the weather forecast anomalies, 29 % by the gas trend and gap, 37 % by both. The model adds 2-7 EUR/MWh of negative bias on top of level+shape's own (D+5: -16..-25 against -14..-18); October is the bad month (-39..-49 against -27..-33).
3. **Region-wide, not per zone**: the day-level errors of me mk rs xk al gr hu ro bg correlate 0.65-0.98 (DE 0.0-0.2); one common factor carries 46 % of their variance.
4. **Six candidates, one protocol** (same folds, hold-out 2026-07-01.., level+shape baseline, 5 % rule on hold-out AND whole backtest, nothing chosen on the hold-out): (a) level-anchored target, (b) regional level features, (c) ECMWF IFS ENS weather, (d) hydro (A72), (e) the parked 730-day ridge, (f) the level correction. **Only (f) moves the level**: since September the Balkan six go from 6.5 to 13.1 % mean gain (fuel mode, all horizons), bias D+5 -19 -> -14, level MAE 35.7 -> 31.3.
5. **What does not help** (section 3): anchors (the ridge is anchor-invariant by construction; a 3-day anchor loses 0.9-1.2 points everywhere), level-invariant tree (-0.35 whole / -0.71 select), regional features (nothing), hydro (-0.4 whole / -0.6 select, the tree -0.6 on the hold-out), ECMWF ENS weather (a real but small weather gain in the 13 zones, +0.4 whole / +0.35 select, none since September), the 730-day ridge (small: +0.15 whole, +0.6 hold-out, +1.9 points since September in the six; keeps the owner's winter-2025/26 caveat).
6. **(f) is a trade, not a free lunch**: applied to all 26 zones it is neutral on the whole backtest (-0.09 points), +0.9 on the hold-out, **-0.5 on the select period**, and it costs the Baltics 1.3-1.8 points on the hold-out (worst cell -2.5) and DE / FR / PL / CZ / SK 0.5-2. So it is staged **regionally, for the six zones named in the task** (a declaration that follows the diagnosis, see the caveat in section 4): 34 zone-horizon cells change, **all 34 better on the hold-out and since September, 31 better and 2 worse by 0.1 points or less on the whole backtest**; the 120 other fuel-mode cells are byte for byte production's.
7. **Gate effect**: `xk` D+7 passes the 5 % rule (hold-out 8.6 %, was 4.95 %) and is published with `low: true`; `al` D+7 stays off (owner's `forcedOff`; numerically 11.7 % / 10.3 %); no horizon is lost; the no-fuel fallback gains `xk` D+6, D+7.
8. **Ramp-in**: the job computes the correction from its own archive (started 2026-11-03); on 2026-11-08 only D+2..D+4 have three settled days, D+5..D+7 get their correction over the next one to two weeks, `xk` (live since today) later. No live evidence yet that the correction helps (`live_shadow_check.py`: the shadow equalled the model's own numbers on 366 settled days).

## 1. Diagnosis

Frame: the 26-zone research frame of `forecast-xk.md` (prices cut at 2026-11-02), the production recipe (ridge 365 d + LightGBM with fuel; `regions_bl.parquet` = the single stored LightGBM draws) , 63 settled days since 2026-09-01. `diag_level_shape.py`, `diag_drivers.py`. All EUR/MWh.

### Level and shape, D+5, since 2026-09-01 (level+shape | production recipe)

| zone | mean price | day-level MAE | day-level bias (forecast - actual) | within-day shape MAE |
|---|---|---|---|---|
| me | 195 | 29.6 \| 31.6 | -13.5 \| -15.9 | 24.2 \| 20.4 |
| mk | 192 | 32.2 \| 34.0 | -16.8 \| -19.8 | 24.3 \| 20.8 |
| rs | 196 | 37.0 \| 37.2 | -17.1 \| -21.0 | 28.0 \| 23.6 |
| xk | 205 | 37.8 \| 40.0 | -15.2 \| -22.1 | 39.5 \| 36.1 |
| al | 212 | 38.0 \| 39.3 | -17.7 \| -24.9 | 38.1 \| 34.3 |
| gr | 166 | 34.5 \| **26.8** | -8.2 \| -2.1 | 30.8 \| **31.9** |
| it-n | 223 | 17.2 \| 15.8 | -9.2 \| -13.3 | 14.1 \| 13.2 |
| sk | 195 | 34.4 \| 31.6 | -13.4 \| -15.1 | 31.5 \| 28.4 |
| hu | 214 | 32.8 \| 32.2 | -15.1 \| -20.2 | 30.0 \| 26.2 |

D+2 and D+7 look the same (D+7 bias of the model: me -20.6, mk -26.0, rs -26.1, xk -27.6, al -31.1). Before the shift (2025-04..2026-08, D+5) the model beat level+shape on the level too (me 14.0 against 19.5, al 19.5 against 24.1) with ~0 bias. **Inside the model**: the ridge's level bias is -11..-21 (about level+shape's), the LightGBM's is -20..-29: the tree on `price - level_7d` learned mean reversion from a history whose highest-price rows (Jan 2026) fell afterwards, and has nothing above ~150 to extrapolate from.
**gr is a shape problem** (its level is fine): the model's within-day shape is 1 EUR/MWh worse than the naive profile since September, because Greece decoupled downward from its neighbours (October mean 179 against HU 244, ME 225, AL 242), which no model feature describes.

### By month, D+5 day-level bias of the production recipe | level+shape (forecast - actual)

| month | me | mk | rs | xk | al | gr |
|---|---|---|---|---|---|---|
| 2026-08 | -4.9 \| -7.8 | -7.6 \| -10.0 | -3.4 \| -6.0 | -7.6 \| -9.6 | -4.7 \| -9.6 | -10.2 \| -12.4 |
| 2026-09 | +10.2 \| +1.5 | +4.0 \| -2.0 | +7.5 \| -1.4 | +6.1 \| +1.8 | +1.5 \| -3.4 | +7.4 \| +1.8 |
| 2026-10 | **-39.4** \| -26.8 | **-41.1** \| -31.0 | **-47.1** \| -32.9 | **-49.3** \| -33.4 | **-46.9** \| -31.3 | -14.4 \| -21.2 |
| 2026-11 (2 days) | -42.2 \| -33.2 | -45.5 \| -18.8 | -43.1 \| -10.1 | -21.1 \| +11.7 | -14.8 \| +13.2 | n/a |

Monthly means, Balkan six / Greece: price 106-117 (Jul), 135-150 (Aug), 150-171 (Sep), 225-242 (Oct, gr 179), 261-287 (Nov); MIBGAS gas 55 / 62 / 78 / 87 / 92; the CCGT marginal cost of the model's fuel inputs 170 (Sep) -> 179 (Oct) -> 206 (Nov). **The price left the gas cost behind in October** (premium over marginal cost 47 in October, 67 in November, against -12 in September): gas alone (MIBGAS is the Iberian hub, not the Balkan one) does not explain the run.

### What the level miss correlates with (D+5, the six zones, 363 zone-days; `diag_drivers.py`)

| regressor of the day-level error (actual - forecast) | correlation | R^2 |
|---|---|---|
| the price run itself (actual day mean - `level_7d`) | +0.84 | **0.70** |
| weather forecast anomalies of the day (wind, radiation, temperature) | -0.03 / -0.40 / -0.44 | 0.24 |
| gas cost trend and gap (`mc_d7`, `mc_d28`, `mc_gap`) | +0.28 / -0.26 / -0.36 | 0.29 |
| both | | 0.37 |

The mean error is +17.9 EUR/MWh (the forecast too low), its day-to-day standard deviation 40.7. Colder and cloudier forecast days were missed more (temperature -0.44, radiation -0.40: demand and solar, the season turning), but most of the error is the run itself, which nothing known at issue time measures.

### Region or zone?

Cross-zone correlation of the daily D+5 level error since September: me-mk 0.80, me-rs 0.77, mk-rs 0.84, xk-al 0.98, Balkan zones with hu / ro / bg 0.65-0.85, gr-bg 0.85, **DE against any of them -0.03..0.19**, it-n 0.34-0.56, sk 0.47-0.80. The first principal component of the 24 zones' daily level errors carries **46 %** of the variance, the second 29 %. So: a regional regime (south-east Europe: the Balkans plus HU RO BG SK), common to zones that are coupled, with per-zone differences only in size (xk and al the largest: they sit at the end of the chain) and in `gr` (decoupled, different problem).

## 2. The candidates, declared before the numbers

Same protocol for all: rolling-origin folds of 2 months for LightGBM (a fold's targets never in its training set), weekly ridge refits, baseline level+shape with `level_7d`, recipe = mean of a ridge and a LightGBM (EE/LV/LT: the plain LightGBM, untouched), periods whole 2025-04-01..2026-11-02, select ..2026-06-30, hold-out 2026-07-01.., since 2026-09-01. LightGBM candidates are 3-seed means (seeds 1-3) compared with the production tree's 3-seed mean (`prod_bag3`, ridge 365 + `lgb_bag3`; the single stored draw is `prod`, differences below 0.1). **Decision rule, fixed before the final table**: a candidate is staged only if (i) no zone-horizon that is published today is lost, (ii) the pooled whole-backtest change is not negative beyond noise (0.1 point), (iii) it improves the Balkan six since September, and (iv) its cost on the select period is reported and, where it is not zero, the scope is narrowed to where the evidence is.

| | candidate | what |
|---|---|---|
| (a) | level-anchored target | ridge base and tree target on `ewm5` or the last-3-day mean instead of `level_7d`; a level-invariant tree (no feature carries an absolute price or fuel level: every lag / level is a difference to `level_7d`, gas / carbon / CCGT-cost levels dropped, their changes and the gap kept) |
| (b) | regional level features | neighbour zones' (`region_models.GROUPS`: cee / core / baltics) last-day, last-3-day and 7-day level minus the zone's own, plus the weekly drift of its own level, in ridge and tree |
| (c) | ECMWF IFS ENS | ensemble mean (and spread) of wind 100 m, temperature, shortwave radiation, precipitation instead of the Open-Meteo previous-runs deterministic run, CEE zones + it-n |
| (d) | hydro | ENTSO-E A72 reservoir filling, leak-free as the Norway recipe (section 3d) |
| (e) | 730-day ridge | `ridge730` branch's window (+ the 3-seed LightGBM bag that is in the baseline here) |
| (f) | level correction | `level_correction.py` as it stood (lambda 0.5, 14 days; alternatives 7 and 3 days, lambda 1.0 and an evidence-weighted version are sensitivities, **not** candidates) |

## 3. Results (24 non-Baltic zones; `bl_candidates_table.py`)

Mean gain over level+shape (%): whole backtest / hold-out / since 2026-09-01, at D+2, D+5, D+7; then the Balkan six since September (mean of D+2..D+7, and D+5), their D+5 day-level bias (EUR/MWh) and level MAE; last columns: published cells of 144 and the change against `prod_bag3` in points, mean over the 144 cells, whole / hold-out / **select** / since September.

| recipe | D+2 | D+5 | D+7 | Balkan six since Sep (all h / D+5) | D+5 bias, level MAE | cells | vs prod_bag3: whole / hold / select / recent |
|---|---|---|---|---|---|---|---|
| `prod_bag3` (reference) | 29.5 / 29.7 / 26.3 | 21.4 / 19.9 / 14.4 | 18.0 / 17.0 / 8.9 | 6.3 / 3.5 | -19.1, 35.7 | 137 | |
| (a) anchor ewm5 (ridge) | 29.5 / 29.7 / 26.4 | 21.4 / 19.9 / 14.4 | 18.0 / 17.0 / 8.9 | 6.3 / 3.5 | -19.1, 35.6 | 137 | 0.00 / 0.01 / 0.00 / 0.02 |
| (a) anchor 3 days (ridge) | 28.3 / 28.6 / 25.5 | 20.5 / 18.3 / 12.5 | 17.3 / 16.1 / 7.9 | 5.0 / 1.7 | -19.4, 36.6 | 137 | -0.90 / -1.22 / -0.78 / -1.25 |
| (a) level-invariant tree | 29.0 / 29.3 / 25.5 | 21.2 / 20.9 / 16.1 | 17.8 / 17.9 / 10.4 | 6.0 / 4.2 | -16.8, 35.3 | 138 | -0.35 / +0.57 / **-0.71** / +0.94 |
| (b) regional ridge | 29.7 / 30.2 / 26.8 | 21.3 / 19.9 / 14.4 | 17.8 / 17.0 / 8.9 | 7.0 / 4.1 | -18.5, 35.3 | 137 | -0.06 / +0.13 / -0.14 / +0.16 |
| (b) regional tree | 29.0 / 29.2 / 25.2 | 21.2 / 20.8 / 15.9 | 17.8 / 17.7 / 10.2 | 5.7 / 3.8 | -16.9, 35.5 | 138 | -0.37 / +0.42 / -0.68 / +0.73 |
| (d) hydro ridge | 29.3 / 29.7 / 26.3 | 20.9 / 19.8 / 14.2 | 17.6 / 17.5 / 10.0 | 7.8 / 4.5 | -15.7, 35.2 | 138 | -0.42 / +0.06 / **-0.60** / +0.18 |
| (d) hydro tree | 29.4 / 29.2 / 25.8 | 21.3 / 19.2 / 13.8 | 17.9 / 16.4 / 8.4 | 5.1 / 2.3 | -18.9, 36.4 | 137 | -0.09 / -0.57 / +0.08 / -0.56 |
| (e) 730-day ridge | 29.4 / 29.8 / 26.1 | 21.6 / 20.8 / 15.1 | 18.3 / 17.9 / 9.6 | 8.2 / 6.2 | -16.4, 34.2 | 138 | +0.15 / +0.59 / -0.02 / +0.35 |
| (e)+(a) 730 + level-invariant tree | 28.8 / 29.3 / 25.1 | 21.6 / 21.8 / 16.8 | 18.2 / 18.6 / 11.0 | 7.8 / 6.7 | -14.1, 33.8 | 138 | -0.12 / +1.12 / -0.61 / +1.19 |
| **(f) level correction, every zone** | 30.0 / 30.2 / 27.8 | 21.2 / 21.3 / 18.2 | 17.5 / 19.0 / 13.9 | **13.0 / 11.1** | **-13.5, 31.3** | 138 | -0.04 / +1.34 / **-0.53** / +3.46 |
| (e)+(f) 730 + correction | 30.1 / 30.3 / 27.6 | 21.5 / 22.1 / 18.7 | 17.8 / 19.7 / 14.1 | 13.6 / 12.1 | -11.7, 30.7 | 138 | +0.19 / +1.87 / -0.42 / +3.62 |

Sensitivities of (f) (not candidates; `bl_screen_lc.py`): 7 days -0.54 whole / -0.73 select; 3 days -0.98 / -1.07; lambda 1.0 over 7 days -5.9 / -6.5 (it removes the bias, -5.8, and destroys the calm months); an evidence-weighted shrinkage (m^2 / (m^2 + s^2 / n), lambda 1) -2.1 whole / -3.3 select. The pre-existing constants (0.5, 14 days) are the best of these on the select period as well, which is why nothing was tuned.

**Per zone, D+5, gain vs level+shape since 2026-09-01 / hold-out / whole backtest (%), the zones named in the task and the watch list:**

| zone | `prod_bag3` | (e) 730 | (f) correction | (e)+(f) | (a) rel tree | (b) regional ridge | (d) hydro ridge |
|---|---|---|---|---|---|---|---|
| me | 2.0 / 13.8 / 19.8 | 4.4 / 15.4 / 20.9 | **12.6 / 18.5 / 20.8** | 13.0 / 19.2 / 21.5 | 4.7 / 15.6 / 20.2 | 2.7 / 13.8 / 19.3 | 0.9 / 13.2 / 19.7 |
| mk | 2.1 / 12.4 / 19.4 | 6.2 / 15.0 / 20.4 | **12.7 / 17.0 / 20.5** | 14.6 / 18.2 / 21.3 | 2.3 / 13.3 / 19.1 | 1.6 / 12.1 / 19.2 | 2.8 / 13.3 / 17.8 |
| rs | 2.0 / 14.8 / 19.8 | 6.5 / 17.5 / 21.2 | **11.5 / 17.8 / 20.3** | 13.5 / 19.2 / 21.2 | 1.7 / 14.6 / 19.4 | 1.6 / 14.8 / 19.7 | 3.3 / 15.7 / 18.8 |
| xk | 2.8 / 8.7 / 13.1 | 5.2 / 10.7 / 13.8 | **8.6 / 12.0 / 13.7** | 9.5 / 12.8 / 14.1 | 3.4 / 9.1 / 13.4 | 2.7 / 8.5 / 13.0 | 4.4 / 10.0 / 13.5 |
| al | 4.9 / 10.5 / 13.3 | 7.2 / 12.1 / 14.0 | **11.5 / 13.9 / 13.9** | 12.1 / 14.3 / 14.2 | 4.9 / 10.5 / 13.6 | 4.6 / 10.4 / 13.0 | 6.8 / 11.8 / 13.8 |
| gr | 7.2 / 13.7 / 17.9 | 7.7 / 13.6 / 17.6 | 9.8 / 14.7 / 18.0 | 9.6 / 14.2 / 17.6 | 8.2 / 14.5 / 18.1 | 11.4 / 16.9 / 19.0 | 8.9 / 15.0 / 18.5 |
| it-n | 9.0 / 14.0 / 19.9 | 7.3 / 13.7 / 19.9 | 18.7 / 21.6 / 21.0 | 18.0 / 21.2 / 21.3 | 11.1 / 15.8 / 18.9 | 9.0 / 14.0 / 19.9 | 3.2 / 11.3 / 17.8 |
| sk | 9.9 / 21.0 / 24.6 | 11.2 / 22.0 / 24.4 | 10.3 / 20.1 / 23.0 | 11.8 / 21.4 / 23.0 | 14.1 / 23.2 / 24.5 | 10.1 / 21.1 / 24.2 | 10.9 / 21.4 / 24.3 |
| hu | 10.4 / 23.1 / 24.9 | 10.8 / 24.2 / 24.9 | 16.2 / 24.4 / 24.0 | 16.2 / 25.6 / 24.3 | 8.8 / 21.9 / 24.2 | 10.4 / 23.0 / 24.9 | 11.8 / 23.8 / 24.8 |

### (a) level-anchored target

The target of both models is **already** `price - level_7d` (the Norway fix of raw price -> relative price is in production). Re-anchoring on `ewm5` changes nothing for the ridge (it already has `ewm5 - level_7d` as a feature, so the fit is identical up to shrinkage: +/-0.02) and anchoring on the 3-day level is worse everywhere (-0.9 whole, 138 of 138 cells worse). The level-invariant tree (no absolute level anywhere) is the only variant that moves the tree's bias (D+5, Balkan six, tree alone: -23.7 -> -19.0) but it costs 0.35 whole / 0.71 select and does not reach the level of (f).

### (b) regional level features

Neighbour-gap features add nothing to the ridge (Balkan since September +0.8 at best, cells worse on the whole backtest 67 / better 36) and make the tree worse on select (-0.68). The neighbours' last days carry the same lag as the zone's own: they were all in the same run. The earlier neighbour-blend result (al/xk in `forecast-d257-experiments.md`) is the same finding.

### (c) ECMWF IFS ENS

**Feasible, and cheap in the end.** The archive (dynamical.org, `ecmwf-ifs-ens-forecast-15-day-0-25-degree`, CC BY 4.0, Icechunk over HTTPS from the STAC catalog `stac.dynamical.org`, **no account**; `pip install icechunk zarr xarray pystac` in a venv) holds the 00z runs of 51 members from 2024-04-01. One chunk is 1 init x 85 leads x 51 members x 8 x 8 degrees, so a point read costs a chunk; I read **5 variables x 15 weather points (the 13 CEE zones' + it-n's) x 952 inits** (`fetch_ecmwf.py`, 18 workers on the shared Spark, about 1 h 10 min wall, 24-30 MB/s on the interface, i.e. in the order of 100 GB read as the Norway agent had estimated; the bytes were not metered) and kept only the ensemble mean and spread per lead: **41 MB**. In production that is one init per day (about 20-40 s, ~100 MB of reads). The first init of the store is 2024-04-01, so the earliest rows of the training set (before 2024-04) have no ENS weather (the frame keeps 94 % of the training rows of these zones).
Features (`bl_ecmwf_frame.py`): for a row (zone, target hour, h) the 00z run issued h days before the target day (the Open-Meteo previous-runs lead min(h, 7); h = 8 rows use the 8-day lead), mean of the member speeds of the 100 m wind (km/h), 2 m temperature, shortwave radiation, precipitation, interpolated in lead time, replacing `wind`, `rad`, `temp`, `precip` of those 13 zones (the EU-wide `reg_*` means stay Open-Meteo's); spread (std over members) as three extra columns. Correlation with the Open-Meteo previous-day-5 values: wind 0.70, temperature 0.98, radiation 0.89, precipitation 0.48.
Result, the 13 zones only (pooled over them, change against `prod_bag3` in points, mean over their cells; whole / hold-out / select / since September): **ENS ridge +0.42 / +0.61 / +0.35 / +0.33** (D+5 whole +0.4, D+7 whole +1.1 and hold-out +1.3), ENS ridge + spread +0.46 / +0.59 / +0.41 / +0.04, **ENS tree +0.17 / +0.13 / +0.19 / -0.24**, ENS ridge + tree +0.44 / +0.62 / +0.37 / **-0.01**, with spread +0.45 / +0.52 / +0.42 / -0.12. It is a real, small improvement of the weather skill at the long horizons, positive on the select period too, **and it does nothing for the level**: the Balkan six since September stay at 5.7-6.3 % (reference 6.3), the D+5 bias at -18 (reference -19), level MAE 35.4-36.1 (35.6). That matches the diagnosis (weather anomalies explain 24 % of the level miss, and they are in the model already). Not staged: it is a new live dependency (the Icechunk client, a new daily fetch and its failure policy in `train_daily.py`, a new gate chain for the 13 zones' weather) for +0.4 point pooled; worth doing for its own sake (it also replaces Open-Meteo's non-commercial free tier, `docs/research/external-forecasts/README.md`, section B) as a separate step, not as the level fix.

### (d) hydro (A72)

Coverage per bidding zone (`probe_a72.py`, 2024-01-01 .. 2026-11-08, weekly): **exists** for `al me mk rs gr bg ro hr` (131-146 weekly points), `at ch it-n fr es pt lv` and a stub for `si` (11 points, junk values); **absent** for `xk hu sk de pl be cz ee lt ie`. Features (`fetch_a72.py`, leak-free as the Norway recipe: a week is used from W + 14 days; fill as a share of the zone's OWN trailing-52-week maximum known then, no whole-series maximum or week-of-year median; 4-week change; the Balkan hydro mean as a regional value, also for `xk hu sk si`). Result: the ridge gains in `al` (+2 D+5, +5.6 D+7 since September) and `hr`, loses in `it-n` (-6), `ro` (-4), `ch`; pooled -0.42 whole / **-0.60 select**; in the tree it is negative on the hold-out (-0.57). Stopped there. **GloFAS discharge forecasts need an EWDS (Copernicus) account**; creating one is not something this research may do. What it would need: an account and a personal access token for `cems-glofas-forecast` (forecasts as issued from 2019-11-05) and reforecasts, basin masks for Drin / Mat / Vjose (AL), Drina / Lim (ME, RS), Vardar (MK), then the same leak-free recipe (a forecast issued by the run time only). The reservoir result above (a state, no forecast) is the cheap stand-in and it did not help.

### (e) the 730-day ridge

Small and positive: whole +0.15, hold-out +0.59, select -0.02, since September +0.35 pooled and +1.9 points for the six (D+5 bias -19.1 -> -16.4); 68 cells better and 54 worse on the whole backtest, the owner's winter-2025/26 caveat (`forecast-ridge730.md`, section 3: -1.2..-1.4 points) stands. On top of (f) it adds +0.23 whole, +0.5 hold-out, +0.2 since September (rows (f) and (e)+(f)): **not worth the extra decision**; it stays parked.

### (f) level correction

The only candidate that works on the level. Every zone, fuel mode, whole / hold-out / since September: -0.04 / +1.34 / +3.46 points (pooled, 144 cells), the six at D+5: +0.65 / +3.3 / +7.6 (me and mk: whole +1.0 / +1.1, hold-out +4.7 / +4.6, since September +10.6 each). It does what a trailing correction can do and no more: D+5 bias of the six -19.1 -> -13.5 (-5.8 with lambda 1.0 and the cost above), level MAE 35.7 -> 31.3. The remaining bias is the run itself: every settled day is a day the correction is late.

## 4. What is staged: the correction for me mk rs xk al gr

**Why regional.** In every zone the correction pays in the trending months and costs in the others (select period: -0.5 pooled); by zone the whole-backtest effect is positive where the diagnosis found a regional level problem and negative elsewhere (whole backtest, mean of D+2..D+7, points: me +1.13, mk +1.18, rs +0.73, al +0.62, xk +0.58, gr +0.28, it-n +0.88; hu -0.67, sk -1.23, de -0.70, fr -0.85, cz -0.98, es -0.70; the Baltics +0.27 / -0.02 / -0.17 on the whole backtest but -1.3 / -1.7 / -1.75 on the hold-out and -2.7 / -1.8 / -2.0 since September). Every-zone variant (`all`): 154 fuel cells, whole -0.09 / hold-out +0.86 / since September +2.54, hold-out better in 96 cells and **worse in 56 (worst -2.6)**. The 12 zones of `region_models.GROUPS['cee']` (`cee`): whole +0.06, hold-out +0.86, better in 61, worse in 8 (worst -0.9). The six zones of the task: whole +0.17 pooled over all 154 cells (+0.76 in the six), hold-out +0.63 (+2.85 in the six), better in 34 cells and **worse in none**.
**The caveat, plainly:** the six were named by the owner from the since-September numbers, i.e. from the period this evaluation also contains (the hold-out). I did not pick them from the hold-out table, and I chose between "every zone", "cee" and "the six" by the select-period cost (pooled every zone -0.53, the six -0.10 mean over their cells) and by "worse in no cell", but the owner's list is not independent of the hold-out. The evidence that does not depend on it: the diagnosis (regional correlation 0.65-0.98), the whole backtest (+0.76 in the six against +0.17 pooled), and the live archive from 2026-11-03 on, which has to confirm it (section 7). `it-n` (whole +0.9, hold-out +5.8) and `hu` would be next candidates, `sk` would not; they are not included because they are not on the list this proposal declared.

**Code** (rollback is one line): `level_correction.py` `PUBLISH_LAMBDA = 0.5`, `PUBLISH_ZONES = (me mk rs xk al gr)`, `publishes(zone)`; `train_daily.py` publishes `LC.correction(...)` only for those zones (the shadow in the archive stays for every zone); `build_gate.recipe_columns(df, lam, zones)` applies the same rule to the backtest (`LC.apply_to_backtest`, rolling through it, `fuel_raw` / `corr_fuel` kept) so the gate and the accuracy block describe what is published; the gate file gets `levelCorrection {lambda, days, zones}`; `merge_level_zones.py` installs the six zones' cells into the live files and touches nothing else. Rollback: `PUBLISH_LAMBDA = 0.0` or `EU_FORECAST_LAMBDA=0`.

**Files**: `publish_gate.json` and `accuracy_eu.json` in the repo = the files of `main` with the six zones' cells replaced from a full rebuild with the unchanged gate code (`bl_gate.py`; "control" = the same rebuild without the correction; the 20 other zones are exactly main's). `calibration_eu.json` is **not changed**: the band offsets are measured on the model's own edges and refreshed weekly by `refresh_calibration.sh`; the band moves with the corrected point (`forecast.build_days` shifts it) and `coverage` in the accuracy block is measured that way (section 5), so nothing in the live calibration needs to be merged and the Sunday refresh stays valid.

### Before / after, every zone-horizon (production's files > the staged files)

Fuel mode (the normal one): **155 of 156 horizons published (154 before; `xk` D+7 appears), none lost**; of the 154 cells published before and after: whole-backtest gain better in 31 / worse in 2 (-0.1 or less) / same in 121, hold-out better in 34 / worse in 0 / same in 120, since September better in 34 / worse in 0 / same in 120; mean change +0.18 / +0.65 / +1.54 points over all 154 (best +12.1 `me` D+7 since September). `low` flags: 52 -> 46 of the published cells.
No-fuel fallback: 150 -> 152 published (`xk` D+6, D+7), none lost; 33 cells better on all three measures, none worse. **Every cell of the other 20 zones is identical to production's.** Coverage of the P10-P90 band, fuel mode, mean of the six zones' cells, whole / since September: production's file 0.78 / 0.73 -> staged 0.78 / 0.72 (per zone within 0.01-0.02; `gr` since September 0.707 -> 0.685, `xk` 0.722 -> 0.730).

The two cells that are worse on the whole backtest are `gr` D+5 and D+7 (-0.1 each); every cell and its `low` flag is in `docs/forecast-balkan-level-cells.csv`. Only the six zones' rows differ between before and after (the others are identical and show the same number twice).


#### Fuel mode, gain vs level+shape, whole backtest, before > after (%); x = not published, bold = the cell appears or disappears

| zone | D+2 | D+3 | D+4 | D+5 | D+6 | D+7 |
|---|---|---|---|---|---|---|
| de | 38.1>38.1 | 34.8>34.8 | 31.5>31.5 | 27.4>27.4 | 24.5>24.5 | 22.4>22.4 |
| fr | 28.7>28.7 | 21.6>21.6 | 19.6>19.6 | 17.6>17.6 | 15.1>15.1 | 12.8>12.8 |
| pl | 30.2>30.2 | 27.9>27.9 | 25.8>25.8 | 24.1>24.1 | 20.1>20.1 | 19.0>19.0 |
| it-n | 28.5>28.5 | 24.3>24.3 | 22.2>22.2 | 20.2>20.2 | 18.6>18.6 | 17.3>17.3 |
| at | 33.3>33.3 | 29.5>29.5 | 28.0>28.0 | 26.2>26.2 | 24.5>24.5 | 23.1>23.1 |
| be | 32.1>32.1 | 27.5>27.5 | 26.4>26.4 | 25.3>25.3 | 20.8>20.8 | 19.6>19.6 |
| ch | 33.6>33.6 | 28.9>28.9 | 27.4>27.4 | 25.6>25.6 | 24.9>24.9 | 22.3>22.3 |
| cz | 30.0>30.0 | 27.0>27.0 | 26.5>26.5 | 25.0>25.0 | 23.1>23.1 | 21.8>21.8 |
| hu | 33.0>33.0 | 27.9>27.9 | 26.3>26.3 | 24.9>24.9 | 22.8>22.8 | 22.2>22.2 |
| si | 32.9>32.9 | 29.7>29.7 | 28.1>28.1 | 26.4>26.4 | 25.5>25.5 | 25.0>25.0 |
| es | 30.1>30.1 | 23.9>23.9 | 21.0>21.0 | 17.9>17.9 | 15.3>15.3 | 11.9>11.9 |
| pt | 24.3>24.3 | 15.3>15.3 | 12.4>12.4 | 12.6>12.6 | 11.2>11.2 | 8.1>8.1 |
| sk | 31.1>31.1 | 27.4>27.4 | 26.6>26.6 | 24.7>24.7 | 22.3>22.3 | 22.3>22.3 |
| gr | 26.4>26.6 | 21.1>21.2 | 19.3>19.4 | 17.9>17.8 | 16.7>16.7 | 15.4>15.3 |
| ro | 31.2>31.2 | 26.5>26.5 | 24.3>24.3 | 23.4>23.4 | 22.2>22.2 | 20.9>20.9 |
| bg | 28.2>28.2 | 23.5>23.5 | 21.3>21.3 | 20.2>20.2 | 18.7>18.7 | 17.4>17.4 |
| hr | 33.6>33.6 | 29.9>29.9 | 28.0>28.0 | 26.7>26.7 | 25.3>25.3 | 24.1>24.1 |
| rs | 27.8>28.6 | 22.6>23.6 | 21.0>22.1 | 19.5>20.2 | 17.2>17.9 | 15.9>16.7 |
| ee | 18.5>18.5 | 17.0>17.0 | 16.0>16.0 | 14.3>14.3 | 12.4>12.4 | 12.3>12.3 |
| lv | 20.0>20.0 | 18.9>18.9 | 18.7>18.7 | 18.2>18.2 | 16.1>16.1 | 15.9>15.9 |
| lt | 20.4>20.4 | 19.5>19.5 | 19.1>19.1 | 18.7>18.7 | 16.4>16.4 | 16.0>16.0 |
| ie | 31.5>31.5 | 29.0>29.0 | 24.9>24.9 | 21.3>21.3 | 16.2>16.2 | 14.6>14.6 |
| me | 27.9>29.4 | 22.3>23.8 | 20.8>22.4 | 19.4>20.6 | 18.5>19.7 | 17.8>18.4 |
| mk | 29.8>30.9 | 22.8>23.5 | 20.1>21.3 | 19.1>20.3 | 17.6>19.0 | 16.0>17.7 |
| al | 17.5>18.6 | 16.1>17.0 | 14.4>15.8 | 13.0>14.0 | 12.4>13.2 | x>x |
| xk | 17.4>18.1 | 15.7>16.3 | 14.4>15.1 | 13.2>13.8 | 12.4>12.7 | **x>11.5** |

#### Fuel mode, gain vs level+shape, hold-out 2026-07-01.., before > after (%); x = not published, bold = the cell appears or disappears

| zone | D+2 | D+3 | D+4 | D+5 | D+6 | D+7 |
|---|---|---|---|---|---|---|
| de | 40.2>40.2 | 36.0>36.0 | 33.1>33.1 | 29.4>29.4 | 26.7>26.7 | 26.3>26.3 |
| fr | 33.9>33.9 | 27.0>27.0 | 25.6>25.6 | 24.3>24.3 | 21.0>21.0 | 18.9>18.9 |
| pl | 29.3>29.3 | 27.8>27.8 | 26.0>26.0 | 24.7>24.7 | 20.3>20.3 | 19.9>19.9 |
| it-n | 25.5>25.5 | 21.4>21.4 | 17.9>17.9 | 14.4>14.4 | 11.6>11.6 | 12.2>12.2 |
| at | 33.1>33.1 | 28.7>28.7 | 25.3>25.3 | 23.2>23.2 | 20.9>20.9 | 21.5>21.5 |
| be | 35.3>35.3 | 28.0>28.0 | 26.6>26.6 | 27.1>27.1 | 23.8>23.8 | 22.0>22.0 |
| ch | 35.6>35.6 | 30.7>30.7 | 29.2>29.2 | 26.6>26.6 | 25.1>25.1 | 23.5>23.5 |
| cz | 29.7>29.7 | 25.4>25.4 | 24.9>24.9 | 24.3>24.3 | 21.5>21.5 | 21.1>21.1 |
| hu | 35.7>35.7 | 28.2>28.2 | 26.1>26.1 | 23.9>23.9 | 21.9>21.9 | 21.7>21.7 |
| si | 35.1>35.1 | 29.7>29.7 | 26.7>26.7 | 24.7>24.7 | 23.3>23.3 | 23.2>23.2 |
| es | 30.5>30.5 | 24.2>24.2 | 21.1>21.1 | 18.0>18.0 | 16.4>16.4 | 13.9>13.9 |
| pt | 25.7>25.7 | 16.1>16.1 | 12.2>12.2 | 13.1>13.1 | 11.1>11.1 | 7.8>7.8 |
| sk | 29.8>29.8 | 24.1>24.1 | 22.7>22.7 | 21.1>21.1 | 20.2>20.2 | 20.4>20.4 |
| gr | 25.7>25.9 | 17.4>17.8 | 15.3>15.9 | 14.2>14.7 | 13.5>13.7 | 13.8>14.4 |
| ro | 37.5>37.5 | 30.2>30.2 | 27.1>27.1 | 25.5>25.5 | 23.4>23.4 | 23.3>23.3 |
| bg | 30.6>30.6 | 23.2>23.2 | 20.5>20.5 | 17.5>17.5 | 15.6>15.6 | 15.5>15.5 |
| hr | 36.0>36.0 | 29.9>29.9 | 26.9>26.9 | 25.5>25.5 | 23.9>23.9 | 23.1>23.1 |
| rs | 26.2>26.9 | 18.5>20.6 | 16.4>19.4 | 14.8>17.7 | 13.0>16.4 | 13.9>17.6 |
| ee | 16.9>16.9 | 18.1>18.1 | 16.9>16.9 | 17.4>17.4 | 14.1>14.1 | 13.2>13.2 |
| lv | 16.2>16.2 | 15.9>15.9 | 16.1>16.1 | 18.1>18.1 | 15.4>15.4 | 13.6>13.6 |
| lt | 17.3>17.3 | 16.6>16.6 | 16.1>16.1 | 18.2>18.2 | 15.0>15.0 | 12.2>12.2 |
| ie | 29.7>29.7 | 26.1>26.1 | 24.0>24.0 | 19.6>19.6 | 15.9>15.9 | 13.7>13.7 |
| me | 23.9>26.7 | 16.6>20.6 | 14.2>19.3 | 12.8>18.1 | 10.8>16.1 | 10.1>14.8 |
| mk | 26.9>28.6 | 17.9>20.7 | 12.7>17.2 | 11.7>16.9 | 10.2>15.7 | 10.8>16.8 |
| al | 15.7>17.5 | 13.5>16.1 | 11.5>15.5 | 10.0>13.9 | 6.9>11.0 | x>x |
| xk | 14.6>16.0 | 11.6>13.7 | 10.2>13.2 | 8.8>11.9 | 6.2>9.3 | **x>8.6** |

#### Fuel mode, gain vs level+shape, since 2026-09-01, before > after (%); x = not published, bold = the cell appears or disappears

| zone | D+2 | D+3 | D+4 | D+5 | D+6 | D+7 |
|---|---|---|---|---|---|---|
| de | 39.3>39.3 | 35.4>35.4 | 33.0>33.0 | 29.5>29.5 | 25.0>25.0 | 22.8>22.8 |
| fr | 33.9>33.9 | 26.2>26.2 | 24.4>24.4 | 23.5>23.5 | 19.8>19.8 | 16.4>16.4 |
| pl | 26.8>26.8 | 26.1>26.1 | 23.8>23.8 | 21.4>21.4 | 15.7>15.7 | 15.3>15.3 |
| it-n | 26.3>26.3 | 20.1>20.1 | 14.6>14.6 | 9.5>9.5 | 6.9>6.9 | 6.2>6.2 |
| at | 27.3>27.3 | 23.2>23.2 | 18.8>18.8 | 15.3>15.3 | 12.0>12.0 | 11.6>11.6 |
| be | 35.7>35.7 | 28.5>28.5 | 27.7>27.7 | 27.5>27.5 | 21.6>21.6 | 18.3>18.3 |
| ch | 33.2>33.2 | 28.4>28.4 | 26.8>26.8 | 21.9>21.9 | 18.4>18.4 | 17.2>17.2 |
| cz | 25.4>25.4 | 21.4>21.4 | 20.6>20.6 | 20.1>20.1 | 15.2>15.2 | 13.5>13.5 |
| hu | 25.3>25.3 | 17.6>17.6 | 15.1>15.1 | 10.9>10.9 | 7.2>7.2 | 5.5>5.5 |
| si | 28.2>28.2 | 22.7>22.7 | 18.5>18.5 | 15.0>15.0 | 11.2>11.2 | 10.1>10.1 |
| es | 31.3>31.3 | 26.7>26.7 | 23.4>23.4 | 20.5>20.5 | 19.4>19.4 | 13.9>13.9 |
| pt | 23.8>23.8 | 15.6>15.6 | 12.2>12.2 | 13.8>13.8 | 12.3>12.3 | 7.0>7.0 |
| sk | 19.5>19.5 | 14.8>14.8 | 12.6>12.6 | 9.7>9.7 | 7.7>7.7 | 6.6>6.6 |
| gr | 21.5>22.2 | 12.0>13.4 | 9.1>11.2 | 7.9>9.5 | 6.8>8.4 | 6.0>7.7 |
| ro | 31.1>31.1 | 22.9>22.9 | 18.7>18.7 | 14.8>14.8 | 10.7>10.7 | 9.1>9.1 |
| bg | 29.3>29.3 | 20.8>20.8 | 16.8>16.8 | 12.9>12.9 | 10.1>10.1 | 8.3>8.3 |
| hr | 29.6>29.6 | 23.6>23.6 | 19.3>19.3 | 16.2>16.2 | 12.2>12.2 | 9.3>9.3 |
| rs | 18.5>21.8 | 8.5>15.9 | 4.5>13.9 | 1.5>11.4 | -2.2>8.3 | -1.2>9.7 |
| ee | 17.3>17.3 | 18.0>18.0 | 18.6>18.6 | 18.8>18.8 | 14.5>14.5 | 14.3>14.3 |
| lv | 14.0>14.0 | 14.8>14.8 | 15.9>15.9 | 19.6>19.6 | 14.0>14.0 | 11.5>11.5 |
| lt | 14.9>14.9 | 15.3>15.3 | 16.1>16.1 | 19.3>19.3 | 12.6>12.6 | 8.2>8.2 |
| ie | 32.0>32.0 | 28.5>28.5 | 26.1>26.1 | 24.6>24.6 | 18.0>18.0 | 14.8>14.8 |
| me | 20.7>27.1 | 8.8>18.3 | 3.5>15.0 | 0.1>11.8 | -5.2>6.9 | -6.7>4.5 |
| mk | 22.3>27.1 | 9.3>17.3 | 2.9>13.8 | 0.5>12.1 | -2.0>9.9 | -1.4>10.4 |
| al | 14.4>17.8 | 10.9>15.7 | 7.1>14.2 | 3.7>11.6 | -0.2>8.2 | x>x |
| xk | 12.0>14.7 | 7.8>11.6 | 5.1>10.3 | 2.8>8.5 | -0.0>5.7 | **x>4.7** |


No-fuel mode, the six zones (hold-out, before > after): see `docs/forecast-balkan-level-cells.csv` (every zone, mode and horizon, the control rebuild beside both).

### Gate and the rules

The gate code and the 5 % rule are unchanged (`build_gate.py` differs only in the recipe columns and `levelCorrection`; `OWNER_WEAK` and `FORCED_OFF` are as they were: `al` D+7 stays off, hold-out 10.3 %, whole 11.7 % with the correction, 5.9 % / 11.3 % without). Nothing is set per zone on the hold-out; one regional recipe, declared (the list above), with the zone list in the gate file.

## 5. The band stays honest

`bl_band_check.py`, fuel mode, all zones, coverage whole backtest / since 2026-09-01 (Balkan six): control 0.790 / 0.726 (0.778 / 0.710); edges shifted with the correction and offsets re-measured on shifted edges 0.794 / 0.738; **edges shifted, offsets from the unshifted model (what the weekly `refresh_calibration.sh` produces, since it never sees the correction) 0.785 / 0.723 (0.778 / 0.725)**, mean width 85.0 against 86.5. The second variant is what runs, so `accuracy_eu.json`'s `coverage` / `coverageRecent` are measured as that (`build_gate.coverage_table(..., corr_col=...)`) and no calibration change is needed.

## 6. Dry run (staged copy, no KV write)

`~/eu-forecast-bl-stage` (the live caches and archive of 2026-11-08, the branch code and files), `python3 train_daily.py --dry-run --skip-refresh`: `FUEL on`, `published lambda=0.5 in me, mk, rs, xk, al, gr` and 365 archive day errors, `DONE 26/26 zones` (175 s), `xk` 6 forecast days (h 2..7), `al` 5 (h 2..6). `dry_run_check.py`: the six zones carry a shift only where the archive has three settled days (D+2..D+4: me +3.0 / +3.6 / +5.0, mk +2.1 / +3.2 / +4.3, rs +2.6 / +1.8 / +4.9, al +10.7 / +7.2 / +10.2, gr +1.3 / +0.6 / +3.7 EUR/MWh mean; D+5.. and `xk` 0.0: no evidence yet), **no unlisted zone has a shifted number**, `min <= price <= max` everywhere, every day has a band. An earlier dry run with the correction in every zone (before the regional decision) showed DE +20.6 / +18.2 / +31.0 at D+2..D+4 and the Baltics +/-3-5: the size of what the every-zone variant would do tomorrow.

## 7. Rollout and rollback (not done)

1. Merge `balkan-level` (the owner). On the Spark, with the branch checked out somewhere (`~/eu-forecast-bl-new`, or the rsync below from the laptop):
   `cp -a ~/eu-forecast ~/eu-forecast-bak-bl` is too big (3 GB); back up what changes: `mkdir ~/eu-forecast/bak-bl-<date> && cp -a ~/eu-forecast/{publish_gate.json,accuracy_eu.json,calibration_eu.json,level_correction.py,train_daily.py,build_gate.py,calibrate_bands.py} ~/eu-forecast/bak-bl-<date>/`.
2. Code (everything except the three JSON files):
   `rsync -a --exclude 'test_*' --exclude __pycache__ --exclude 'publish_gate.json' --exclude 'accuracy_eu.json' --exclude 'calibration_eu.json' --exclude research_balkan --exclude research_d257 --exclude fixtures scripts/forecast_model/eu/ cc@spark:~/eu-forecast/`.
3. Gate and accuracy: **merge, do not copy**: `cd ~/eu-forecast && python3 merge_level_zones.py --from <dir with the branch's publish_gate.json and accuracy_eu.json> --into . --dry-run`, read it (expect `xk fuel [2..6] -> [2..7]`, `xk nofuel [2..5] -> [2..7]`, the other zones' horizons unchanged), then without `--dry-run`. It writes only the six zones' entries and the `levelCorrection` field; **`calibration_eu.json` is not touched** (it is refreshed every Sunday; nothing here changes it; do not copy the branch's, it is the one of `main`).
4. Dry run on the Spark: `cd ~/eu-forecast && set -a && . ~/.config/elpriser.env && set +a && nice -n 10 python3 train_daily.py --dry-run --skip-refresh` outside 12:00-12:55 and 15:10-15:40 UTC; expect `published lambda=0.5 in me, mk, rs, xk, al, gr`, `DONE 26/26`, `xk` h 2..7.
5. The 15:15 UTC cron does the rest. Next day: `npm run forecast-coverage` (`xk` D+7 shown), the page of `xk`, `monitor.py --days 21 --field published` against `--field uncorrected` (the model's own numbers) per zone from about 2026-11-20 (10+ settled days per cell); expect the six zones' corrected MAE below the uncorrected at D+2..D+4 first, D+5..D+7 two weeks later. **If the corrected MAE is worse than the uncorrected for two weeks in a zone, or the band coverage drops under 60 % since the rollout: rollback.**
6. Rollback, in order of speed: `echo EU_FORECAST_LAMBDA=0 >> ~/.config/elpriser.env` (the next run publishes the model's own numbers; the gate still has `xk` D+7 and the corrected accuracy numbers, within 0.1-1.5 points of the truth); then `cp ~/eu-forecast/bak-bl-<date>/{publish_gate.json,accuracy_eu.json} ~/eu-forecast/` (back to production's gate; `xk` D+7 disappears at the next run; the key `eu-forecast-xk` is overwritten by it); code: `PUBLISH_LAMBDA = 0.0` or the backup copies. KV keys need no deletion (3-day TTL, overwritten daily).

## 8. Not verified, and open items

* **No live evidence.** The shadow in the production archive (2026-11-02..07 runs) had no correction yet on 366 settled days (`live_shadow_check.py`), so the correction has never been measured live; the backtest's models are retrained every two months, the live ones daily, so the backtest probably overstates the lag and therefore the gain (the earlier bootstrap from backtest errors over-corrected by +20 % on 2 November; here the live job uses only its own archive).
* The ramp-in (D+5..D+7 and `xk` need up to two weeks of archive) means the benefit in November is partial; there is no cheap honest bootstrap (a neighbouring horizon's errors were not tested).
* Selection caveat (section 4): the six zones are the owner's list, narrowed after the global variant showed costs elsewhere; the select period says the correction costs half a point in calm months.
* **HF cards**: `hf/card_tables.py` reads the no-fuel cells of `accuracy_eu.json`; for the six zones they now describe the corrected recipe, which the open weights alone do not reproduce (the correction is job code reading the archive). Decide before the next card refresh (`docs/hf-publishing.md`).
* ECMWF ENS: researched and measured, not staged (section 3c); GloFAS needs an EWDS account, skipped. The RTX machine was not used (not needed; everything fit the Spark). The 41 MB ENS cache and the A72 weekly files are kept in `~/eu-forecast-bl-keep` on the Spark (delete when not needed; the backfill is 1.5 hours to repeat).
* The research frame ends 2026-11-02; the last six days (a price jump to 270-330) are not in the backtest, so the numbers above are not updated for them. A re-run of the gate chain on a later cut is the next regular step (`forecast-runbook.md`, "Refreshing").
