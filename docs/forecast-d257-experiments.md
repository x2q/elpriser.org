# D+7 for Albania and Kosovo: what was tried, with numbers (research of 2026-11-08, nothing applied to production)

Question: can `al` D+7 (owner's `forcedOff`, but numerically 5.9 % on the hold-out) and `xk` D+7 (4.95 % on the hold-out, rule 5 %) be published honestly, and what else is blocked by the gate?
Everything ran on the Spark in **copies** (`~/eu-forecast-d257`, copied from the Kosovo agent's `xkrun`; production `~/eu-forecast`, `~/nordic`, `~/prognose3`, the cron, the gate files and KV were not touched).
Protocol, unchanged: the 26-zone research frame of [forecast-xk.md](forecast-xk.md) (prices cut at 2026-11-02), rolling-origin folds of 2 months from 2025-04, target = price - level_7d, baseline = level+shape,
the recipe = mean of the 365-day ridge with fuel and the LightGBM with fuel, `build_gate.py` / `gate.py` unchanged. **Select** = 2025-04-01..2026-06-30, **hold-out** = 2026-07-01.. (573 settled days in all). The rule: published only if >= 5 % better than level+shape on the hold-out AND on the whole backtest.
Candidates were declared before any result was seen; a candidate counted as a model improvement only if it was better pooled over the 24 non-Baltic zones, not just for al/xk. The scripts are in `scripts/forecast_model/eu/research_d257/`.

## The two zones as they stand

| | whole backtest | hold-out | status |
|---|---|---|---|
| al D+7 (checked-in run) | 11.3 % | 5.9 % | passes the numbers; switched off by the owner's `forcedOff` |
| xk D+7 (checked-in run) | 11.3 % | **4.95 %** | fails by 0.05 points |

## 1. The 4.95 % is inside the noise of the model itself

The LightGBM part is not deterministic (subsample, thread schedule): five runs with identical parameters, data and folds differ from each other by **4.3 EUR/MWh on average per hour** (pairwise mean absolute difference of the forecasts).
D+7 hold-out gain of the recipe, same ridge, five LightGBM runs (checked-in run, re-run, seeds 1, 2, 3):

| | checked-in | re-run | seed 1 | seed 2 | seed 3 | mean of seeds 1-3 (`bag3`) | mean of all five (`bag5`) |
|---|---|---|---|---|---|---|---|
| xk D+7 hold-out | **4.95** | 5.69 | 5.72 | 5.60 | 5.73 | 5.75 | 5.63 |
| xk D+7 whole backtest | 11.34 | 11.78 | 11.75 | 11.62 | 11.81 | 11.81 | 11.76 |
| al D+7 hold-out | 5.88 | 6.82 | 6.86 | 6.75 | 6.60 | 6.82 | 6.69 |

So the checked-in run was the unlucky draw: with the same recipe xk D+7 passes in four of five runs. Of all 138 non-Baltic zone-horizon cells only `xk D+7` changes status between runs (137 of 138 pass in the checked-in run, 138 of 138 in every other).
Averaging three seeds (a plain variance reduction, declared in advance) is better than a single run pooled over the 24 zones on the select period at every horizon (mean gain vs level+shape, select, %: D+2 29.70 vs 29.45-29.60 single, D+5 22.15 vs 21.97-22.05, D+7 18.49 vs 18.33-18.38) and neutral to slightly better on the hold-out (D+7 17.41 vs 17.02-17.62). It does not by itself make xk D+7 comfortable: 5.7 %, 0.7 points above the line.
Cost in production: three LightGBM fits instead of one (about 2 minutes each with fuel on the Spark).

## 2. Rejected on the pooled evidence (all numbers: mean gain over 24 zones, select / hold-out, D+7; baseline recipe 18.36 / 17.37)

| candidate | result | verdict |
|---|---|---|
| recency-weighted LightGBM (half-life 270 d) | 18.34 / 17.16 | no gain |
| one LightGBM per horizon group {2,3} {4,5} {6,7} | 17.96 / 16.17 (D+2: 30.41 / 30.15, better) | worse at the long horizons: fewer rows per model |
| stronger regularisation (31 leaves, min 300, 300 trees) | 18.14 / 17.10 | no gain |
| ridge / LightGBM weight per horizon chosen on the select period (0.5, 0.3, 0.3, 0.3, 0.2, 0.2 for D+2..D+7) | select-best, but hold-out D+7 16.41 against 17.02 for the 0.5 mean | worse out of sample; it would also take `it-n` D+6 and D+7 below the rule (hold-out 4.7 and 4.5 %) |
| neighbour blend for al/xk: mean of the own forecast and those of al, xk, mk, me, rs, each shifted by the difference of the 7-day levels | al D+7 hold-out 5.88 -> 6.82, xk 4.95 -> 6.28, but select 12.99 -> 12.24 and 13.56 -> 12.96 | the select period says no; the hold-out says yes. Choosing it for that would be choosing on the hold-out: not done |
| research families of the earlier report (CatBoost, LEAR-90/180/365w, lasso, hybrids, about 55 columns) for al D+7 | the best on select (`cb_fuel` 15.1 %) has 3.9 % on the hold-out; `ens_lt` is the best on both | nothing above the recipe |

## 3. The one that helps: a longer ridge window (730 days instead of 365)

Motivation, from the report's own table before this run: the no-fuel ridge for al loses badly with less history (D+7 gain vs level+shape, whole backtest: 90 days -5.5 %, 180 days -0.6 %, 365 days +6.6 %), so the question was whether more history helps further.
The weather-as-issued archive starts 2024-03-15 for every zone, so the window is 'as many days as exist, up to N': the 365-day ridge has its full window from about 2025-04, a 540-day ridge from about 2025-09, a 730-day ridge only from 2026-03.
**This is why the select period cannot tell the windows apart** (it ends 2026-06-30) and the hold-out is where they differ. Three windows were declared (365, 540, 730), LightGBM fixed to the five-run mean:

| mean gain over the 24 zones, select / hold-out, % | D+2 | D+5 | D+7 |
|---|---|---|---|
| 365 days (production) | 29.66 / 29.83 | 22.14 / 20.22 | 18.50 / 17.40 |
| 540 days | 29.52 / 29.81 | 22.08 / 20.49 | 18.39 / 17.55 |
| 730 days | 29.49 / 29.91 | 22.08 / **21.09** | 18.63 / **18.20** |

| al / xk, select / whole / hold-out, % | D+5 | D+6 | D+7 |
|---|---|---|---|
| al, 365 days | 14.50 / 13.72 / 11.34 | 14.70 / 13.09 / 8.16 | 13.36 / 11.73 / 6.69 |
| al, 730 days | 14.91 / 14.38 / 12.76 | 15.08 / 13.80 / 9.87 | 13.13 / 12.01 / **8.54** |
| xk, 365 days | 14.98 / 13.51 / 9.37 | 14.85 / 12.76 / 6.86 | 13.90 / 11.76 / 5.63 |
| xk, 730 days | 15.22 / 14.19 / 11.27 | 14.94 / 13.30 / 8.65 | 13.77 / 12.18 / **7.63** |

Consistency (730 against 365, five-run LightGBM mean): hold-out D+7 better in 20 of 24 zones (D+5: 18 of 24, D+2: 14 of 24); split by sub-period the picture is less clean, July-August better in 20 / 20 / 15 zones (D+2 / D+5 / D+7), September-November in 8 / 17 / 11 (D+2 / D+5 / D+7):
the gain is on average positive, not uniform, and almost nothing of it is visible since the September price shift at D+2.
**The caveat, plainly:** 730 was picked among three declared windows after the hold-out was seen; the select period was neutral because it could not use the longer window. The honest status is "supported by the hold-out and by the mechanism (the ridge is data-starved), not proven": the live accuracy (`monitor.py --days 21`) is the real test.

`build_gate.py`, unchanged, on the recipe with the 730-day ridge (columns `lear_r730_g` / `lear_r730` instead of `lear_r365_g` / `lear_r365`; stored LightGBM, then the five-run mean):

| | fuel mode horizons published | al D+7 | xk D+7 |
|---|---|---|---|
| checked-in recipe | 154 of 156 (al D+7 forced off, xk D+7 under 5 %) | 11.3 % / 5.9 % (forced off) | 11.3 % / 4.95 %: **not published** |
| 730-day ridge, stored LightGBM | 155 of 156 | 11.6 % / 7.8 % (still forced off) | 11.8 % / **7.0 %: published** |
| 730-day ridge, five-run LightGBM | 155 of 156 | 12.0 % / 8.5 % (still forced off) | 12.2 % / **7.6 %: published** |

(whole backtest / hold-out). xk D+7 would carry `low: true` (gain since 2026-09-01 is 0.2-1.3 %: like all the Balkan zones the forecast is no better than level+shape at the price LEVEL since September; the ordering of hours and the shape is what it adds).
Side effect in the **no-fuel fallback** (used only when the gas and carbon inputs are unavailable): `it-n` would keep D+2 only (now D+2..D+4) and `ie` D+2..D+5 (now D+2..D+7); the fuel mode, the normal one, loses no horizon.

## 4. The Hugging Face lead (hsilvosa/entsoe-observatory, snapshot 2026-10-12)

Read through the datasets-server JSON API (`zone_daily`, rows of XK, AL and RS only; nothing downloaded to the repo, nothing used for training):

* **XK**: the table has 1,880 rows (days), but they are mostly rows with LOAD only: **985 days have a price, from 2024-02-01 to 2026-10-12, exactly the history ENTSO-E A44 gives us** (our cache: 2024-02-01..). Daily means agree with our ENTSO-E cache to 0.004 EUR/MWh on average (two days differ by more than 0.5, maximum 2.9). No Kosovo price exists before 2024-02-01 there: there is no extra price history for xk.
  Against AL the XK daily mean is identical to the cent on 92 % of the days (correlation 0.995), against RS on 0.2 % (correlation 0.79): the same picture as in forecast-xk.md.
* **AL**: 2,070 rows, **1,277 days with a price, from 2023-04-12**; our cache starts 2024-01-01, so there are 264 more price days (2023-04-12..2023-12-31, 8.7 months). Overlapping days agree with ours (mean absolute difference 0.004).
* **Why it does not feed a retrain**: every row of the model needs the weather forecast as it was issued (Open-Meteo previous-runs archive), which starts 2024-03-15; the 264 extra al days predate it, so they cannot become training rows of the recipe (the table's weather is observed or reanalysed weather, not forecasts as issued; training on it would be the optimistic mismatch the protocol avoids). The longer-history lever that does exist is the one in section 3: the window grows by a day every day.
* Load (`load_mw`) is a feature the pipeline does not have for any zone; it was not tested here (it would need an ENTSO-E A65 load-forecast-as-issued series, not actual load, to be honest at D+7).

## What it adds up to

* `xk` D+7: not publishable with the checked-in recipe by 0.05 points, and that run was an unlucky draw (four reruns 5.6-5.7 %). With the 730-day ridge it passes by 2 points on the hold-out (7.0-7.6 %) with 11.8-12.2 % on the whole backtest. Both effects are small; the evidence for the second is the hold-out plus a mechanism, with the caveat above.
* `al` D+7: passes the numbers in every variant (5.9 % checked-in, 7.8-8.5 % with the 730-day ridge). The only thing that keeps it off is the owner's `forcedOff` in `publish_gate.json`; that is a decision, not a model problem.
* Neither is in production: shipping the 730-day ridge (and optionally the three-seed LightGBM) means changing `recipe.py` (`LEAR_WINDOW_DAYS`), `train_daily.py` (seeds), re-running the gate chain (`zone_research.sh` / `build_gate.py`, `calibrate_bands.py`) and merging the new gate and accuracy files, as in the rollout of [forecast-xk.md](forecast-xk.md). Not done here.
