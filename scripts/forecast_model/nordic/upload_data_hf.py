#!/usr/bin/env python3
"""Publish every input the price-forecast models train on, as one dataset repo.

The rare part here is the WEATHER FORECAST AS IT WAS ISSUED — Open-Meteo's
previous-runs archive, reorganised per bidding zone and lead time. Almost
every public weather archive stores what actually happened; training a
forecasting model on that and then serving it live forecasts is the single
most common way to build a model that looks good offline and disappoints in
production. These files let anyone avoid that without re-deriving the archive.
"""
import os
import shutil

import pandas as pd
from huggingface_hub import HfApi

REPO = "Elpriser/power-price-forecast-data"
NORDIC = os.path.expanduser("~/nordic")
DK = os.path.expanduser("~/prognose3")
STAGE = os.path.expanduser("~/hf_data_stage")
BACKUP = os.path.expanduser("~/elpriser-data-backup")

# Energinet splits the Danish day-ahead price across two datasets at the move
# to 15-minute market resolution. Neither covers the whole history on its own.
DK_SPLIT_NOTE = "Elspotprices 2000-01-01..2025-09-30, DayAheadPrices 2025-10-01.."

ZONES = ["dk1", "dk2", "no1", "no2", "no3", "no4", "no5",
         "se1", "se2", "se3", "se4", "fi", "nl"]
DK_POINTS = ["dk1_inland", "dk1_hornsrev", "dk1_anholt", "dk1_south",
             "dk2_zealand", "dk2_rodsand", "dk2_north",
             "de_north", "de_central", "de_south", "no2", "se3", "se4", "nl"]


def build_denmark_history():
    """Denmark's full price history as one continuous series, from the two
    Energinet datasets that each hold only part of it.

    Keyed on UTC, with local wall-clock alongside. That is not a stylistic
    choice: the autumn fall-back repeats 02:00, so a naive local timestamp
    cannot tell the two apart and silently averages them into one row, losing
    an hour every year. Grouping the 15-minute data on the UTC hour keeps both.
    """
    hourly, quarterly = [], []
    for a in ("dk1", "dk2"):
        e = pd.read_parquet(f"{BACKUP}/eds_elspotprices_{a}.parquet")
        e = pd.DataFrame({"t_utc": pd.to_datetime(e.HourUTC),
                          "t_local": pd.to_datetime(e.HourDK), "area": a.upper(),
                          "dkk_mwh": e.SpotPriceDKK, "eur_mwh": e.SpotPriceEUR})

        d = pd.read_parquet(f"{BACKUP}/eds_dayaheadprices_{a}.parquet")
        q = pd.DataFrame({"t_utc": pd.to_datetime(d.TimeUTC),
                          "t_local": pd.to_datetime(d.TimeDK), "area": a.upper(),
                          "dkk_mwh": d.DayAheadPriceDKK, "eur_mwh": d.DayAheadPriceEUR})
        quarterly.append(q)
        # Every quarter is present here, so a plain mean is already
        # duration-weighted — unlike the ENTSO-E A03 blocks elsewhere.
        dh = (q.assign(t_utc=q.t_utc.dt.floor("h"))
               .groupby(["t_utc", "area"], as_index=False)
               .agg(t_local=("t_local", lambda x: x.iloc[0].floor("h")),
                    dkk_mwh=("dkk_mwh", "mean"), eur_mwh=("eur_mwh", "mean")))
        hourly += [e, dh[["t_utc", "t_local", "area", "dkk_mwh", "eur_mwh"]]]

    h = pd.concat(hourly).sort_values(["area", "t_utc"]).reset_index(drop=True)
    q = pd.concat(quarterly).sort_values(["area", "t_utc"]).reset_index(drop=True)
    dupes = h[h.area == "DK1"].t_utc.duplicated().sum()
    if dupes:
        raise RuntimeError(f"{dupes} duplicate UTC hours — the two datasets overlap")
    h.to_parquet(f"{STAGE}/market/prices_hourly_denmark.parquet", index=False)
    q.to_parquet(f"{STAGE}/market/prices_quarterly_denmark.parquet", index=False)
    print(f"  denmark: {len(h):,} hourly rows {h.t_local.min()} -> {h.t_local.max()}")


def stage_all():
    if os.path.exists(STAGE):
        shutil.rmtree(STAGE)
    for sub in ("weather_forecast_as_issued", "weather_actual",
                "weather_denmark_highres", "market"):
        os.makedirs(f"{STAGE}/{sub}", exist_ok=True)

    # ── Nordic: one point per bidding zone, 4 variables, leads 1-7 ──
    for z in ZONES:
        for kind, dest in (("prev", "weather_forecast_as_issued"),
                           ("actual", "weather_actual")):
            src = f"{NORDIC}/w_{kind}_{z}.parquet"
            if os.path.exists(src):
                shutil.copy(src, f"{STAGE}/{dest}/{z}.parquet")

    # ── Denmark high-resolution: 14 points incl. offshore wind clusters ──
    for p in DK_POINTS:
        for pre in ("w_prev", "w_actual", "temp_prev", "temp_actual"):
            src = f"{DK}/{pre}_{p}.parquet"
            if os.path.exists(src):
                shutil.copy(src, f"{STAGE}/weather_denmark_highres/{pre}_{p}.parquet")

    # ── Market data ──
    for src, dest in ((f"{NORDIC}/prices_all.parquet", "market/prices_hourly_13zones.parquet"),
                      (f"{NORDIC}/reservoir_weekly.parquet", "market/hydro_reservoir_weekly.parquet"),
                      (f"{DK}/ntc_daily.parquet", "market/transfer_capacity_daily.parquet")):
        if os.path.exists(src):
            shutil.copy(src, f"{STAGE}/{dest}")

    # ── Denmark's long price history, and the two supporting series ──
    if os.path.exists(f"{BACKUP}/eds_elspotprices_dk1.parquet"):
        build_denmark_history()
    for src, dest in ((f"{BACKUP}/eds_productionconsumptionsettlement_dk1.parquet",
                       "market/production_consumption_dk1.parquet"),
                      (f"{BACKUP}/eds_productionconsumptionsettlement_dk2.parquet",
                       "market/production_consumption_dk2.parquet"),
                      (f"{BACKUP}/entsoe_delu_generation_per_type.parquet",
                       "market/generation_by_type_de_lu.parquet")):
        if os.path.exists(src):
            shutil.copy(src, f"{STAGE}/{dest}")

    # ── Ready-to-train dataset, so nobody has to rebuild the pipeline ──
    src = f"{NORDIC}/dataset_nordic.parquet"
    if os.path.exists(src):
        shutil.copy(src, f"{STAGE}/training_dataset_nordic.parquet")

    total = sum(os.path.getsize(os.path.join(r, f))
                for r, _, fs in os.walk(STAGE) for f in fs)
    n = sum(len(fs) for _, _, fs in os.walk(STAGE))
    print(f"staged {n} files, {total/1e6:.1f} MB")
    return total


CARD = """---
license: cc-by-4.0
tags:
  - electricity
  - energy
  - power-markets
  - weather
  - nordic
  - time-series
  - forecasting
pretty_name: Power Price Forecasting Inputs (Nordics + NL)
---

# Power Price Forecasting Inputs — Nordics + Netherlands

Every input behind the price-forecast models at
[elpriser.org](https://elpriser.org): weather, prices, hydro reservoirs and
interconnector capacity, for 13 bidding zones.

Models trained on this data:
[nordic-price-forecast](https://huggingface.co/Elpriser/nordic-price-forecast) (13 zones)
and [denmark-price-forecast](https://huggingface.co/Elpriser/denmark-price-forecast)
(DK1/DK2, higher resolution).

## The part that is hard to get elsewhere

`weather_forecast_as_issued/` holds the weather forecast **as it looked N days
before the delivery hour**, for N = 1 to 7 — not what the weather turned out
to be.

This matters more than it sounds. Train a price model on *actual* weather and
serve it a *forecast* at inference time, and the model has never seen the
noisier input it must actually work with. It will look strong in backtest and
underperform in production, with the gap widening at longer horizons — exactly
where a multi-day forecast earns its keep. Derived from Open-Meteo's
previous-runs API, which only covers 2024-03-15 onward.

`weather_actual/` holds observed weather over a longer window, for fitting
weather-to-production relationships where using actuals is legitimate (a
static physical mapping, fed forecast weather at both train and serve time).

## Contents

| Path | What it is | Coverage |
|---|---|---|
| `weather_forecast_as_issued/{zone}.parquet` | Wind 100m, direct radiation, temperature, precipitation — each at leads of 1-7 days. One representative point per bidding zone | 2024-03-15 → present, hourly |
| `weather_actual/{zone}.parquet` | Same four variables, observed | 2022-01-01 → present, hourly |
| `weather_denmark_highres/` | 14 points for the Denmark-only model: offshore wind clusters (Horns Rev, Anholt, Rødsand), German wind north and solar south, plus neighbouring zones | as above |
| `market/prices_hourly_13zones.parquet` | Day-ahead prices, EUR/MWh, all 13 zones from one source so no currency boundary | 2024-01-01 → present, hourly |
| `market/prices_hourly_denmark.parquet` | Denmark's full price history, DK1 and DK2, in DKK/MWh and EUR/MWh. Stitched from Energinet's two datasets | **2000-01-01 → present**, hourly |
| `market/prices_quarterly_denmark.parquet` | The same prices at the market's native 15-minute resolution | 2025-10-01 → present, 15-min |
| `market/production_consumption_dk{1,2}.parquet` | Production and consumption settlement per price area | hourly |
| `market/generation_by_type_de_lu.parquet` | German/Luxembourg generation by production type — the main driver of Danish price spikes | hourly |
| `market/hydro_reservoir_weekly.parquet` | Reservoir energy content, 10 hydro zones. The driver behind Nordic price levels — producers hold water back when reservoirs are low | 2022 → present, weekly |
| `market/transfer_capacity_daily.parquet` | Month-ahead forecast transfer capacity per border and direction, for Denmark's six interconnectors | 2024-03 → present, daily |
| `training_dataset_nordic.parquet` | The assembled, leakage-guarded training set: one row per (zone, hour, horizon 2-9), 30 features | 2.1M rows |

## Zones

DK1, DK2 · NO1-NO5 · SE1-SE4 · FI · NL

## Time keys, and the hour that goes missing

`prices_hourly_denmark.parquet` carries both `t_utc` and `t_local`. Use
`t_utc` as the key. Local wall-clock time repeats 02:00 on the autumn clock
change, so keying on it merges two genuinely different prices into one row and
loses an hour every year — in 2018-2024 those two hours differ by as much as
68 DKK/MWh, so the loss is not cosmetic.

Twelve UTC hours are nonetheless absent, and all of them are upstream gaps
rather than processing losses:

- **2000-2010**, the autumn fall-back hour: Energinet's historical
  `Elspotprices` does not carry it. From 2011 onward it does.
- **2025-10-26**: the first autumn change under the 15-minute market.
  `DayAheadPrices` publishes 96 quarters for that day where 100 are due.

Between 2011 and 2017 the duplicated hour holds the *same* price twice; from
2018 the two hours are priced separately, as they should be.

## Leakage discipline in the training set

If you use `training_dataset_nordic.parquet` directly, the rules already
applied are:

- one row per (zone, target hour, forecast horizon h = 2..9)
- price lag `k` is populated **only when `k >= h-1`** — at h=5 you do not yet
  know yesterday's price, and filling it would leak
- `level_30d` covers the 30 days ending at the last *known* day, not the 30
  before the target
- weather comes from the as-issued archive at lead `min(h, 7)`
- reservoir readings are lagged 14 days, deliberately more conservative than
  ENTSO-E's real weekly publication lag

## Sources & license

CC BY 4.0. Nordic prices, reservoir levels and transfer capacity: ENTSO-E
Transparency Platform. Danish prices and production/consumption:
[Energi Data Service](https://www.energidataservice.dk) (Energinet). Weather: [Open-Meteo](https://open-meteo.com) (free for
commercial and non-commercial use with attribution). Collection code:
[elpriser.org on GitHub](https://github.com/x2q/elpriser.org),
`scripts/forecast_model/`.
"""


def main():
    stage_all()
    open(f"{STAGE}/README.md", "w").write(CARD)
    token = os.environ["HF_TOKEN"]
    api = HfApi(token=token)
    api.create_repo(repo_id=REPO, repo_type="dataset", exist_ok=True)

    # One commit per folder rather than one for the whole staging tree. The
    # single-commit form fails outright on this payload — xet aborts with
    # "failed to fill whole buffer" on the 20-35 MB settlement and generation
    # files — and takes the small, more valuable price files down with it.
    # Split, and a failure costs one folder instead of the whole publish.
    folders = ["market", "weather_forecast_as_issued", "weather_actual",
               "weather_denmark_highres"]
    failed = []
    for sub in folders:
        path = f"{STAGE}/{sub}"
        if not os.path.isdir(path):
            continue
        try:
            api.upload_folder(repo_id=REPO, repo_type="dataset", folder_path=path,
                              path_in_repo=sub,
                              commit_message=f"Update {sub}")
            print(f"  uploaded {sub}", flush=True)
        except Exception as e:
            failed.append(sub)
            print(f"  FAILED {sub}: {e}", flush=True)

    for f in ("README.md", "training_dataset_nordic.parquet"):
        src = f"{STAGE}/{f}"
        if not os.path.exists(src):
            continue
        try:
            api.upload_file(path_or_fileobj=src, path_in_repo=f, repo_id=REPO,
                            repo_type="dataset", commit_message=f"Update {f}")
            print(f"  uploaded {f}", flush=True)
        except Exception as e:
            failed.append(f)
            print(f"  FAILED {f}: {e}", flush=True)

    if failed:
        raise SystemExit(f"upload incomplete, failed: {', '.join(failed)}")
    print(f"uploaded to {REPO}")


if __name__ == "__main__":
    main()
