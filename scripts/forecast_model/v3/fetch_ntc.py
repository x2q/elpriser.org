#!/usr/bin/env python3
"""Month-ahead forecast transfer capacity (ENTSO-E A61 / contract type A03).

This is the congestion feature v3 actually uses, and it replaces a first
attempt that misread the data. That attempt parsed A78 transmission
unavailability, whose Available_Period quantity turns out to be per ASSET,
not per border: a record reading 0 MW for "S Kristian PT4 Transformator"
means that one transformer is out, not that the Skagerrak link is dead.
Taking a min across overlapping records therefore produced an implausible
median availability of 0.00 on DK1-NO2, which is what gave the misparse away.

Month-ahead NTC is the right signal instead:
  - it is the capacity the market can actually use across the border,
    already aggregated over assets by the TSOs;
  - it is published a MONTH ahead, so it is unambiguously available at every
    horizon this model forecasts (h = 2..9). Week-ahead (A02) carries slightly
    fresher numbers but only covers 7 days, which would leak at h = 8, 9.

Daily resolution, curveType A03 (variable-sized blocks): a Point appears only
when the value changes, so values are forward-filled to the next change.
Both directions per border — export capacity out of DK and import capacity in
constrain prices differently.
"""
import os, re, time, urllib.request, urllib.parse
from datetime import date, timedelta

import pandas as pd

OUT = os.path.dirname(os.path.abspath(__file__))
TOKEN = os.environ.get("ENTSOE_TOKEN", "a3f638e6-3312-4ebb-96c3-2b588516e41e")

EIC = {
    "DK1": "10YDK-1--------W", "DK2": "10YDK-2--------M",
    "DELU": "10Y1001A1001A82H", "NO2": "10YNO-2--------T",
    "SE3": "10Y1001A1001A46L", "SE4": "10Y1001A1001A47J",
    "NL": "10YNL----------L",
}
BORDERS = [("dk1_delu", "DK1", "DELU"), ("dk1_no2", "DK1", "NO2"),
           ("dk1_se3", "DK1", "SE3"),   ("dk1_nl", "DK1", "NL"),
           ("dk2_delu", "DK2", "DELU"), ("dk2_se4", "DK2", "SE4")]
START, END = date(2024, 3, 1), date(2026, 8, 2)


def fetch(a, b, s, e):
    url = "https://web-api.tp.entsoe.eu/api?" + urllib.parse.urlencode({
        "securityToken": TOKEN, "documentType": "A61",
        "contract_MarketAgreement.Type": "A03",
        "in_Domain": EIC[a], "out_Domain": EIC[b],
        "periodStart": s.strftime("%Y%m%d0000"), "periodEnd": e.strftime("%Y%m%d0000"),
    })
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as ex:
            if ex.code == 400:
                return ""          # no data for this window
            if attempt == 3:
                raise
            time.sleep(15 * (attempt + 1))
        except Exception:
            if attempt == 3:
                raise
            time.sleep(15 * (attempt + 1))
    return ""


def parse(xml):
    """-> list of (date, mw). curveType A03: a point holds until the next one."""
    rows = []
    for per in re.finditer(r"<Period>(.*?)</Period>", xml, re.S):
        body = per.group(1)
        ti = re.search(r"<start>([^<]+)</start>\s*<end>([^<]+)</end>", body)
        if not ti:
            continue
        t0 = pd.Timestamp(ti.group(1)).tz_convert("UTC")
        t1 = pd.Timestamp(ti.group(2)).tz_convert("UTC")
        pts = sorted((int(p), float(q)) for p, q in
                     re.findall(r"<position>(\d+)</position>\s*<quantity>([\d.]+)</quantity>", body))
        for i, (pos, qty) in enumerate(pts):
            d0 = t0 + pd.Timedelta(days=pos - 1)
            d1 = (t0 + pd.Timedelta(days=pts[i + 1][0] - 1)) if i + 1 < len(pts) else t1
            for d in pd.date_range(d0, d1, freq="D", inclusive="left"):
                rows.append((d.date(), qty))
    return rows


def main():
    frames = []
    for name, a, b in BORDERS:
        for direction, (x, y) in (("export", (a, b)), ("import", (b, a))):
            rows, cur = [], START
            while cur < END:
                nxt = min(cur + timedelta(days=180), END)
                xml = fetch(x, y, cur, nxt)
                if xml:
                    rows += parse(xml)
                print(f"{name} {direction} {cur}..{nxt}: {len(rows)} cum", flush=True)
                cur = nxt
                time.sleep(2)
            if not rows:
                print(f"  {name} {direction}: no data", flush=True)
                continue
            df = (pd.DataFrame(rows, columns=["date", "mw"])
                    .drop_duplicates("date", keep="last").sort_values("date"))
            df["border"] = name
            df["direction"] = direction
            frames.append(df)
            print(f"  {name} {direction}: {len(df)} days, "
                  f"{df.mw.min():.0f}-{df.mw.max():.0f} MW", flush=True)

    full = pd.concat(frames, ignore_index=True)
    full.to_parquet(f"{OUT}/ntc_daily.parquet", index=False)
    print(f"\nsaved ntc_daily.parquet: {len(full)} rows")
    print(full.groupby(["border", "direction"]).mw.agg(["size", "min", "max", "nunique"]).to_string())
    print("NTC DONE", flush=True)


if __name__ == "__main__":
    main()
