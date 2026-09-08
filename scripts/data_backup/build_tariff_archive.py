#!/usr/bin/env python3
"""Publish Danish household grid tariffs (Nettarif C) to Cloudflare KV.

Same reasoning as the price archive next to this file, for the same reason:
fetching this from Energi Data Service at request time is not dependable.
From some Cloudflare locations the DatahubPricelist query consistently hangs
— measured at over 8 seconds, every time, while the identical query answers in
0.1 s from others — so every request from those locations either times out or
pays the full timeout before falling back. Precomputing removes the dependency
from the request path entirely.

One key per network company, holding every period it has published with the
24-hour profile for each:

    dk-nettarif-<GLN> = {"periods": [
        {"from": "2025-01-01", "to": "2025-04-01", "kind": "hourly",
         "hourly": [24 rates in DKK/kWh excl. VAT]}, ...]}

Two shapes exist upstream and both are kept. Most companies publish an hourly
profile (PT1H) with low/high/peak bands that also differ between summer and
winter. Some publish a single flat daily rate (P1D) instead — N1's area 016
did so until 2026-07-01 — and treating those as "no tariff" leaves years of
history with the grid tariff silently missing.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

import eds_tls
from collections import defaultdict

KV_NAMESPACE = "126700e66e8d4a19b289b0e8afdaff69"
EDS = "https://api.energidataservice.dk/dataset/DatahubPricelist"
COLS = ("ChargeOwner,GLN_Number,ChargeTypeCode,ValidFrom,ValidTo,ResolutionDuration,"
        + ",".join(f"Price{i}" for i in range(1, 25)))


def fetch(params, attempts=5):
    url = EDS + "?" + urllib.parse.urlencode(params)
    for n in range(attempts):
        try:
            with eds_tls.urlopen(url, timeout=300) as r:
                j = json.loads(r.read())
        except Exception as e:
            if n == attempts - 1:
                raise
            time.sleep(20 * (n + 1))
            continue
        # A rate limit arrives as HTTP 200 with a statusCode in the body.
        if j.get("statusCode", 200) >= 400:
            if n == attempts - 1:
                raise RuntimeError(f"EDS refused: {j.get('message')}")
            time.sleep(30 * (n + 1))
            continue
        return j.get("records", [])
    return []


def kv_put(key, value, account, token):
    url = (f"https://api.cloudflare.com/client/v4/accounts/{account}"
           f"/storage/kv/namespaces/{KV_NAMESPACE}/values/{urllib.parse.quote(key)}")
    req = urllib.request.Request(url, data=json.dumps(value).encode(), method="PUT",
                                 headers={"Authorization": f"Bearer {token}",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        if not json.loads(r.read()).get("success"):
            raise RuntimeError(f"KV put failed for {key}")


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

    records = fetch({"filter": json.dumps({"ChargeType": "D03", "Note": "Nettarif C"}),
                     "sort": "ValidFrom desc", "limit": 0, "columns": COLS})
    print(f"{len(records)} Nettarif C records", flush=True)

    by_gln = defaultdict(list)
    owners = {}
    for r in records:
        res = r.get("ResolutionDuration")
        if res == "PT1H":
            hourly = [r.get(f"Price{i}") or 0 for i in range(1, 25)]
            kind = "hourly"
        elif res == "P1D":
            hourly = [r.get("Price1") or 0] * 24
            kind = "flat"
        else:
            continue
        gln = r.get("GLN_Number")
        if not gln:
            continue
        owners[gln] = r.get("ChargeOwner") or ""
        by_gln[gln].append({
            "from": r["ValidFrom"][:10],
            "to": r["ValidTo"][:10] if r.get("ValidTo") else None,
            "kind": kind,
            "hourly": [round(float(x), 6) for x in hourly],
        })

    index = []
    for gln, periods in sorted(by_gln.items()):
        # Newest first, hourly before flat when both cover a date, so the
        # Worker's first match is deterministic and prefers the finer profile.
        periods.sort(key=lambda p: (p["from"], 0 if p["kind"] == "hourly" else 1),
                     reverse=True)
        periods.sort(key=lambda p: p["from"], reverse=True)
        payload = {"gln": gln, "owner": owners[gln], "periods": periods}
        kv_put(f"dk-nettarif-{gln}", payload, account, token)
        span = f"{periods[-1]['from']}..{periods[0]['from']}"
        index.append({"gln": gln, "owner": owners[gln], "periods": len(periods)})
        print(f"  {gln} {owners[gln][:34]:36} {len(periods):4} perioder  {span}", flush=True)

    kv_put("dk-nettarif-index", {"companies": index}, account, token)
    print(f"DONE — {len(index)} selskaber", flush=True)


if __name__ == "__main__":
    main()
