#!/usr/bin/env python3
"""Day-ahead prices for all 13 Nordic + NL bidding zones, from ENTSO-E.

DK1/DK2 are pulled from ENTSO-E here rather than reused from the Danish EDS
mirror on purpose: one source and one unit (EUR/MWh) across every zone means
the pooled model never has to reason about a currency boundary, and a zone's
price level enters as a feature rather than an artefact of where it came from.
"""
import os, re, time, urllib.request, urllib.parse
from datetime import date, timedelta

import pandas as pd

OUT = os.path.dirname(os.path.abspath(__file__))
TOKEN = os.environ.get("ENTSOE_TOKEN", "a3f638e6-3312-4ebb-96c3-2b588516e41e")

ZONES = {
    "dk1": "10YDK-1--------W", "dk2": "10YDK-2--------M",
    "no1": "10YNO-1--------2", "no2": "10YNO-2--------T", "no3": "10YNO-3--------J",
    "no4": "10YNO-4--------9", "no5": "10Y1001A1001A48H",
    "se1": "10Y1001A1001A44P", "se2": "10Y1001A1001A45N",
    "se3": "10Y1001A1001A46L", "se4": "10Y1001A1001A47J",
    "fi": "10YFI-1--------U", "nl": "10YNL----------L",
}
START, END = date(2024, 1, 1), date.today() + timedelta(days=2)


def fetch(eic, s, e):
    url = "https://web-api.tp.entsoe.eu/api?" + urllib.parse.urlencode({
        "securityToken": TOKEN, "documentType": "A44",
        "in_Domain": eic, "out_Domain": eic,
        "periodStart": s.strftime("%Y%m%d0000"), "periodEnd": e.strftime("%Y%m%d0000"),
    })
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as ex:
            if ex.code == 400:
                return ""
            if attempt == 3:
                raise
            time.sleep(15 * (attempt + 1))
        except Exception:
            if attempt == 3:
                raise
            time.sleep(15 * (attempt + 1))
    return ""


def parse(xml):
    """A44 periods carry PT60M or PT15M points; everything is averaged to hours.

    ENTSO-E sends these as curveType A03, variable-sized blocks: a point holds
    until the next published position, so a run of identical prices arrives as
    a SINGLE point. Expanding the blocks is not optional. Reading only the
    explicit positions silently deleted every hour whose price repeated the one
    before it — 2,506 hours across the 13 zones, and biased, because the loss
    scales with how flat a zone is: 2.8 % of NO4 against 0.34 % of DK1.
    """
    rows = []
    for per in re.finditer(r"<Period>(.*?)</Period>", xml, re.S):
        body = per.group(1)
        ti = re.search(r"<start>([^<]+)</start>\s*<end>([^<]+)</end>", body)
        rs = re.search(r"<resolution>([^<]+)</resolution>", body)
        if not ti or not rs:
            continue
        step = {"PT15M": 15, "PT30M": 30, "PT60M": 60, "PT1H": 60}.get(rs.group(1))
        if not step:
            continue
        t0 = pd.Timestamp(ti.group(1)).tz_convert("UTC")
        t1 = pd.Timestamp(ti.group(2)).tz_convert("UTC")
        # Positions are 1-based, so the slot after the last one is n_slots + 1.
        last = int((t1 - t0) / pd.Timedelta(minutes=step)) + 1
        pts = sorted((int(p), float(q)) for p, q in re.findall(
            r"<position>(\d+)</position>\s*<price\.amount>(-?[\d.]+)</price\.amount>", body))
        for i, (pos, price) in enumerate(pts):
            end = pts[i + 1][0] if i + 1 < len(pts) else last
            for slot in range(pos, end):
                rows.append((t0 + pd.Timedelta(minutes=step * (slot - 1)), price))
    return rows


def main():
    frames = []
    for name, eic in ZONES.items():
        cache = f"{OUT}/price_{name}.parquet"
        if os.path.exists(cache):
            print(f"{name}: cached", flush=True)
            frames.append(pd.read_parquet(cache))
            continue
        rows, cur = [], START
        while cur < END:
            nxt = min(cur + timedelta(days=90), END)
            xml = fetch(eic, cur, nxt)
            if xml:
                rows += parse(xml)
            print(f"  {name} {cur}..{nxt}: {len(rows)} cum", flush=True)
            cur = nxt
            time.sleep(2)
        if not rows:
            print(f"  {name}: NO DATA", flush=True)
            continue
        df = pd.DataFrame(rows, columns=["t_utc", "eur_mwh"])
        # Average sub-hourly points to whole hours, in local Danish time so the
        # calendar features line up with how the market is actually traded.
        df["t"] = (df.t_utc.dt.tz_convert("Europe/Copenhagen")
                     .dt.tz_localize(None).dt.floor("h"))
        df = df.groupby("t", as_index=False).eur_mwh.mean()
        df["zone"] = name
        df.to_parquet(cache, index=False)
        print(f"  {name}: {len(df):,} hours, {df.t.min():%Y-%m-%d} -> {df.t.max():%Y-%m-%d}, "
              f"{df.eur_mwh.min():.0f}..{df.eur_mwh.max():.0f} EUR/MWh", flush=True)
        frames.append(df)

    full = pd.concat(frames, ignore_index=True)
    full.to_parquet(f"{OUT}/prices_all.parquet", index=False)
    print(f"\nsaved prices_all.parquet: {len(full):,} rows")
    print(full.groupby("zone").agg(hours=("eur_mwh", "size"), mean=("eur_mwh", "mean"),
                                    lo=("eur_mwh", "min"), hi=("eur_mwh", "max")).round(1).to_string())
    print("PRICES DONE", flush=True)


if __name__ == "__main__":
    main()
