#!/usr/bin/env python3
"""Fuel-price INPUTS for the EU forecast model (gas, carbon, and optionally gas-storage fill), cached as one daily CSV.

These are model inputs only. Nothing here is displayed, published or redistributed: the site shows a price forecast, never a
gas or carbon price (see docs/forecast-per-region.md for the source evaluation and the terms of each source).

Sources (all free, keyless unless noted):
  gas_da   MIBGAS, the Iberian gas market operator: the daily price index of the Spanish virtual balancing point (PVB),
           product GDAES_D+1 = the day-ahead index fixed on the trading day, in EUR/MWh. Yearly CSV files, history from 2015,
           trading days include weekends. Used as the level anchor of European gas (the PVB trades a few EUR/MWh over TTF).
  gas_m1   the same operator's month-ahead index (product GMAES), EUR/MWh: the forward the day-ahead is heading towards.
  eua      EEX, EU Emission Allowance primary-market auction clearing price (EUR/tCO2), fixed at 11:00 CET on every auction day
           (several days a week; volume-weighted when more than one auction runs the same day). Yearly .xlsx reports.
  full     (optional) EU gas-storage fill in per cent, AGSI+ by Gas Infrastructure Europe. Needs a FREE API KEY
           (registration at agsi.gie.eu), read from the environment variable GIE_API_KEY. Without the key this column is
           simply absent - no part of the model requires it.

The cached file is `fuel_daily.csv` (date, gas_da, gas_m1, eua[, full]) with the sources' own days; gaps (weekends for the
EUA, days a source did not publish) stay empty and are filled forward only when a feature is computed (fuel_features.py),
so the cache never invents a value.

    python3 fetch_fuel.py [--from 2023-01-01] [--out fuel_daily.csv]
"""
import argparse
import io
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import warnings
from datetime import date

import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
UA = "elpriser.org/1.0 (+https://elpriser.org; hello@elpriser.org)"
MIBGAS_URL = "https://www.mibgas.es/en/file-access/MIBGAS_Data_{year}.csv?path=AGNO_{year}/XLS"
EEX_URL = "https://public.eex-group.com/eex/eua-auction-report/emission-spot-primary-market-auction-report-{year}-data.xlsx"
AGSI_URL = "https://agsi.gie.eu/api"
GAS_PRODUCTS = {"GDAES_D+1": "gas_da", "GMAES": "gas_m1"}


def http_get(url, headers=None, tries=3, timeout=90):
    """Bytes of a GET; retries on network errors and 5xx. Error messages never carry the URL's query (it may hold a key)."""
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code in (400, 401, 403, 404):
                break
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = type(e).__name__
        if attempt + 1 < tries:
            import time
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"GET failed ({last})")


# ------------------------------------------------------------------ gas: MIBGAS
def parse_mibgas(text):
    """MIBGAS_Data_<year>.csv text -> DataFrame(date, gas_da, gas_m1) on the TRADING day.

    The file starts with a 'Fecha Emision' line, then a ';'-separated table: Trading day (dd/mm/yyyy); Product; Place of
    delivery; Area; First/Last Day Delivery; price. Only the PVB day-ahead (GDAES_D+1) and month-ahead (GMAES) rows are kept.
    A decimal comma (the web export uses one) is accepted as well as the point of the file download."""
    lines = [ln for ln in text.lstrip("﻿").splitlines() if ln.strip()]
    start = next((i for i, ln in enumerate(lines) if ln.lower().startswith("trading day")), None)
    if start is None:
        raise ValueError("not a MIBGAS data file (no 'Trading day' header)")
    df = pd.read_csv(io.StringIO("\n".join(lines[start:])), sep=";", index_col=False, dtype=str)
    price_col = [c for c in df.columns if "price" in c.lower()][0]
    df = df[df["Product"].isin(GAS_PRODUCTS) & (df["Place of delivery"] == "PVB")].copy()
    df["date"] = pd.to_datetime(df["Trading day"], format="%d/%m/%Y")
    df["price"] = pd.to_numeric(df[price_col].str.replace(",", ".", regex=False), errors="coerce")
    df["col"] = df["Product"].map(GAS_PRODUCTS)
    out = df.pivot_table(index="date", columns="col", values="price", aggfunc="last")
    for c in GAS_PRODUCTS.values():
        if c not in out:
            out[c] = float("nan")
    return out[list(GAS_PRODUCTS.values())].sort_index()


def fetch_mibgas(years):
    frames = []
    for y in years:
        try:
            frames.append(parse_mibgas(http_get(MIBGAS_URL.format(year=y)).decode("utf-8-sig", "replace")))
        except (RuntimeError, ValueError) as e:
            print(f"  MIBGAS {y}: {e}", file=sys.stderr)
    if not frames:
        return pd.DataFrame(columns=list(GAS_PRODUCTS.values()))
    out = pd.concat(frames).sort_index()
    return out[~out.index.duplicated(keep="last")]      # neighbouring yearly files overlap (the same trading day twice, same value)


# ------------------------------------------------------------------ carbon: EEX auctions
def parse_eex_auctions(source):
    """EEX 'EUA Primary Market Auction Report' .xlsx (path or bytes) -> Series eua (EUR/tCO2) indexed by auction date.

    The sheet 'EU ETS1' has a banner, then a header row holding 'Date' and 'Auction Price EUR/tCO2' (the euro sign is
    matched loosely) and one row per auction, newest first. Only successful auctions count; several auctions on one date are
    averaged weighted by auction volume."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)        # openpyxl: "Workbook contains no default style" (EEX's writer)
        raw = pd.read_excel(io.BytesIO(source) if isinstance(source, (bytes, bytearray)) else source,
                            sheet_name=0, header=None)
    hdr = next((i for i in range(min(30, len(raw))) if str(raw.iat[i, 1]).strip().lower() == "date"), None)
    if hdr is None:
        raise ValueError("not an EEX auction report (no 'Date' header row)")
    cols = [str(c).strip() for c in raw.iloc[hdr]]
    body = raw.iloc[hdr + 1:].copy()
    body.columns = cols
    price = next(c for c in cols if c.lower().startswith("auction price"))
    vol = next((c for c in cols if c.lower().startswith("auction volume")), None)
    status = next((c for c in cols if c.lower() == "status"), None)
    body = body[pd.to_datetime(body["Date"], errors="coerce").notna()]
    if status:
        body = body[body[status].astype(str).str.lower() == "successful"]
    d = pd.DataFrame({"date": pd.to_datetime(body["Date"]).dt.normalize(),
                      "p": pd.to_numeric(body[price], errors="coerce"),
                      "v": pd.to_numeric(body[vol], errors="coerce") if vol else 1.0}).dropna(subset=["p"])
    d["v"] = d["v"].fillna(1.0).clip(lower=1.0)
    d["pv"] = d["p"] * d["v"]
    g = d.groupby("date")
    return (g["pv"].sum() / g["v"].sum()).rename("eua").sort_index()


def fetch_eua(years):
    parts = []
    for y in years:
        try:
            parts.append(parse_eex_auctions(http_get(EEX_URL.format(year=y))))
        except (RuntimeError, ValueError) as e:
            print(f"  EEX {y}: {e}", file=sys.stderr)
    if not parts:
        return pd.Series(dtype=float, name="eua")
    out = pd.concat(parts).sort_index()
    return out[~out.index.duplicated(keep="last")]


# ------------------------------------------------------------------ storage: AGSI+ (needs a key)
def parse_agsi(payload):
    """AGSI+ JSON ({'data': [{'gasDayStart': 'YYYY-MM-DD', 'full': '85.2', ...}]}) -> Series full (per cent) by gas day.
    Documented response shape; verified against a saved fixture only - the live endpoint needs a registered key."""
    rows = payload.get("data", []) if isinstance(payload, dict) else []
    s = {pd.Timestamp(r["gasDayStart"]): pd.to_numeric(r.get("full"), errors="coerce") for r in rows if r.get("gasDayStart")}
    return pd.Series(s, name="full", dtype=float).sort_index()


def fetch_agsi(start, key, scope="eu"):
    """EU storage fill from `start`; None without a key. Paginates (the API returns up to `size` rows a page)."""
    if not key:
        return None
    out, page = [], 1
    while True:
        q = urllib.parse.urlencode({"type": scope, "from": start, "size": 300, "page": page})
        payload = json.loads(http_get(f"{AGSI_URL}?{q}", headers={"x-key": key}).decode("utf-8"))
        out.append(parse_agsi(payload))
        if page >= int(payload.get("last_page", 1) or 1):
            break
        page += 1
    return pd.concat(out).sort_index()


# ------------------------------------------------------------------ cache
def combine(gas, eua, full=None):
    """The three sources on one daily index (union of their days, nothing filled)."""
    df = gas[~gas.index.duplicated(keep="last")].copy()
    df = df.join(eua[~eua.index.duplicated(keep="last")].rename("eua"), how="outer")
    if full is not None and len(full):
        df = df.join(full.rename("full"), how="outer")
    df.index.name = "date"
    return df.sort_index()


def update(out_path, start="2023-01-01", key=None):
    """Re-pull from `start` and write the cache. A source that fails keeps its OLD cached values (the merge prefers fresh values
    but never drops a cached day), so a blocked source degrades to staleness, which fuel_features reports, not to a gap."""
    years = range(pd.Timestamp(start).year, date.today().year + 1)
    fresh = combine(fetch_mibgas(years), fetch_eua(years), fetch_agsi(start, key if key is not None else os.environ.get("GIE_API_KEY")))
    if os.path.exists(out_path):
        old = pd.read_csv(out_path, parse_dates=["date"], index_col="date")
        fresh = fresh.combine_first(old)
    fresh = fresh[fresh.index >= pd.Timestamp(start)]
    fresh.to_csv(out_path)
    return fresh


def load(path):
    return pd.read_csv(path, parse_dates=["date"], index_col="date").sort_index()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", default="2023-01-01")
    ap.add_argument("--out", default=os.path.join(DIR, "fuel_daily.csv"))
    a = ap.parse_args()
    df = update(a.out, a.start)
    last = {c: (df[c].dropna().index.max().date().isoformat() if df[c].notna().any() else None) for c in df.columns}
    print(f"{a.out}: {len(df)} days {df.index.min().date()} -> {df.index.max().date()}; last value per column: {last}")


if __name__ == "__main__":
    main()
