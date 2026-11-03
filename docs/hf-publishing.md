# Open models on Hugging Face

What is published, why some of it is not, how it stays current and how to roll it back. The licence audit behind it is
[`scripts/forecast_model/hf/DATA_LICENCES.md`](../scripts/forecast_model/hf/DATA_LICENCES.md) (shipped in every model repo); the cards are
`scripts/forecast_model/{v3,nordic}/MODEL_CARD.md` and `scripts/forecast_model/hf/{eu,gb}/MODEL_CARD.md`.

## What is on the Hub (org `Elpriser`, 2026-11-03)

| Repo | What | Exactly the production model? | Refreshed |
|---|---|---|---|
| `denmark-price-forecast` | DK1/DK2 v3 LightGBM quantile models, wind estimators, calibration, training code | **Yes** | daily, by `v3/train_daily.py` (cron 12:10) |
| `nordic-price-forecast` | pooled 13-zone LightGBM (DK, NO, SE, FI, NL), calibration, training code | **Yes** | daily, by `nordic/train_daily.py` (cron 12:40) |
| `eu-price-forecast` | eu-ens-v2 **without** the gas and carbon inputs: LightGBM + 132 ridges, gate, accuracy, band offsets, inference code | **No**: production adds the MIBGAS gas index and the EEX carbon auction price | weekly snapshot (below) |
| `gb-price-estimate` | gb-est-v1 (GB intraday estimate, D+1..D+7) and the hour-23 rule of PT and IE, inference code | Yes (a snapshot of the daily retrain) | weekly snapshot (below) |

`EU` fuel-free costs about 3 % in MAE (median over zones; pooled hourly gain over the naive method 19.9 % against 22.0 % with fuel, 12.8 % against 16.7 % since 1 Sept 2026;
`scripts/forecast_model/hf/backtest_summary.py` reproduces it from the research backtest). So the honest sentence is "the forecast models are open; elsewhere in Europe as a variant
without two of the production model's price inputs", which is what the apps, the API description, llms.txt and the store listings (English, Danish) now say. The site and API text deliberately
do not name the two inputs (`test-api.mjs` pins that rule while the licences are unconfirmed); the Hugging Face card for the EU model does, because a model card has to say what the production model uses.

## What is held back, and the way out

The fuel-trained EU weights (`lgb_fuel`, its P10/P90 models, `ridge_fuel`) are staged outside the repo and **never uploaded**; no gas, carbon or derived fuel number is in any repo, and
`stage.py` refuses any file that looks like them (guard, run before every assemble and upload). To publish them after MIBGAS and EEX have confirmed in writing: export with
`export_eu.py --with-fuel` (writes `held-fuel/`), put them in a separate repo `eu-price-forecast-fuel` (or a `fuel/` folder with its own card) and extend the guard on purpose; add the two sources to
the card's attribution. If either says no, nothing changes here (`EU_FORECAST_NO_FUEL=1` in the job's environment, see the runbook).

## Keeping the weights current (weekly snapshot)

`scripts/forecast_model/hf/snapshot_hf.py` (+ `snapshot_hf.sh`) on the Spark, **not installed**: for EU and GB it reads what the production jobs already hold, exports the weights below
`~/hf-publish/out`, assembles the repo, runs the guard, verifies the staged copy against the production code path on frozen inputs (exact agreement or no upload), and uploads in one
commit tagged `snapshot-YYYY-MM-DD`. The README is not touched (`--readme` to refresh the card tables after the gate files change). DK and Nordic need nothing: their jobs upload daily.

Setup (once): `rsync -a scripts/forecast_model/hf/ cc@spark:~/hf-publish/hf/ && cp ~/hf-publish/hf/snapshot_hf.sh ~/hf-publish/ && chmod +x ~/hf-publish/snapshot_hf.sh`; test with
`cd ~/hf-publish && set -a && . ~/.config/elpriser.env && set +a && python3 hf/snapshot_hf.py --dry-run` (needs `HF_TOKEN` in the environment file; no upload). Then ONE new crontab line, the rest of the crontab untouched:

```
45 15 * * 0  /home/cc/hf-publish/snapshot_hf.sh        # Sunday 15:45 UTC, after the 15:15 EU run; stands aside if that job is running
```

Why Sunday 15:45: the export needs the caches the 15:15 run just refreshed, and it never takes the EU job's lock (a held `flock -n` lock would make the production run skip). It runs at `nice 10`, 1 hour limit, about two minutes in practice (the dry run on 2026-11-03 took 100 seconds for both repos).

Rollback of a snapshot: download an earlier tag (`snapshot_download("Elpriser/eu-price-forecast", revision="snapshot-2026-11-03")`) and upload it back with `stage.py upload ... --no-readme`, or revert at the Hub. The production site never reads the Hub, so a bad snapshot cannot affect it.

## Wording that matches this

Changed in this commit (English and Danish): the apps' About line (`about_text`, Android, iOS, `i18n/strings/{en,da}.json`), the English and Danish store listings (`docs/store/{en,da}.md`,
`ElpriserAndroid/store/play-listings-europe.md`), the API page box on Hugging Face (`index.html`), the OpenAPI description of `/api/nordic` and `llms.txt`. The Danish /prognose text and the Nordic/NL zone notes
("one open machine-learning model for all 13 zones") were already true and are unchanged; the legacy Denmark-only listings (`ElpriserAndroid/store/listing-da.md`, `ElpriserIOS/store/listing-da.md`) describe the Danish forecast and are unchanged.

**Still to translate** (25 languages, native review as for the other app strings): the same two sentences in every other `i18n/strings/<lang>.json`, `res/values-<lang>/strings.xml`, `docs/store/<lang>.md` and the other languages
of `play-listings-europe.md`. Until then those still say "the forecast model is open on Hugging Face", which is true for Denmark, the Nordics, the Netherlands and Great Britain and imprecise for the other EU zones.

* `about_text`: "... the forecast comes from open models on Hugging Face (elsewhere in Europe a variant without two of its price inputs) ..."
* store listing: "The forecast models are open on Hugging Face (elsewhere in Europe as a variant without two of the production model's price inputs)."

## Open points

* ENTSO-E: day-ahead prices (A44), generation (A75) and reservoir filling (A72) are **not** on ENTSO-E's CC BY 4.0 free-re-use list (version 2023-10-18). The weights are published on the reading that statistical parameters do not prejudice a
  primary owner; the **datasets** in the Hub org that carry these series labelled CC BY 4.0 (`germany-power-market`, `netherlands-power-market`, `power-price-forecast-data`, parts of `denmark-power-market`) are a bigger question: ask ENTSO-E / the primary owners, or
  re-label them as "ENTSO-E data, Terms of Use".
* Open-Meteo: the data are CC BY 4.0 but the free API is for non-commercial use (no advertising, no subscriptions); the site shows no "Weather data by Open-Meteo.com" credit anywhere. Add the credit where the forecast is described and decide whether
  elpriser.org (or the planned B2B flex-capacity work) needs a paid plan. The v3 and Nordic cards used to say "free for commercial and non-commercial use": corrected.
* Code licence: weights, code and documentation in all four repos are tagged CC BY 4.0 (as before); a software licence for the code (MIT/Apache-2.0) is the owner's call.
* SEMOpx states no licence; the Irish price page and the Irish hour-23 input rely on it.
