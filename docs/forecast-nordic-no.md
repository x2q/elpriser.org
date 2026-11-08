# Nordic zones: an honest gate table and a better Norway (research of 2026-11-08, nothing applied to production)

Scripts: `scripts/forecast_model/nordic/research_no/` (`nfr.py` frame and candidate runners, `score_nfr.py` the gate scorer, `diag*.py` the diagnosis). Everything ran on the Spark in
`~/nordic-no-research` (a copy; `~/nordic`, `~/eu-forecast`, `~/prognose3`, the crontab, KV and the Worker were not touched).

## Candidates, declared before the runs (select period 2025-04-01..2026-06-30 only decides; hold-out 2026-07-01.. never chooses)

| id | what | why |
|---|---|---|
| `p0` | the production model re-run for h 2..8: raw price target, pooled over 13 zones, 30 features, 500 x 127 leaves, 50/50 seasonal shape (`p0_hyb`) | reproduce the table |
| `lrel13` | the EU recipe's tree: target = price - level_7d, EU parameters, pooled over the 13 zones, Nordic features + fuel | target and extrapolation |
| `lrelno` | same, trained on NO1-NO5 only | pooled model dragged by other zones? |
| `lrel13nc` | `lrel13` without month / doy | the tree memorising last year's price on the same date |
| `lrel13z` | `lrel13` + cross-zone level context (continental / Norwegian / Swedish 7-day level vs own) | NO prices follow neighbours |
| `lrel13x`, `lrelnox` | + hydrology proxy (degree-day snow store, 30-day rain, from the weather as issued), leak-free reservoir (A72) | fundamentals |
| `r365`, `r730` | LEAR ridge on the residual of level+shape (the EU recipe's linear half, with fuel and the Nordic extras), 365 / 730-day window | the EU recipe |
| `r365xz`, `r730xz`, `r365xzh`, `r365xzhr`, `r365hr`, `r730xzh` | the ridge + cross-zone / hydrology / reservoir columns | fundamentals in the linear model |
| `r365nofuel` | ridge without gas / carbon | does Norway need the fuel inputs |
| ensembles | equal-weight means of one ridge and one tree column (nothing fitted) | the EU recipe |
| level correction | trailing 14-day error shift, lambda 0.5 (`level_correction.py`) on the best candidate | bias after a level shift |

Rule for picking: one recipe for the Norway group, chosen by the mean gain over NO1-NO5 and D+2..D+7 on the select period; then its whole-backtest and hold-out gains decide, per zone-horizon, the 5 % rule (both must be >= 5 %). Cells that get worse are reported.
