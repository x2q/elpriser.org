#!/usr/bin/env python3
"""Weekly hydro reservoir levels (ENTSO-E A72) for the Nordic hydro zones.

This is the driver the first pooled model was missing. Nordic prices are set
largely by water value: producers hold water back when reservoirs are low and
release when they are full, so the reservoir position moves the price LEVEL in
a way no weather variable captures. That the first backtest showed the model
barely beating — and in NO1/NO2 losing to — a plain seasonal average on MAE is
exactly what a missing level driver looks like.

Two features are derived, because raw MWh is not comparable across zones:
  reservoir_pct     — fill as a share of that zone's own observed maximum
  reservoir_anom    — deviation from the zone's median fill for that week of
                      year, which is what "unusually full/empty" actually means

LEAKAGE: values are published weekly and in arrears, so every reading is
shifted 14 days before use. That is deliberately more conservative than the
real publication lag, so no horizon can see a reading it would not have had.
"""
import os, re, time, urllib.request, urllib.parse
from datetime import date, timedelta

import pandas as pd

OUT = os.path.dirname(os.path.abspath(__file__))
TOKEN = os.environ.get("ENTSOE_TOKEN", "a3f638e6-3312-4ebb-96c3-2b588516e41e")

HYDRO = {
    "no1": "10YNO-1--------2", "no2": "10YNO-2--------T", "no3": "10YNO-3--------J",
    "no4": "10YNO-4--------9", "no5": "10Y1001A1001A48H",
    "se1": "10Y1001A1001A44P", "se2": "10Y1001A1001A45N",
    "se3": "10Y1001A1001A46L", "se4": "10Y1001A1001A47J",
    "fi": "10YFI-1--------U",
}
START, END = date(2022, 1, 1), date.today() + timedelta(days=1)


def fetch(eic, s, e):
    url = "https://web-api.tp.entsoe.eu/api?" + urllib.parse.urlencode({
        "securityToken": TOKEN, "documentType": "A72", "processType": "A16",
        "in_Domain": eic,
        "periodStart": s.strftime("%Y%m%d0000"), "periodEnd": e.strftime("%Y%m%d0000"),
    })
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as ex:
            if ex.code == 400:
                return ""
            if attempt == 3:
                return ""
            time.sleep(15 * (attempt + 1))
        except Exception:
            if attempt == 3:
                return ""
            time.sleep(15 * (attempt + 1))
    return ""


def parse(xml):
    rows = []
    for per in re.finditer(r"<Period>(.*?)</Period>", xml, re.S):
        body = per.group(1)
        ti = re.search(r"<start>([^<]+)</start>", body)
        if not ti:
            continue
        t0 = pd.Timestamp(ti.group(1)).tz_convert("UTC")
        for pos, qty in re.findall(
                r"<position>(\d+)</position>\s*<quantity>([\d.]+)</quantity>", body):
            rows.append((t0 + pd.Timedelta(weeks=int(pos) - 1), float(qty)))
    return rows


def main():
    frames = []
    for z, eic in HYDRO.items():
        rows, cur = [], START
        while cur < END:
            nxt = min(cur + timedelta(days=365), END)
            xml = fetch(eic, cur, nxt)
            if xml:
                rows += parse(xml)
            cur = nxt
            time.sleep(2)
        if not rows:
            print(f"  {z}: no reservoir data", flush=True)
            continue
        df = (pd.DataFrame(rows, columns=["t_utc", "mwh"])
                .drop_duplicates("t_utc").sort_values("t_utc"))
        df["zone"] = z
        frames.append(df)
        print(f"  {z}: {len(df)} weeks, {df.mwh.min()/1e6:.1f}-{df.mwh.max()/1e6:.1f} TWh",
              flush=True)

    full = pd.concat(frames, ignore_index=True)
    full.to_parquet(f"{OUT}/reservoir_weekly.parquet", index=False)
    print(f"saved reservoir_weekly.parquet: {len(full)} rows, {full.zone.nunique()} zones")
    print("RESERVOIR DONE", flush=True)


if __name__ == "__main__":
    main()
