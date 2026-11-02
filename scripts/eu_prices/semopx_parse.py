#!/usr/bin/env python3
"""Pure parsing for the Ireland price job: SEMOpx day-ahead market results in, the same hourly local-time days that /api/nordic
serves out for the other zones. No network, no files, stdlib only.

The source. SEMOpx (the exchange of the all-island Single Electricity Market, Republic of Ireland AND Northern Ireland) publishes
the results of its day-ahead auction (DAM) on https://www.semopx.com/market-data/market-results; the page draws its chart from a
public JSON API, no key and no login, which the job reads:
  1. GET https://reports.semopx.com/api/v1/documents/static-reports?DPuG_ID=EA-001&ExcludeDelayedPublication=0&order_by=DESC
         &sort_by=Date&page_size=N&ResourceName=MarketResult_SEM-DA_PWR-MRC-D
     lists the DAM result files, newest first:  {"pagination": {...}, "items": [{"_id": "6ae8...", "ResourceName":
     "MarketResult_SEM-DA_PWR-MRC-D+1_20261102110000_20261102115501.csv", "Date": "2026-11-03T11:00:00" (the DELIVERY day),
     "DateRetention": "2026-11-02" (the auction day), "PublishTime": "2026-11-02T11:55:01"}, ...]}.
     ExcludeDelayedPublication=0 is what the site's own page sends: without it only files whose publication is delayed to
     the day after delivery are listed, which would give no tomorrow.
  2. GET https://reports.semopx.com/api/v1/documents/<_id>   returns the file as JSON, see fixtures/semopx_dam_20261102.json:
     {"AreaSet": [["Auction","SEM-DA"], ...], "FXRates": [["FX rates"], ["EUR","GBP",0.8356]], "rows": [
        [["Market","NI-DA"], ["Index prices",30,"EUR"], [<48 UTC timestamps "2026-11-02T23:00:00Z">], [<48 prices>],
         ["Index prices",30,"GBP"], [...], [...], ["Index volumes",30], ...],
        [["Market","ROI-DA"], ...]]}
What the job relies on:
* One auction, one delivery day, 48 half hours (the SEM market time unit is 30 minutes), timestamps are the START of the half hour
  in UTC. The delivery day follows the Central European day (23:00Z to 23:00Z in winter, 22:00Z to 22:00Z in summer), which is
  the Dublin wall clock's 23:00 of the evening before, so a Dublin day needs two files for its last hour; that hour is simply empty
  until the next auction's file is out (the pages draw an hour without a price as an empty bar).
* The price is EUR per MWh (the "Index prices" block with unit EUR; a GBP block sits next to it and is not used). ROI-DA and NI-DA are
  the two jurisdictions of one all-island market and carry the same price; ROI-DA is read, NI-DA only when ROI-DA is absent.
* A document that is not a DAM result, or whose price block is not EUR, is an error, never a guess.

Licence. SEMOpx publishes this data for the general public (its Data Publication Guide lists the report with audience "General
Public") but states no licence for reuse on its site, whose only legal text is a disclaimer. The site credits "SEMOpx" and says the
hourly means are its own change, like for every other zone.

Local days. By the zone's wall clock (Europe/Dublin), via energy_charts_parse (the same cells, the same DST rules, the same
MIN_HOURS). Half-hour slots are cut into 15-minute cells like the 30-minute ENTSO-E periods, so an hour is the mean of its two.
"""
import json
from datetime import datetime, timezone

import energy_charts_parse as P

UTC = timezone.utc
UNIT = "EUR/MWh"
LIST_NAME = "MarketResult_SEM-DA_PWR-MRC-D"


def _when(s):
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    d = datetime.fromisoformat(s)
    return (d if d.tzinfo else d.replace(tzinfo=UTC)).astimezone(UTC)


def parse_listing(body):
    """The `items` of a static-reports listing as a list of dicts. Raises ValueError for anything else."""
    if isinstance(body, (str, bytes)):
        try:
            body = json.loads(body)
        except ValueError as e:
            raise ValueError(f"not JSON: {e}")
    if not isinstance(body, dict) or not isinstance(body.get("items"), list):
        raise ValueError("not a SEMOpx report listing")
    return body["items"]


def select_documents(items, first_delivery_date):
    """The ids to fetch: DAM result files whose DELIVERY day (`Date`) is `first_delivery_date` (ISO) or later, ONE per delivery
    day (when a day has been published twice, the latest PublishTime), oldest first. -> [(delivery_date, _id)]"""
    best = {}
    for it in items:
        name = str(it.get("ResourceName", ""))
        if not name.startswith(LIST_NAME) or it.get("DPuG_ID") not in (None, "EA-001") or not it.get("_id"):
            continue
        delivery = str(it.get("Date", ""))[:10]
        if len(delivery) != 10 or delivery < first_delivery_date:
            continue
        pub = str(it.get("PublishTime", ""))
        if delivery not in best or pub > best[delivery][0]:
            best[delivery] = (pub, it["_id"])
    return [(d, best[d][1]) for d in sorted(best)]


def parse_dam(doc):
    """[(start_utc, 30, EUR/MWh)] of one DAM result document, sorted by start. Raises ValueError for anything else."""
    if isinstance(doc, (str, bytes)):
        try:
            doc = json.loads(doc)
        except ValueError as e:
            raise ValueError(f"not JSON: {e}")
    if not isinstance(doc, dict) or not isinstance(doc.get("rows"), list):
        raise ValueError("not a SEMOpx market result document")
    auction = dict((a[0], a[1]) for a in doc.get("AreaSet", []) if isinstance(a, list) and len(a) >= 2)
    if auction.get("Auction") != "SEM-DA":
        raise ValueError(f"not a day-ahead result (auction {auction.get('Auction')!r})")
    blocks = {}
    for row in doc["rows"]:
        if not (isinstance(row, list) and row and isinstance(row[0], list) and row[0][:1] == ["Market"]):
            continue
        for i, el in enumerate(row):
            if isinstance(el, list) and el[:1] == ["Index prices"]:
                if len(el) < 3 or el[2] != "EUR":
                    continue            # the GBP block next to it
                if i + 2 >= len(row) or not isinstance(row[i + 1], list) or not isinstance(row[i + 2], list):
                    raise ValueError("price block without its time and price arrays")
                blocks[row[0][1]] = (int(el[1]), row[i + 1], row[i + 2])
    block = blocks.get("ROI-DA") or blocks.get("NI-DA")
    if block is None:
        raise ValueError("no EUR index price block for ROI-DA or NI-DA")
    minutes, times, prices = block
    if minutes <= 0 or minutes % P.CELL:
        raise ValueError(f"odd step of {minutes} minutes")
    if len(times) != len(prices):
        raise ValueError(f"{len(times)} times but {len(prices)} prices")
    out = [(_when(t), minutes, float(p)) for t, p in zip(times, prices) if p is not None]
    return sorted(out)


def build_payload(zone, docs, tzname, dates, generated):
    """The KV value: `docs` is the list of fetched document texts or dicts. Where two documents carry the same half hour, the later
    document in the list wins. Every day 'actual', no model."""
    slots = {}
    for d in docs:
        for start, minutes, price in parse_dam(d):
            slots[start] = (start, minutes, price)
    days = P.build_days(sorted(slots.values()), tzname, dates)
    return {"zone": zone, "generated": generated, "trainedThrough": None, "unit": UNIT, "days": days}
