#!/usr/bin/env python3
"""
One-off local backup: pulls all available history from every data source the
forecasting project uses, and writes it to ../../data-backup/ (gitignored) as
Parquet files. Not part of the production pipeline — run manually.

Sources and their earliest-available data (probed 2026-07-03):
  - EDS DayAheadPrices (DK1, DK2)              ~2025-10-01 onward
  - EDS Elspotprices (DK1, DK2, legacy dataset) checked at run time, may go back further
  - EDS ProductionConsumptionSettlement (DK1, DK2)
  - JAO Nordic fbDomainShadowPrice (NonRedundant filter, raw per-CNEC rows)  ~2024-11-01 onward
  - ENTSO-E DE-LU day-ahead prices (A44)         ~2018-10-01 onward
  - ENTSO-E DE-LU actual generation per type (A75/A16, all psrTypes)  ~2018-10-01 onward

Both JAO and ENTSO-E need chunked requests -- a single multi-year request
times out or is rejected.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.parse
from datetime import date, datetime, timedelta

import pandas as pd

# Outside the repo entirely, not just gitignored: `wrangler pages deploy`
# uploads the whole local directory regardless of git-tracking status, so a
# gitignored-but-present data-backup/ folder still blocks deploys once it
# has anything in it over Pages' 25MiB per-file limit (learned the hard way).
OUT_DIR = os.environ.get("BACKUP_OUT_DIR", os.path.expanduser("~/elpriser-data-backup"))
JAO_TOKEN = os.environ.get("JAO_TOKEN", "66d45fc6-a2ce-499b-9d81-b92de7c8bb97")
ENTSOE_TOKEN = os.environ.get("ENTSOE_TOKEN", "a3f638e6-3312-4ebb-96c3-2b588516e41e")
DE_LU_EIC = "10Y1001A1001A82H"
DK_EIC = {"DK1": "10YDK-1--------W", "DK2": "10YDK-2--------M"}

# Confirmed via probing 2026-07-03: every zone below works via ENTSO-E; GB
# does NOT (post-Brexit, GB stopped reporting to ENTSO-E entirely -- prices,
# generation, and load all return "No matching data found"; UK market data
# now lives in Elexon/BMRS instead, and DK has no direct GB interconnector
# anyway). DE-LU, NO2, SE3, SE4, NL already backed up in an earlier run --
# excluded here to avoid re-fetching them.
ENTSOE_ZONES = {
    "no1": "10YNO-1--------2",
    "no3": "10YNO-3--------J",
    "no4": "10YNO-4--------9",
    "no5": "10Y1001A1001A48H",
    "se1": "10Y1001A1001A44P",
    "se2": "10Y1001A1001A45N",
    "fi":  "10YFI-1--------U",
}

# EICs for DK1/DK2's actual interconnector-partner zones, kept here as fixed
# constants (not pulled from ENTSOE_ZONES, which only holds zones still
# pending a full price/generation fetch and gets pruned as those complete).
NO2_EIC = "10YNO-2--------T"
SE3_EIC = "10Y1001A1001A46L"
SE4_EIC = "10Y1001A1001A47J"
NL_EIC = "10YNL----------L"

# Confirmed via A11 (physical flow) probing: these are DK1/DK2's actual
# interconnector pairs (all six returned real data, not "No matching data").
BORDER_PAIRS = [
    ("dk1_delu", DK_EIC["DK1"], DE_LU_EIC),
    ("dk1_no2", DK_EIC["DK1"], NO2_EIC),
    ("dk1_se3", DK_EIC["DK1"], SE3_EIC),
    ("dk1_nl", DK_EIC["DK1"], NL_EIC),
    ("dk2_delu", DK_EIC["DK2"], DE_LU_EIC),
    ("dk2_se4", DK_EIC["DK2"], SE4_EIC),
]

# Every zone we care about, for the "extra" document types (load, installed
# capacity, wind/solar forecast) -- includes DK1/DK2 via ENTSO-E directly
# (already have DK1/DK2 prices/production via EDS, but this gives a complete,
# internally-consistent ENTSO-E-only dataset alongside it).
ALL_ZONES = {
    "dk1": DK_EIC["DK1"], "dk2": DK_EIC["DK2"],
    "delu": DE_LU_EIC, "no1": "10YNO-1--------2", "no2": NO2_EIC,
    "no3": "10YNO-3--------J", "no4": "10YNO-4--------9", "no5": "10Y1001A1001A48H",
    "se1": "10Y1001A1001A44P", "se2": "10Y1001A1001A45N", "se3": SE3_EIC, "se4": SE4_EIC,
    "fi": "10YFI-1--------U", "nl": NL_EIC,
}

TODAY = date.today()


def fetch_json(url, headers=None, timeout=60):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def save(df, name):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"{name}.parquet")
    df.to_parquet(path, index=False)
    print(f"  saved {path} ({len(df)} rows)")


# ─── EDS ──────────────────────────────────────────────────────────────────

def fetch_eds_dataset(dataset, area, start, end, extra_cols=""):
    # No `sort` param: different EDS datasets use different timestamp column
    # names (TimeUTC vs HourUTC), and a sort referencing a nonexistent column
    # causes a 400. Ordering doesn't matter for a backup — sort locally after
    # loading if needed.
    f = urllib.parse.quote(json.dumps({"PriceArea": area}))
    cols = f"&columns={extra_cols}" if extra_cols else ""
    url = (f"https://api.energidataservice.dk/dataset/{dataset}"
           f"?start={start}&end={end}&filter={f}&limit=0{cols}")
    j = fetch_json(url)
    return pd.DataFrame(j.get("records", []))


def fetch_eds_with_retry(dataset, area, start, end, max_retries=6, base_wait=30):
    """EDS's rate limit appears to be request-COUNT based (a single big
    multi-year request succeeds fine once the limit is clear, but several
    small chunked requests in a row get 429'd faster than a couple of large
    ones) -- so retry the same single full-range request with backoff
    instead of splitting it into more requests."""
    for attempt in range(max_retries):
        try:
            return fetch_eds_dataset(dataset, area, start, end)
        except Exception as e:
            if "429" not in str(e) or attempt == max_retries - 1:
                raise
            wait = base_wait * (attempt + 1)
            print(f"    rate limited, waiting {wait}s (attempt {attempt + 1}/{max_retries})...")
            time.sleep(wait)


def backup_eds():
    print("=== EDS ===")
    for area in ["DK1", "DK2"]:
        print(f"Fetching DayAheadPrices {area}...")
        try:
            df = fetch_eds_with_retry("DayAheadPrices", area, "2000-01-01", (TODAY + timedelta(days=1)).isoformat())
            if len(df):
                save(df, f"eds_dayaheadprices_{area.lower()}")
        except Exception as e:
            print(f"  failed: {e}")
        time.sleep(5)

        print(f"Fetching Elspotprices {area} (full range, single request)...")
        try:
            df = fetch_eds_with_retry("Elspotprices", area, "2000-01-01", (TODAY + timedelta(days=1)).isoformat())
            if len(df):
                save(df, f"eds_elspotprices_{area.lower()}")
            else:
                print("  no Elspotprices data found")
        except Exception as e:
            print(f"  failed: {e}")
        time.sleep(5)

        print(f"Fetching ProductionConsumptionSettlement {area}...")
        try:
            df = fetch_eds_with_retry("ProductionConsumptionSettlement", area, "2000-01-01",
                                       (TODAY + timedelta(days=1)).isoformat())
            if len(df):
                save(df, f"eds_productionconsumptionsettlement_{area.lower()}")
        except Exception as e:
            print(f"  failed: {e}")
        time.sleep(5)


# ─── JAO ──────────────────────────────────────────────────────────────────

def fetch_jao_day(d):
    url = "https://publicationtool.jao.eu/nordic/api/data/fbDomainShadowPrice"
    params = {
        "FromUtc": f"{d.isoformat()}T00:00:00.000Z", "ToUtc": f"{(d + timedelta(days=1)).isoformat()}T00:00:00.000Z",
        "Skip": 0, "Take": 0, "Filter": json.dumps({"NonRedundant": True}),
    }
    full_url = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(full_url, headers={"Authorization": f"Bearer {JAO_TOKEN}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        probe = json.loads(r.read())
    total = probe.get("totalRowsWithFilter", 0)
    if total == 0:
        return []
    params["Take"] = total
    full_url2 = url + "?" + urllib.parse.urlencode(params)
    req2 = urllib.request.Request(full_url2, headers={"Authorization": f"Bearer {JAO_TOKEN}"})
    with urllib.request.urlopen(req2, timeout=60) as r:
        full = json.loads(r.read())
    return full.get("data", [])


def backup_jao(start=date(2024, 11, 1)):
    print("=== JAO Nordic (fbDomainShadowPrice, NonRedundant only) ===")
    rows = []
    d = start
    n = 0
    while d <= TODAY:
        try:
            rows.extend(fetch_jao_day(d))
        except Exception as e:
            print(f"  failed for {d}: {e}")
        n += 1
        if n % 30 == 0:
            print(f"  ...{n} days fetched, {len(rows)} rows so far")
        time.sleep(0.15)
        d += timedelta(days=1)
    print(f"  {n} days fetched total, {len(rows)} rows")
    if rows:
        save(pd.DataFrame(rows), "jao_nordic_fbdomainshadowprice")


# ─── ENTSO-E ──────────────────────────────────────────────────────────────

def curl_get(url, timeout=90):
    # Shells out to curl instead of urllib: this sandbox's network path has a
    # local proxy with a self-signed cert that curl trusts (via the OS
    # keychain) but Python's bundled certifi store doesn't. Confirmed
    # elsewhere (see price-forecasting-analysis.md memory) that this is a
    # local-only artifact -- GitHub Actions runners don't hit it -- but for
    # this one-off local backup, curl is the pragmatic fix.
    result = subprocess.run(["curl", "-s", "--max-time", str(timeout), url],
                             capture_output=True, text=True, check=True)
    return result.stdout


def _parse_points(xml_text, series_regex, value_tag, extra_field=None, extra_regex=None):
    """Shared point-extraction for any ENTSO-E GL_MarketDocument-style response:
    splits into <TimeSeries> blocks, reads each block's start+resolution, then
    walks its <Point> entries pulling out `value_tag` (price.amount / quantity)."""
    rows = []
    for series in re.split(r"<TimeSeries>", xml_text)[1:]:
        extra_val = None
        if extra_regex:
            m = re.search(extra_regex, series)
            extra_val = m.group(1) if m else None
        period = re.search(r"<start>([^<]+)</start>.*?<resolution>([^<]+)</resolution>", series, re.S)
        if not period:
            continue
        start_dt = datetime.fromisoformat(period.group(1).replace("Z", "+00:00"))
        step_minutes = 15 if period.group(2) == "PT15M" else 60
        for m in re.finditer(rf"<Point>\s*<position>(\d+)</position>\s*<{value_tag}>([\-\d.]+)</{value_tag}>", series):
            pos, val = int(m.group(1)), float(m.group(2))
            ts = start_dt + timedelta(minutes=step_minutes * (pos - 1))
            row = {"datetime_utc": ts.isoformat(), "value": val}
            if extra_field:
                row[extra_field] = extra_val
            rows.append(row)
    return rows


def fetch_entsoe_prices_chunk(domain_eic, start, end):
    params = {
        "securityToken": ENTSOE_TOKEN, "documentType": "A44",
        "in_Domain": domain_eic, "out_Domain": domain_eic,
        "periodStart": start.strftime("%Y%m%d%H%M"), "periodEnd": end.strftime("%Y%m%d%H%M"),
    }
    url = "https://web-api.tp.entsoe.eu/api?" + urllib.parse.urlencode(params)
    rows = _parse_points(curl_get(url), None, "price.amount")
    return [{"datetime_utc": r["datetime_utc"], "price_eur_mwh": r["value"]} for r in rows]


def fetch_entsoe_generation_chunk(domain_eic, start, end):
    params = {
        "securityToken": ENTSOE_TOKEN, "documentType": "A75", "processType": "A16",
        "in_Domain": domain_eic,
        "periodStart": start.strftime("%Y%m%d%H%M"), "periodEnd": end.strftime("%Y%m%d%H%M"),
    }
    url = "https://web-api.tp.entsoe.eu/api?" + urllib.parse.urlencode(params)
    rows = _parse_points(curl_get(url), None, "quantity", "psr_type", r"<psrType>(\w+)</psrType>")
    return [{"datetime_utc": r["datetime_utc"], "psr_type": r["psr_type"], "quantity_mw": r["value"]} for r in rows]


def fetch_entsoe_flow_chunk(in_eic, out_eic, start, end):
    """A11: actual cross-border physical flow, direction out_eic -> in_eic."""
    params = {
        "securityToken": ENTSOE_TOKEN, "documentType": "A11",
        "in_Domain": in_eic, "out_Domain": out_eic,
        "periodStart": start.strftime("%Y%m%d%H%M"), "periodEnd": end.strftime("%Y%m%d%H%M"),
    }
    url = "https://web-api.tp.entsoe.eu/api?" + urllib.parse.urlencode(params)
    rows = _parse_points(curl_get(url), None, "quantity")
    return [{"datetime_utc": r["datetime_utc"], "flow_mw": r["value"]} for r in rows]


def fetch_entsoe_ntc_chunk(in_eic, out_eic, start, end):
    """A61: day-ahead estimated Net Transfer Capacity, direction out_eic -> in_eic.
    Confirmed only ~1 day ahead (same wall as everything else in this project),
    so this is a hindsight/historical feature only, not usable for T+2..T+6."""
    params = {
        "securityToken": ENTSOE_TOKEN, "documentType": "A61", "contract_MarketAgreement.Type": "A01",
        "in_Domain": in_eic, "out_Domain": out_eic,
        "periodStart": start.strftime("%Y%m%d%H%M"), "periodEnd": end.strftime("%Y%m%d%H%M"),
    }
    url = "https://web-api.tp.entsoe.eu/api?" + urllib.parse.urlencode(params)
    rows = _parse_points(curl_get(url), None, "quantity")
    return [{"datetime_utc": r["datetime_utc"], "ntc_mw": r["value"]} for r in rows]


def _chunked_fetch(fn, args, start, end, chunk_days, label, every=10):
    rows = []
    cur = start
    n = 0
    while cur < end:
        chunk_end = min(cur + timedelta(days=chunk_days), end)
        try:
            rows.extend(fn(*args, cur, chunk_end))
        except Exception as e:
            print(f"    {label} fetch failed {cur}..{chunk_end}: {e}")
        n += 1
        if n % every == 0:
            print(f"    ...{n} chunks, {len(rows)} rows so far")
        cur = chunk_end
    return rows


def backup_entsoe_zones(start=date(2018, 10, 1)):
    for name, eic in ENTSOE_ZONES.items():
        print(f"=== ENTSO-E {name.upper()} ===")
        print("Fetching day-ahead prices (A44), chunked...")
        rows = _chunked_fetch(fetch_entsoe_prices_chunk, (eic,), start, TODAY, 90, "price", every=5)
        if rows:
            save(pd.DataFrame(rows), f"entsoe_{name}_dayahead_prices")

        print("Fetching actual generation per type (A75/A16), chunked...")
        rows = _chunked_fetch(fetch_entsoe_generation_chunk, (eic,), start, TODAY, 30, "generation")
        if rows:
            save(pd.DataFrame(rows), f"entsoe_{name}_generation_per_type")


def backup_entsoe_borders(start=date(2018, 10, 1)):
    for name, in_eic, out_eic in BORDER_PAIRS:
        print(f"=== ENTSO-E border {name} ===")
        print(f"Fetching physical flows (A11) {name}, both directions, chunked...")
        fwd = _chunked_fetch(fetch_entsoe_flow_chunk, (in_eic, out_eic), start, TODAY, 90, "flow-fwd", every=5)
        rev = _chunked_fetch(fetch_entsoe_flow_chunk, (out_eic, in_eic), start, TODAY, 90, "flow-rev", every=5)
        for r in fwd:
            r["direction"] = name.split("_")[1] + "_to_" + name.split("_")[0]
        for r in rev:
            r["direction"] = name.split("_")[0] + "_to_" + name.split("_")[1]
        if fwd or rev:
            save(pd.DataFrame(fwd + rev), f"entsoe_flow_{name}")

        print(f"Fetching day-ahead NTC (A61) {name}, both directions, chunked...")
        fwd = _chunked_fetch(fetch_entsoe_ntc_chunk, (in_eic, out_eic), start, TODAY, 90, "ntc-fwd", every=5)
        rev = _chunked_fetch(fetch_entsoe_ntc_chunk, (out_eic, in_eic), start, TODAY, 90, "ntc-rev", every=5)
        for r in fwd:
            r["direction"] = name.split("_")[1] + "_to_" + name.split("_")[0]
        for r in rev:
            r["direction"] = name.split("_")[0] + "_to_" + name.split("_")[1]
        if fwd or rev:
            save(pd.DataFrame(fwd + rev), f"entsoe_ntc_{name}")


def fetch_entsoe_load_chunk(domain_eic, process_type, start, end):
    """A65: Total Load. processType A16 = actual (realised), A01 = day-ahead forecast."""
    params = {
        "securityToken": ENTSOE_TOKEN, "documentType": "A65", "processType": process_type,
        "outBiddingZone_Domain": domain_eic,
        "periodStart": start.strftime("%Y%m%d%H%M"), "periodEnd": end.strftime("%Y%m%d%H%M"),
    }
    url = "https://web-api.tp.entsoe.eu/api?" + urllib.parse.urlencode(params)
    rows = _parse_points(curl_get(url), None, "quantity")
    return [{"datetime_utc": r["datetime_utc"], "load_mw": r["value"]} for r in rows]


def fetch_entsoe_windsolar_forecast_chunk(domain_eic, start, end):
    """A69/A01: day-ahead wind+solar generation forecast. Confirmed elsewhere
    this only extends ~1 day out (not a multi-day forecast), so history here
    is just whatever ENTSO-E happened to retain -- archived as-is."""
    params = {
        "securityToken": ENTSOE_TOKEN, "documentType": "A69", "processType": "A01",
        "in_Domain": domain_eic,
        "periodStart": start.strftime("%Y%m%d%H%M"), "periodEnd": end.strftime("%Y%m%d%H%M"),
    }
    url = "https://web-api.tp.entsoe.eu/api?" + urllib.parse.urlencode(params)
    rows = _parse_points(curl_get(url), None, "quantity", "psr_type", r"<psrType>(\w+)</psrType>")
    return [{"datetime_utc": r["datetime_utc"], "psr_type": r["psr_type"], "forecast_mw": r["value"]} for r in rows]


def fetch_entsoe_capacity_year(domain_eic, year):
    """A68/A33: installed generation capacity per type, one snapshot per year."""
    params = {
        "securityToken": ENTSOE_TOKEN, "documentType": "A68", "processType": "A33",
        "in_Domain": domain_eic,
        "periodStart": f"{year}01010000", "periodEnd": f"{year + 1}01010000",
    }
    url = "https://web-api.tp.entsoe.eu/api?" + urllib.parse.urlencode(params)
    xml_text = curl_get(url)
    rows = []
    for series in re.split(r"<TimeSeries>", xml_text)[1:]:
        psr = re.search(r"<psrType>(\w+)</psrType>", series)
        qty = re.search(r"<quantity>([\d.]+)</quantity>", series)
        if psr and qty:
            rows.append({"year": year, "psr_type": psr.group(1), "installed_capacity_mw": float(qty.group(1))})
    return rows


def backup_entsoe_extra(start=date(2018, 10, 1)):
    """The 'harvest everything' pass: load, installed capacity, and wind/solar
    forecast for every zone we track, including DK1/DK2 (already have DK
    prices/production via EDS, but this gives a complete, self-consistent
    ENTSO-E-only view alongside it)."""
    for name, eic in ALL_ZONES.items():
        print(f"=== ENTSO-E {name.upper()} (extra) ===")

        print("Fetching total load actual (A65/A16), chunked...")
        rows = _chunked_fetch(fetch_entsoe_load_chunk, (eic, "A16"), start, TODAY, 90, "load-actual", every=5)
        if rows:
            save(pd.DataFrame(rows), f"entsoe_{name}_load_actual")

        print("Fetching total load day-ahead forecast (A65/A01), chunked...")
        rows = _chunked_fetch(fetch_entsoe_load_chunk, (eic, "A01"), start, TODAY, 90, "load-forecast", every=5)
        if rows:
            save(pd.DataFrame(rows), f"entsoe_{name}_load_forecast")

        print("Fetching wind+solar day-ahead forecast (A69/A01), chunked...")
        rows = _chunked_fetch(fetch_entsoe_windsolar_forecast_chunk, (eic,), start, TODAY, 90, "windsolar-fc", every=5)
        if rows:
            save(pd.DataFrame(rows), f"entsoe_{name}_windsolar_forecast")

        print("Fetching installed generation capacity per type (A68/A33), yearly...")
        cap_rows = []
        for year in range(start.year, TODAY.year + 1):
            try:
                cap_rows.extend(fetch_entsoe_capacity_year(eic, year))
            except Exception as e:
                print(f"    {year} failed: {e}")
        if cap_rows:
            save(pd.DataFrame(cap_rows), f"entsoe_{name}_installed_capacity")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "eds"):
        backup_eds()
    if which in ("all", "jao"):
        backup_jao()
    if which in ("all", "entsoe", "entsoe-zones"):
        backup_entsoe_zones()
    if which in ("all", "entsoe", "entsoe-borders"):
        backup_entsoe_borders()
    if which == "entsoe-extra":  # not part of "all"/"entsoe" -- explicit opt-in, big fetch
        backup_entsoe_extra()
    print("Done.")
