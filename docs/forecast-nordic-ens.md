# The Nordic ensemble beyond Norway: DK1, SE1-SE4 and NL switch, DK2 and FI stay (research and staging of 2026-11-08; branch `nordic-ens`, nothing rolled out)

Question (owner, 2026-11-08, "proposal 2"): `docs/forecast-nordic-no.md` fixed NO1/2/3/5 with an ensemble (730-day ridge + LightGBM on price - level_7d, gas/carbon inputs, leak-free reservoir feature, 50/50 shape blend) and found in passing that the same recipe would
raise the other zones' MAE gain by 3-9 points but would lose the gate for FI D+6..D+8. Bring it to DK, SE and NL where it is better, keep the pooled model where it is not.

**Answer in six lines.**
(1) A rule was declared and committed before the new candidates were scored (`research_no/decide_recipe.py`, commit `433b19f`), then applied mechanically: **DK1, SE1, SE2, SE3, SE4 and NL switch; DK2 and FI stay on the pooled model.**
(2) The six switched zones have 42 cells (zone x D+2..D+8): **40 gain MAE against the pooled model on BOTH the whole backtest and the hold-out, 2 are mixed (SE1/SE2 D+8), none is worse, none loses the gate** (5 % rule on whole backtest AND hold-out, unchanged).
Mean MAE gain over level+shape, whole backtest, pooled -> staged: DK1 +3.7 points, SE1 +2.4, SE2 +4.8, SE3 +3.0, SE4 +3.7, NL +7.3; hold-out +5.6, +5.0, +2.5, +2.9, +4.7, +12.3. The pooled model's level bias since September (DK1 -26, SE4 -28, NL -28 EUR/MWh at D+2) drops to -2..-12.
(3) **What does NOT improve, and the owner's metric:** the regret of the 3 cheapest hours is about level with the pooled model over the whole backtest (mean difference -0.4..+4.8 points) but **worse on the hold-out in DK1 (-7.4), NL (-6.6), SE2 (-4.1) and SE3 (-1.7)**; the ensemble ranks hours worse than pooled in 25 of the 42 cells on the hold-out. The rule's regret guard looks at the select period and the whole backtest on the mean over horizons and let this through (section 4).
SE2 is also worse than pooled on MAE since 2026-09-01 at every horizon (-0.7..-4.6 points), SE1 at D+3/D+4. Six cells lose `rankOk` (DK1/SE3/NL D+7, D+8: the page may no longer claim hour ranking there), two gain it (SE4 D+4, D+8).
(4) **FI stays pooled**: the ensemble loses the gate at D+6..D+8 (hold-out 1.9/-1.9/-2.4 against 11.3/9.9/10.2), no variant repairs it. **DK2 stays pooled although its MAE would gain 2-9 points**: every variant fails the regret guard.
(5) Staged (not rolled out): recipe table, gate/accuracy/calibration files, a job that runs the four recipe variants, **a pooled fallback** for the new ensemble zones on a day without usable fuel inputs, a one-command per-zone revert, 27 python tests and `npm run test:gate` green; dry runs on Spark copies reproduce production bit for bit for the unchanged zones.
(6) Runtime: the 35-minute cron job is dominated by the data refresh, not by the pooled model (46 s here); the model part is 84 s in a dry run and the seven extra ensemble zones add about 25 s (section 6).

## 1. Protocol (the Nordic gate's, unchanged)

Same frame, folds and scorer as `forecast-nordic-no.md` section 1: rolling origin from 2025-04, two-month LightGBM folds and weekly ridge refits, baseline level+shape, periods whole backtest 2025-04-01..2026-10-31, select ..2026-06-30, hold-out 2026-07-01.., since-September 2026-09-01..,
the 5 % rule on the whole backtest AND the hold-out, regret = what the 3 cheapest forecast hours cost against the 3 cheapest actual hours. A candidate is scored on the rows where every compared column exists (per zone and horizon). `build_gate_nordic.py` and `calibrate_nordic.py` keep their scoring code:
re-run with the same recipes they reproduce the checked-in files for NO1-NO5, DK2 and FI bit for bit (checked); what was added is plumbing (`--decision`, recipe names in the files) and the fallback entries (section 5).

**Disclosure.** The `ens` and `pooled` columns of all 13 zones already existed in the Norway research, and its write-up (which the task quoted) showed the headline numbers for DK1, NL and FI before the rule was written; the rule was therefore written knowing that `ens` helps DK/NL on average and hurts FI.
What was not known: the three new variants' numbers (they did not exist: `r365lf`, `r730nr`, `lrel13nr` were run after the rule was committed), the regret picture per zone, and every zone's select-period means. The hold-out never chose anything (it enters only through the gate's own 5 % veto, which is part of the rule being tested, as in production).

## 2. The declared candidates and the rule (`research_no/decide_recipe.py`, committed before scoring)

| name | recipe |
|---|---|
| `pooled` | production: pooled LightGBM, raw price target, 50/50 shape blend (`p0_hyb`) |
| `ens` | the staged Norway recipe: 730-day ridge + pooled LightGBM on price - level_7d, gas/carbon, leak-free reservoir, 50/50 shape (`hyb:r730lf+lrel13lf`) |
| `ens_nr` | `ens` without any reservoir feature in either model (DK1, DK2, NL have no reservoir series) |
| `ens365` | `ens` with a 365-day ridge window |
| `ens_b25`, `ens_b75` | `ens` with 25 % / 75 % seasonal profile in the intraday shape instead of 50 % |

Rule, per zone, one recipe for D+2..D+8, thresholds fixed in advance:
0. P = the horizons the pooled model publishes (>= 5 % MAE gain over level+shape on the whole backtest AND the hold-out).
1. A non-pooled candidate is **admissible** iff (a) it passes the same gate at every horizon in P (it may not unpublish anything the pooled model publishes) and (b) its mean regret gain over D+2..D+8 on the select period and on the whole backtest is not more than 1.0 point below the pooled model's.
2. S = mean over D+2..D+8 of the select-period MAE gain over level+shape.
3. The zone stays `pooled` unless an admissible candidate has S >= S(pooled) + 1.0 (a point is the seed noise of the Norway research). Among those, `ens` wins unless another admissible candidate has S >= S(ens) + 1.0; if `ens` is not admissible the highest S wins. Ties go to the simpler recipe.
Only what the rule says is staged; nothing was chosen per zone by hand. The Norwegian zones keep `ens` (their decision was taken in `forecast-nordic-no.md`; NO4 publishes no forecast days).

## 3. Result of the rule

**Decision table** (mean over D+2..D+8; S = select-period MAE gain over level+shape, points above pooled in brackets; regret = difference of the mean regret gain to pooled, select / whole)

| zone | pooled S | ens | ens_nr | ens365 | ens_b25 | ens_b75 | decision |
|---|---|---|---|---|---|---|---|
| dk1 | 14.7 | 17.5 (+2.9), +0.4/-1.6, regret worse | 17.2 (+2.5), +1.1/-0.5, ok | 17.5 (+2.8), +1.9/-0.1, ok | 18.0 (+3.3), -3.9/-5.6, regret worse | 16.3 (+1.6), -6.7/-7.1, regret worse | **ens365** |
| dk2 | 16.5 | 18.6 (+2.1), -1.9/-2.2, regret worse | 18.2 (+1.7), -1.7/-2.2, regret worse | 18.8 (+2.3), -1.5/-1.7, regret worse | 19.3 (+2.8), -2.6/-3.4, regret worse | 17.1 (+0.6), -7.2/-6.3, regret worse | **pooled** |
| se1 | 12.9 | 13.5 (+0.6), +6.8/+4.9, ok | 14.7 (+1.8), +4.7/+3.6, ok | 13.1 (+0.2), +7.6/+5.6, ok | 14.0 (+1.2), +11.9/+8.9, ok | 12.5 (-0.3), +1.2/-0.4, ok | **ens_nr** |
| se2 | 9.6 | 13.8 (+4.2), +9.7/+5.8, ok | 15.1 (+5.4), +7.8/+4.8, ok | 13.2 (+3.5), +8.8/+5.4, ok | 14.4 (+4.8), +15.9/+11.3, ok | 12.8 (+3.1), +0.8/-1.3, regret worse | **ens_nr** |
| se3 | 20.2 | 23.2 (+3.0), +1.3/+0.1, ok | 24.0 (+3.8), +0.8/-0.2, ok | 24.0 (+3.8), +1.5/+0.3, ok | 23.5 (+3.4), +2.4/+1.6, ok | 22.2 (+2.0), -2.2/-3.8, regret worse | **ens** |
| se4 | 18.9 | 21.5 (+2.6), -2.4/-0.1, regret worse | 21.8 (+2.9), -2.7/-0.5, regret worse | 21.9 (+3.0), -2.0/+0.4, regret worse | 22.2 (+3.2), -0.3/+1.9, ok | 20.3 (+1.4), -7.8/-4.2, regret worse | **ens_b25** |
| nl | 13.0 | 17.1 (+4.1), +1.0/-0.8, ok | 17.7 (+4.7), +2.5/+1.0, ok | 17.1 (+4.1), +2.4/+0.7, ok | 18.1 (+5.2), +1.1/-0.4, ok | 15.2 (+2.2), -4.4/-5.2, regret worse | **ens_b25** |
| fi | 16.6 | 15.8 (-0.8), -0.9/-0.9, gate: loses D+6,7,8 | 17.1 (+0.5), -2.2/-2.1, gate: loses D+6,7,8 | 13.7 (-2.9), -0.0/-0.8, gate: loses D+7,8 | 16.4 (-0.2), +5.3/+4.3, gate: loses D+6,7,8 | 14.7 (-1.9), -7.2/-7.0, gate: loses D+6,7,8 | **pooled** |


**dk1: `ens365`**

| | MAE gain % whole / hold-out / since Sep: pooled | ens365 | regret gain % whole / hold-out: pooled | ens365 | bias since Sep: pooled | ens365 |
|---|---|---|---|---|---|---|
| D+2 | 21.2 / 24.0 / 22.7 | 25.9 / 29.1 / 30.0 | 23.6 / 15.3 | 22.4 / 8.9 | -26.1 | -4.5 |
| D+3 | 20.5 / 23.6 / 22.8 | 23.9 / 27.1 / 27.6 | 25.4 / 16.9 | 25.6 / 14.3 | -29.2 | -6.8 |
| D+4 | 18.3 / 22.0 / 20.4 | 21.4 / 25.8 / 25.1 | 21.5 / 15.1 | 22.9 / 8.1 | -30.2 | -6.8 |
| D+5 | 15.7 / 20.0 / 17.5 | 18.9 / 24.8 / 23.6 | 17.4 / 24.9 | 10.6 / 11.0 | -30.5 | -5.4 |
| D+6 | 12.5 / 16.2 / 12.0 | 17.0 / 23.7 / 20.7 | 17.3 / 18.2 | 20.5 / 18.9 | -31.7 | -5.5 |
| D+7 | 12.1 / 15.2 / 8.9 | 15.8 / 22.1 / 19.5 | 8.3 / 11.0 | 9.7 / -1.9 | -30.4 | -3.4 |
| D+8 | 12.1 / 13.7 / 6.5 | 15.2 / 21.2 / 18.2 | 8.2 / 8.1 | 9.7 / -2.0 | -30.2 | -3.8 |

**dk2: stays `pooled` (the table shows the staged `ens` for comparison, it is NOT used)**

| | MAE gain % whole / hold-out / since Sep: pooled | ens | regret gain % whole / hold-out: pooled | ens | bias since Sep: pooled | ens |
|---|---|---|---|---|---|---|
| D+2 | 22.3 / 25.3 / 24.3 | 26.8 / 31.6 / 32.4 | 22.0 / 12.1 | 22.2 / 5.0 | -25.4 | -2.5 |
| D+3 | 21.7 / 24.5 / 23.7 | 24.8 / 29.5 / 29.6 | 24.2 / 9.5 | 23.7 / 7.1 | -28.8 | -5.3 |
| D+4 | 19.9 / 22.9 / 21.8 | 22.5 / 28.3 / 27.6 | 16.2 / 10.6 | 11.7 / -3.2 | -30.4 | -6.6 |
| D+5 | 16.9 / 19.8 / 17.8 | 20.1 / 26.1 / 24.7 | 17.4 / 12.8 | 14.7 / 10.2 | -30.8 | -5.9 |
| D+6 | 13.9 / 16.2 / 12.0 | 18.2 / 25.0 / 21.0 | 16.2 / 3.2 | 11.1 / 0.1 | -30.7 | -5.8 |
| D+7 | 13.4 / 14.5 / 7.9 | 17.2 / 23.1 / 18.8 | 7.7 / -6.3 | 6.9 / -4.1 | -31.0 | -5.4 |
| D+8 | 13.4 / 12.8 / 5.2 | 16.5 / 21.8 / 17.2 | 7.2 / -5.5 | 5.1 / -5.2 | -30.9 | -5.8 |

**se1: `ens_nr`**

| | MAE gain % whole / hold-out / since Sep: pooled | ens_nr | regret gain % whole / hold-out: pooled | ens_nr | bias since Sep: pooled | ens_nr |
|---|---|---|---|---|---|---|
| D+2 | 12.7 / 16.0 / 23.7 | 20.5 / 22.9 / 24.2 | 18.0 / 18.7 | 22.4 / 15.1 | 1.2 | 0.2 |
| D+3 | 12.8 / 13.5 / 22.7 | 17.4 / 17.9 / 21.7 | 14.1 / 15.7 | 18.1 / 22.6 | 0.2 | 1.7 |
| D+4 | 13.0 / 13.5 / 23.7 | 15.8 / 16.8 / 22.0 | 10.8 / 17.8 | 14.8 / 24.3 | 0.1 | 1.8 |
| D+5 | 12.1 / 9.9 / 16.7 | 13.4 / 14.3 / 17.0 | 7.3 / 13.8 | 9.8 / 12.6 | -0.8 | 2.3 |
| D+6 | 11.9 / 6.6 / 15.0 | 12.1 / 12.7 / 15.7 | 6.3 / 15.9 | 12.1 / 7.5 | -1.5 | 2.3 |
| D+7 | 11.8 / 6.3 / 13.1 | 12.5 / 11.8 / 14.8 | 6.3 / 17.0 | 8.8 / 13.8 | -2.9 | 2.1 |
| D+8 | 12.5 / 6.1 / 13.3 | 12.0 / 10.5 / 13.8 | 5.7 / 15.3 | 7.5 / 15.4 | -2.5 | 2.7 |

**se2: `ens_nr`**

| | MAE gain % whole / hold-out / since Sep: pooled | ens_nr | regret gain % whole / hold-out: pooled | ens_nr | bias since Sep: pooled | ens_nr |
|---|---|---|---|---|---|---|
| D+2 | 11.2 / 17.9 / 22.8 | 21.7 / 24.1 / 22.1 | 20.4 / 24.3 | 23.7 / 19.9 | -4.4 | -0.9 |
| D+3 | 11.3 / 16.2 / 22.7 | 18.3 / 20.6 / 19.9 | 15.5 / 23.4 | 22.3 / 19.6 | -5.5 | 0.8 |
| D+4 | 11.4 / 16.0 / 23.0 | 16.5 / 17.7 / 19.5 | 12.8 / 20.4 | 21.7 / 20.9 | -6.2 | 1.1 |
| D+5 | 10.5 / 14.5 / 20.1 | 13.7 / 16.9 / 17.8 | 13.2 / 20.3 | 16.9 / 21.4 | -7.1 | 1.7 |
| D+6 | 9.7 / 10.1 / 16.4 | 12.6 / 13.3 / 14.1 | 5.8 / 15.5 | 11.2 / 12.4 | -6.9 | 3.3 |
| D+7 | 9.6 / 11.5 / 17.2 | 12.8 / 12.5 / 13.9 | 7.3 / 18.8 | 11.0 / 9.6 | -8.0 | 3.0 |
| D+8 | 10.6 / 12.3 / 17.6 | 12.4 / 11.1 / 13.0 | 6.7 / 18.3 | 8.8 / 8.8 | -7.7 | 3.6 |

**se3: `ens`**

| | MAE gain % whole / hold-out / since Sep: pooled | ens | regret gain % whole / hold-out: pooled | ens | bias since Sep: pooled | ens |
|---|---|---|---|---|---|---|
| D+2 | 23.6 / 26.0 / 26.9 | 29.9 / 31.6 / 32.0 | 19.1 / 18.1 | 19.6 / 15.1 | -1.6 | -2.5 |
| D+3 | 23.0 / 24.6 / 25.5 | 27.5 / 28.4 / 28.6 | 14.6 / 9.8 | 15.7 / 7.2 | -3.3 | -2.1 |
| D+4 | 21.6 / 24.0 / 23.8 | 24.7 / 26.0 / 26.1 | 9.7 / 14.0 | 8.3 / 14.2 | -4.5 | -1.6 |
| D+5 | 19.3 / 19.2 / 18.1 | 22.0 / 23.0 / 22.6 | 6.4 / 11.4 | 11.1 / 13.8 | -5.7 | 0.3 |
| D+6 | 18.3 / 17.8 / 15.2 | 20.2 / 19.6 / 17.8 | 6.3 / 7.3 | 7.5 / 6.3 | -5.2 | 3.5 |
| D+7 | 17.2 / 14.6 / 8.8 | 18.9 / 16.5 / 13.8 | 8.3 / 17.2 | 4.2 / 10.8 | -5.0 | 2.1 |
| D+8 | 18.2 / 14.9 / 8.0 | 18.9 / 16.2 / 13.2 | 5.8 / 11.6 | 4.9 / 9.8 | -4.5 | 2.6 |

**se4: `ens_b25`**

| | MAE gain % whole / hold-out / since Sep: pooled | ens_b25 | regret gain % whole / hold-out: pooled | ens_b25 | bias since Sep: pooled | ens_b25 |
|---|---|---|---|---|---|---|
| D+2 | 22.6 / 22.4 / 23.3 | 30.4 / 31.1 / 30.6 | 19.7 / 8.4 | 25.0 / 11.8 | -28.2 | -12.2 |
| D+3 | 21.7 / 20.4 / 21.4 | 27.7 / 27.1 / 27.6 | 17.0 / 6.5 | 24.6 / 14.6 | -31.5 | -14.7 |
| D+4 | 20.5 / 20.0 / 19.5 | 24.8 / 25.0 / 24.8 | 12.4 / 2.9 | 15.8 / 12.5 | -33.5 | -15.5 |
| D+5 | 17.8 / 17.0 / 15.8 | 21.1 / 22.1 / 22.0 | 8.3 / 1.4 | 7.1 / -0.1 | -35.6 | -15.6 |
| D+6 | 16.4 / 16.1 / 12.4 | 18.9 / 19.9 / 17.7 | 8.8 / -1.5 | 11.6 / 1.2 | -34.8 | -13.4 |
| D+7 | 15.4 / 14.9 / 9.6 | 16.9 / 16.7 / 14.2 | 11.4 / 5.1 | 9.7 / 12.4 | -35.4 | -15.7 |
| D+8 | 15.9 / 14.7 / 7.6 | 16.4 / 16.4 / 13.1 | 12.2 / 4.8 | 9.2 / 14.0 | -35.0 | -15.9 |

**nl: `ens_b25`**

| | MAE gain % whole / hold-out / since Sep: pooled | ens_b25 | regret gain % whole / hold-out: pooled | ens_b25 | bias since Sep: pooled | ens_b25 |
|---|---|---|---|---|---|---|
| D+2 | 18.2 / 20.2 / 15.6 | 28.1 / 32.5 / 32.7 | 22.5 / 19.1 | 36.5 / 36.4 | -28.0 | -1.6 |
| D+3 | 16.3 / 16.8 / 12.3 | 25.3 / 29.6 / 29.1 | 19.0 / 28.1 | 29.9 / 27.5 | -31.6 | -5.5 |
| D+4 | 15.2 / 15.2 / 11.1 | 22.2 / 26.0 / 25.9 | 14.3 / -6.8 | 18.2 / -1.4 | -32.9 | -6.1 |
| D+5 | 13.2 / 13.1 / 9.1 | 20.8 / 26.1 / 26.2 | 13.8 / 2.8 | 11.7 / -23.0 | -34.0 | -6.2 |
| D+6 | 10.1 / 11.5 / 6.1 | 16.6 / 23.7 / 21.0 | 18.2 / 6.3 | 16.1 / 10.8 | -33.1 | -6.0 |
| D+7 | 9.7 / 10.1 / 1.9 | 15.6 / 22.4 / 18.7 | 13.3 / 9.4 | -0.1 / -16.4 | -32.7 | -3.8 |
| D+8 | 9.7 / 8.6 / -0.7 | 15.0 / 21.6 / 17.1 | 12.2 / 7.1 | -1.4 / -14.3 | -32.5 | -4.6 |

**fi: stays `pooled` (the table shows the staged `ens` for comparison, it is NOT used)**

| | MAE gain % whole / hold-out / since Sep: pooled | ens | regret gain % whole / hold-out: pooled | ens | bias since Sep: pooled | ens |
|---|---|---|---|---|---|---|
| D+2 | 16.4 / 18.6 / 23.5 | 19.7 / 15.9 / 18.9 | 20.4 / 22.7 | 22.5 / 25.6 | -5.6 | -1.9 |
| D+3 | 16.8 / 17.0 / 23.0 | 17.4 / 11.1 / 16.4 | 19.1 / 17.2 | 22.3 / 18.0 | -7.2 | -0.1 |
| D+4 | 17.0 / 17.1 / 24.1 | 16.2 / 10.1 / 16.5 | 15.4 / 19.6 | 17.7 / 14.7 | -7.8 | -0.7 |
| D+5 | 15.9 / 14.7 / 20.6 | 13.7 / 8.3 / 14.7 | 16.9 / 21.3 | 15.0 / 16.9 | -8.1 | 1.2 |
| D+6 | 15.7 / 11.3 / 17.5 | 11.7 / 1.9 / 10.7 **fails** | 13.0 / 17.5 | 12.2 / 13.9 | -8.5 | 4.5 |
| D+7 | 15.1 / 9.9 / 14.8 | 10.0 / -1.9 / 6.4 **fails** | 17.1 / 17.5 | 9.9 / 18.8 | -9.2 | 4.9 |
| D+8 | 16.4 / 10.2 / 14.7 | 10.4 / -2.4 / 6.1 **fails** | 15.6 / 13.7 | 11.8 / 15.3 | -8.9 | 5.9 |

## 4. Cells: gained, lost, at risk, and what does not improve

Switched zones, 42 cells, staged recipe against pooled (`research_no/report_ens.py`, `report_ens.txt` for the bootstrap):

* **Improve** (MAE gain higher on the whole backtest AND on the hold-out): 40. **Mixed**: 2 (SE1 D+8: 12.0/10.5 against 12.5/6.1, whole backtest lower, hold-out higher; SE2 D+8: hold-out 11.1 against 12.3). **Worse**: 0. **Lose the gate**: 0. **Newly pass the gate**: 0 (the pooled model passes all 56 cells of these eight zones already).
* The `low` flag (gain below 10 % in the whole backtest, the hold-out or since September) falls from 33 to 15 of the 84 published cells; `rankOk` goes 70 -> 66 (DK1 D+7/D+8, SE3 D+7/D+8, NL D+7/D+8 lost; SE4 D+4/D+8 gained). Band coverage of the new bands is 0.79-0.81 (rolling out of sample), as before.
* **At risk (thinnest passes):** 90 % day-block bootstrap of the hold-out gain: SE1 D+8 lower bound 6.1 (gain 10.5), SE1 D+7 7.2, SE2 D+8 7.2, SE1 D+6 7.7; every other cell's lower bound is 8.7 or more; no cell has a point estimate under 10 % on the weaker of the two periods. By quarter the recipe is positive in every quarter for DK1, SE1, SE2, SE3, SE4; NL D+7/D+8 are -1.3 / -3.6 % in 2026 Q1 (and positive in the other six quarters).
* The gains are largest in the recent high-price regime (improvement over pooled since September, mean MAE gain points: NL +16.5, DK1 +7.7, SE4 +5.8, SE3 +4.0), as in Norway: if the regime reverses they shrink toward the whole-backtest figures, not to zero.

**What does not improve**
* **Regret (the owner's metric).** Mean of (staged - pooled) regret gain over D+2..D+8 in points, whole backtest / hold-out / since September: DK1 -0.1 / -7.4 / -4.4, SE1 +3.6 / -0.4 / +2.1, SE2 +4.8 / -4.1 / -3.8, SE3 +0.1 / -1.7 / -4.9, SE4 +1.9 / +5.6 / +7.0, NL -0.4 / -6.6 / -5.1. The recipes win on the level (MAE, bias) and are about even on picking the cheap hours over the whole backtest;
  on the hold-out the pooled model picks them better in DK1, NL, SE2, SE3. Cells with a hold-out regret gain below zero for the staged recipe: DK1 D+7/D+8 (-1.9/-2.0), NL D+4/D+5/D+7/D+8 (-1.4/-23.0/-16.4/-14.3; the pooled NL model is already -6.8 at D+4). `rankOk` in the accuracy file already withholds the "hour ranking" claim there.
  A hold-out regret veto would have kept DK1, NL, SE2, SE3 on the pooled model (only SE1 and SE4 would switch); the declared rule does not use the hold-out to choose, so it does not. **This is the call the owner should make; `revert_zone_recipe.py` makes it per zone (section 7).**
* **SE2 since September:** the staged recipe is 0.7-4.6 points worse than pooled at every horizon since 2026-09-01 (22.1/19.9/19.5/17.8/14.1/13.9/13.0 against 22.8/22.7/23.0/20.1/16.4/17.2/17.6); SE1 D+3/D+4 too (21.7/22.0 against 22.7/23.7). Both are ahead on the whole backtest and the hold-out, where the pooled model's SE1/SE2 gains were weak (6-18 %).
* **DK2 stays pooled** although all five ensemble variants beat it on S by 0.6-2.8 points and keep the gate: every one of them fails the regret guard (select -1.5..-7.2, whole -1.7..-6.3). **FI stays pooled**: `ens`, `ens_nr`, `ens_b25`, `ens_b75` lose D+6, D+7, D+8 and `ens365` D+7, D+8 on the hold-out; `ens_nr` has S +0.5 but loses the same three cells. FI is the one zone where the ridge is poor (hold-out 1.9/-1.9/-2.4 at D+6..D+8).
* **The variant choices are within noise.** Only SE3 (and Norway) get the plain `ens`. DK1 `ens365` (S 17.52) against `ens_nr` (17.22) and `ens` (17.54, which fails the regret guard by 0.6 point): picked by the rule's mechanics, not because a 365-day window is better. SE1/SE2 `ens_nr` beat `ens` by 1.2 points each; SE4/NL `ens_b25` beat `ens` by 0.6 and 1.0 (NL: 18.147 against 17.126, barely over the 1.0 margin).
  Plain `ens` wherever it is admissible (SE1, SE2, SE3, NL) would differ from the table by 0.0-1.3 points of S per zone (SE1 -1.2, SE2 -1.3, NL -1.0); SE4's `ens` is inadmissible (regret guard), `ens_b25` is its only admissible candidate.
* The research numbers are rolling two-month/weekly refits; production refits daily. No live accuracy exists for any of the staged recipes (no monitor for the Nordic keys).

## 5. What is staged (code and tests; NOT rolled out)

Files in `scripts/forecast_model/nordic/` (the old cron job `train_daily.py` is untouched):
* `recipe_nordic.py`: `VARIANTS` (`ens`, `ens365`, `ens_nr`, `ens_b25` = ridge window, reservoir features yes/no, seasonal share); `ridge_design`, `lear_predict`, `lgb_fit`, `lgb_predict`, `hybrid` take the variant's parameters; the defaults reproduce the Norway recipe exactly (NO1-NO3, NO5 forecasts are bit-identical in the dry run).
* `train_daily_v2.py`: ensemble zones are grouped by variant (one LightGBM per reservoir flavour: with reservoir for ens/ens365/ens_b25, without for ens_nr; one ridge per zone, horizon and window); logs ridge/tree timings.
  **Pooled fallback:** a new ensemble zone (DK1, SE1-SE4, NL) carries the pooled model's own gate entry, accuracy cells and bands (`fallback` in the three files, built by the same code and rule); on a day with no usable fuel (the gas/carbon cache older than the limit) or when the ensemble raises, such a zone is published from the pooled model with those numbers (`recipe: pooled`),
  exactly what it was before the switch. NO1-NO3 and NO5 (the pooled model fails the gate there) publish settled days only, as before. Before this change only the Norwegian zones depended on fuel; without the fallback six more zones would have lost their forecast on a fuel outage.
* `publish_nordic.py`: `has_fallback`, `load_calibration_fallback`, `published_horizons` / `accuracy_block` with `fallback=True`.
* `publish_gate_nordic.json`, `accuracy_nordic.json`, `calibration_nordic_v2.json`: rebuilt with `research_no/build_gate_nordic.py --decision decision_ens.json` and `calibrate_nordic.py --decision decision_ens.json --gate publish_gate_nordic.json` (the scorer, rule and band recipe unchanged). The gate still publishes 84 of 91 zone-horizons (NO4's seven are the missing ones).
* `research_no/`: `decide_recipe.py` (rule), `decision_ens.json` (every cell of every candidate and the decision), `report_ens.py`, `md_tables_ens.py` (these tables), `report_ens.txt` (bootstrap and quarters), `nfr.py` / `score_nfr.py` (new candidates, hybrid weight).
* `revert_zone_recipe.py`: promotes a zone's fallback to primary in the three files (no research frame needed).
* `test_nordic_recipe.py` (27 tests, wired into `test-eu-forecast.mjs`): the earlier 19 plus the checked-in files obey the 5 % rule with their fallbacks, the recipe table equals the decision file's, variants and no-reservoir feature sets, hybrid weight, ridge window cut, fallback helpers, revert. `npm run test:gate`: green.

## 6. Dry runs on Spark copies and runtime

Copies: `~/nordic-ens-stage` (new code and files), `~/nordic-ens-stage-base` (production's live files), `~/nordic-ens-stage-fb` (new files, fuel cache removed); `--dry-run --skip-refresh`, nice 10, 6 threads, 2026-11-08 18:08 UTC; `~/nordic`, the crontab, KV and the Worker not touched. Stage data are production's of 17:38.
* New against the old code on the same data: NO1-NO3, NO5, DK2 and FI forecasts are **identical to 0.00 EUR/MWh in every hour** (the refactor changes nothing for them); production's `forecast_latest_v2.json` of 17:39 agrees (weather had not moved).
* Switched zones, daily mean EUR/MWh, staged / pooled (settled 2026-11-09 in brackets): DK1 D+2 296/248 (349), D+5 246/237, D+8 222/202; SE3 D+2 211/160 (250), D+5 159/107, D+8 158/104; SE4 D+2 333/261 (390), D+5 259/217, D+8 248/194; NL D+2 289/240 (342), D+5 253/240, D+8 228/210;
  SE1 D+2 38/48 (15), D+5 27/35, D+8 35/21; SE2 D+2 31/37 (6), D+5 21/34, D+8 28/21. The staged recipes sit nearer the current level in the high-price zones, as the bias numbers say; for SE1/SE2 both models forecast 2-8 times the recent settled level (prices of 5-15 EUR/MWh): nothing here can be verified against actuals yet.
* Fuel off (`~/nordic-ens-stage-fb`): the six new ensemble zones publish the pooled feed with the pooled accuracy and bands (identical to the old feed, 0.0 EUR/MWh, bands included), NO1-NO3 and NO5 settled days only, DK2/FI unchanged; 13/13 zones written.
* **Runtime.** The old production job (`train_daily.py`) of 2026-11-08 ran from 12:40 to 13:15 (35 minutes: the cron start and the last write of its log), so the fit cannot be most of it: the rest is the data refresh and, in the old job, the Hugging Face upload (inferred, the refresh was not re-timed here); the model part measured here is much smaller: pooled model 46 s, ensemble LightGBM (with reservoir) 30 s, a second LightGBM without reservoir for SE1/SE2 24 s,
  the ridges for all 11 ensemble zones 3 s; whole dry run 84 s (old recipe table) against 107 s (new): **the seven extra ensemble zones add about 25 s** (the second tree for `ens_nr` and the ridges; two dry runs in parallel, each nice 10, on a machine at load 1-3). The refresh, which this change does not touch, is the 25-33 minutes.

## 7. Rollout and rollback (owner; nothing was done)

The live files in `~/nordic` are the ones installed on 2026-11-08 (md5 equal to git `7b5bbe7`); they are backed up in `~/nordic-ens-backup-20261108/` (recipe_nordic.py, publish_nordic.py, train_daily_v2.py, the three json files, forecast_latest_v2.json).
1. Decide the zones: if the regret on the hold-out matters more than MAE, put DK1, NL, SE2 and SE3 back first: `python3 revert_zone_recipe.py dk1 nl se2 se3` on the three files (and change the recipe pin in `test_nordic_recipe.py` to match).
2. Copy `recipe_nordic.py publish_nordic.py train_daily_v2.py publish_gate_nordic.json accuracy_nordic.json calibration_nordic_v2.json` into `~/nordic` (the EU helpers the ensemble needs were installed on 2026-11-08; no new dependency).
3. Outside the cron windows (12:10, 12:40, 12:50, 15:15 UTC): `cd ~/nordic && set -a && . ~/.config/elpriser.env && set +a && nice -n 10 python3 train_daily_v2.py --dry-run --skip-refresh` (about 2 minutes): expect `FUEL on`, `DONE 13/13`, recipes `ens365 / pooled / ens / ens_nr / ens_b25` in the per-zone lines, and compare with the backed-up `forecast_latest_v2.json` (NO, DK2, FI unchanged).
4. One real run by hand (`python3 train_daily_v2.py --skip-refresh`), then `https://elpriser.org/api/nordic?zone=dk1` (and se1, se4, nl, no4): `days`, `horizon`, band, `recipe`, `accuracy.recipe`.
5. The cron line already runs `train_daily_v2.py`: the next 12:40 run uses the new files. Refresh the gate quarterly: `nfr.py frame`, `nfr.py lgb p0 lrel13lf lrel13nr`, `nfr.py ridge r730lf r730nr r365lf`, `merge`, `decide_recipe.py`, `build_gate_nordic.py --decision`, `calibrate_nordic.py --decision --gate` (the Spark research frame for this work was deleted; `forecast-nordic-no.md` section 7 point 5 describes rebuilding it).

**Rollback.** All: copy the six backed-up files over `~/nordic`'s and run `train_daily_v2.py` once by hand (it overwrites `nordic-forecast-<zone>`; the keys expire in 3 days anyway). One zone: `revert_zone_recipe.py <zone>`. A fuel outage needs no action (automatic fallback). The pooled model's `train_daily.py` path is unchanged.

## 8. Not verified, open items

* No live accuracy for any staged recipe; the gate numbers are research (weekly/two-month refits, daily refits in production); the gains are concentrated in the 2026 Q3-Q4 price rise.
* No real KV write, no Worker rendering of the new fields, no refreshed-data run (`--skip-refresh`); the live row parity check (`verify_parity_nordic.py`) was not re-run (feature code untouched; NO forecasts are bit-identical to the old code; for the other variants only subsets of the same columns are used).
* Not re-tested: the HF model upload that the old job did (v2 does not publish to the Hub).
* The Nordic pages do not print the `accuracy` block yet (page change, Worker untouched); the fuel inputs' licence question of `forecast-nordic-no.md` applies to eleven zones now instead of five.
* The RTX machine was not needed: all runs fit the Spark in minutes.


## Owner's regret veto, applied 2026-11-08

The declared rule chose `ens365` for DK1, `ens_nr` for SE1 and SE2, `ens` for SE3 and `ens_b25` for SE4 and NL. The owner judges forecasts by regret of the 3 cheapest hours, which on the hold-out is worse than the pooled model in DK1 (-7.4), NL (-6.6), SE2 (-4.1) and SE3 (-1.7). Those four were put back on the pooled model with `revert_zone_recipe.py dk1 nl se2 se3` (the three files in `scripts/forecast_model/nordic/` carry the result; `research_no/decision_ens.json` keeps the rule's own choice). Only **SE1 (`ens_nr`) and SE4 (`ens_b25`)** run the ensemble. The pinned table in `test_nordic_recipe.py` states the veto. A quarterly rebuild from `decision_ens.json` would bring the four zones back: apply the veto again or revisit it with live accuracy.
