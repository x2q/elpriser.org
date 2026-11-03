---
license: other
license_name: internal-until-data-licences-are-confirmed
tags:
  - electricity
  - energy
  - power-markets
  - europe
  - forecasting
  - lightgbm
pretty_name: eu-ens-v2 WITH gas and carbon inputs (PRIVATE, internal)
---

# eu-ens-v2 with gas and carbon inputs: PRIVATE, internal repo

**Dansk.** Dette er et PRIVAT, internt repo. Det indeholder vægtene til den EU-model, der kører på elpriser.org, inklusive gas- og CO2-input. De er ikke offentlige, fordi licensen på de to dataserier
(MIBGAS' gasindeks og EEX' CO2-auktionspris) endnu ikke er bekræftet skriftligt. Her ligger kun vægte og kode, aldrig gas- eller CO2-data. Den offentlige variant uden de to input ligger på
[Elpriser/eu-price-forecast](https://huggingface.co/Elpriser/eu-price-forecast).

**English.** This repo is **PRIVATE and internal**. It holds the weights of the EU model exactly as it runs in production, trained **with** a gas-price input (MIBGAS, Iberian gas day-ahead index) and a
carbon-price input (EEX, EU allowance auction price). It is not public because the data licences of those two sources are not confirmed in writing (enquiries to info@mibgas.es and auctions@eex.com are open).
Do not make it public, do not copy the weights elsewhere, and do not add any gas, carbon, MIBGAS or EEX data (not even a sample, a fixture or a derived table) to this repo, private or not:
`stage.py` in the GitHub repository refuses such files. The public, fuel-free variant is [Elpriser/eu-price-forecast](https://huggingface.co/Elpriser/eu-price-forecast).

The standardisation constants in `ridge_fuel.npz` and the thresholds in the boosters are parameters learned from the training data; they are not a data series, but they do reflect the gas and carbon level of the training period.
When the licences are confirmed, this model can be published as it is (move the weights to the public repo and credit the two sources); if either answer is no, delete this repo and switch the job to
`EU_FORECAST_NO_FUEL=1`.

## What is in it

| Path | What |
|---|---|
| `weights/fuel/lgb_fuel.txt`, `lgb_fuel_q10.txt`, `lgb_fuel_q90.txt` | LightGBM median and P10/P90 quantile models with the fuel features (pooled, 25 zones) |
| `weights/fuel/ridge_fuel.npz` | the 132 ridges (22 zones x D+2..D+7) with the fuel design |
| `weights/fuel/config.json`, `weights/config.json`, `weights/lgb_base.txt`, `weights/ridge_nofuel.npz` | feature lists and the fuel-free parts (the Baltics use the fuel-free LightGBM; this is the public content) |
| `gate_fuel/` | the full gate, accuracy and band-offset files of the production recipe (fuel entries included); `gate/` is the public, stripped copy |
| `code/` | the production modules, verbatim, plus `fetch_fuel.py` and `fuel_live.py` (code that downloads and checks the fuel inputs: it contains no data) |
| `eu_infer_fuel.py`, `predict_eu_fuel.py` | inference with the fuel inputs; you supply `fuel_daily.csv` yourself |

## Use

```bash
export ENTSOE_TOKEN=...
python3 predict_eu_fuel.py --fuel-csv /path/to/your/fuel_daily.csv --zones de,es
```

The central estimate is the mean of the fuel ridge and the fuel LightGBM (EE, LV, LT: the fuel-free LightGBM); P10/P90 come from the fuel quantile models plus the offsets in `gate_fuel/calibration_eu.json`.
`weights/` is a snapshot of 2026-11-03 (`weights/fuel/config.json: trainedThrough`); production refits daily. Verified on 2026-11-03 against the production code path on frozen inputs.

## What it is worth (backtest 2025-04-01 .. 2026-11-02, one backtest, one regime change; see the public card for the full discussion)

Against the fuel-free variant, over all zones and D+2..D+7: hourly gain over the naive "level + shape" method **22.0 % with fuel against 19.9 % without**, and **16.7 % against 12.8 % since the price rise of
September 2026**; the pooled bias since September is -12.3 against -18.8 EUR/MWh (the naive method: -11.0); regret of the three cheapest hours about equal (5.26 against 5.32 EUR/MWh). Bands: see `gate_fuel/accuracy_eu.json`
(`coverage`, `coverageRecent`; the band covered 63-93 % of the hours per zone since September). No live accuracy has been measured yet (live since 2026-11-03). Not financial advice; consumer decision support only.

Licences of the other sources: see `DATA_LICENCES.md`.
