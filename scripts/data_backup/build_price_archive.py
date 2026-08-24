#!/usr/bin/env python3
"""Publish Denmark's settled price history to Cloudflare KV, one key per year.

Why an archive at all, when the API can proxy Energi Data Service directly:

  1. EDS rate-limits per client, and answers a limit with HTTP 200 plus a
     statusCode in the body. Pulling three years day by day trips it, and the
     failure looks like an empty result unless you inspect the body.
  2. The history lives in two datasets — Elspotprices to 2025-09-30, then
     DayAheadPrices — so every range query crossing that date has to be split.
     Doing that once here beats doing it on every request.
  3. These prices were fixed at auction years ago. Re-fetching them is work
     that can only produce the same answer.

The value shape is exactly what the Worker holds internally, so it drops in
without conversion: {"YYYY-MM-DD": [24 prices in DKK/MWh]}, keyed on Danish
local date and hour, with null for an hour the market never priced.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

import pandas as pd

KV_NAMESPACE = "126700e66e8d4a19b289b0e8afdaff69"
BACKUP = os.path.expanduser("~/elpriser-data-backup")
# Four years covers the three the site offers with a year of headroom, and
# keeps the number of KV keys small enough to read in one request.
YEARS_BACK = 4


def kv_put(key, value, account, token):
    url = (f"https://api.cloudflare.com/client/v4/accounts/{account}"
           f"/storage/kv/namespaces/{KV_NAMESPACE}/values/{urllib.parse.quote(key)}")
    req = urllib.request.Request(url, data=json.dumps(value).encode(), method="PUT",
                                 headers={"Authorization": f"Bearer {token}",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        resp = json.loads(r.read())
    if not resp.get("success"):
        raise RuntimeError(f"KV put failed for {key}: {resp}")


def fetch_recent(area, start):
    """Days after the local mirror's last date, straight from Energi Data
    Service. Without this the archive would only ever be as fresh as whoever
    last refreshed the parquet files, and would quietly stop growing."""
    url = ("https://api.energidataservice.dk/dataset/DayAheadPrices"
           f"?start={start}&end=2100-01-01"
           f"&filter=%7B%22PriceArea%22%3A%22{area.upper()}%22%7D"
           "&sort=TimeDK%20asc&limit=0")
    try:
        with urllib.request.urlopen(url, timeout=180) as r:
            j = json.loads(r.read())
    except Exception as e:
        print(f"  {area}: EDS top-up failed ({e}) — archive ends at {start}", flush=True)
        return pd.DataFrame(columns=["t", "dkk"])
    # A rate limit arrives as HTTP 200 with a statusCode in the body.
    if j.get("statusCode", 200) >= 400:
        print(f"  {area}: EDS top-up refused ({j.get('message')}) — archive ends at {start}",
              flush=True)
        return pd.DataFrame(columns=["t", "dkk"])
    recs = j.get("records", [])
    if not recs:
        return pd.DataFrame(columns=["t", "dkk"])
    q = pd.DataFrame({"t": pd.to_datetime([r["TimeDK"] for r in recs]),
                      "dkk": [r["DayAheadPriceDKK"] for r in recs]})
    print(f"  {area}: {len(recs)} fresh records from EDS since {start}", flush=True)
    return q.assign(t=q.t.dt.floor("h")).groupby("t", as_index=False).dkk.mean()


def load_area(area):
    """Hourly DKK/MWh on Danish local time, across both Energinet datasets."""
    a = area.lower()
    e = pd.read_parquet(f"{BACKUP}/eds_elspotprices_{a}.parquet")
    e = pd.DataFrame({"t": pd.to_datetime(e.HourDK), "dkk": e.SpotPriceDKK})

    d = pd.read_parquet(f"{BACKUP}/eds_dayaheadprices_{a}.parquet")
    q = pd.DataFrame({"t": pd.to_datetime(d.TimeDK), "dkk": d.DayAheadPriceDKK})
    q = q.assign(t=q.t.dt.floor("h")).groupby("t", as_index=False).dkk.mean()

    # Top up with anything newer than the mirror holds.
    fresh = fetch_recent(area, (q.t.max() + pd.Timedelta(days=1)).strftime("%Y-%m-%d"))
    if len(fresh):
        q = pd.concat([q[~q.t.isin(set(fresh.t))], fresh]).sort_values("t")

    # DayAheadPrices wins on any overlap: it is the live dataset.
    both = pd.concat([e[~e.t.isin(set(q.t))], q]).sort_values("t")
    # The autumn fall-back repeats 02:00 in local time and the Worker's price
    # map is keyed on local date+hour, so the two are averaged — the same one
    # hour a year the rest of the pipeline loses. Noted, not hidden.
    return both.groupby("t", as_index=False).dkk.mean()


def main():
    path = os.path.expanduser("~/.config/elpriser.env")
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not (account and token):
        sys.exit("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required")

    this_year = pd.Timestamp.now().year
    years = range(this_year - YEARS_BACK + 1, this_year + 1)

    for area in ("DK1", "DK2"):
        df = load_area(area)
        for year in years:
            s = df[df.t.dt.year == year]
            if s.empty:
                print(f"{area} {year}: no data, skipped", flush=True)
                continue
            days = {}
            for d, g in s.groupby(s.t.dt.strftime("%Y-%m-%d")):
                hours = [None] * 24
                for t, v in zip(g.t, g.dkk):
                    hours[t.hour] = None if pd.isna(v) else round(float(v), 3)
                days[d] = hours
            key = f"prices-archive-{area}-{year}"
            kv_put(key, days, account, token)
            filled = sum(1 for h in days.values() for v in h if v is not None)
            print(f"{area} {year}: {len(days)} days, {filled:,} hours -> {key}", flush=True)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
