#!/usr/bin/env python3
"""Pure parsing for the Great Britain price job: an Elexon BMRS Market Index Data (MID) response in, the same hourly
local-time days that /api/nordic serves out for the other zones. No network, no files, stdlib only.

WHAT THIS PRICE IS. NOT the day-ahead auction. Great Britain has no free day-ahead price feed; the free one is the
Market Index Data of the Balancing Mechanism Reporting Service: the volume-weighted price of the WITHIN-DAY wholesale
trades of each half hour, reported by the two market index data providers (APXMIDP = EPEX SPOT UK and N2EXMIDP = N2EX).
It is the number Elexon itself calls the Market Index Price. The site labels it exactly so ("Market Index Price
(within-day)") and says it is not the day-ahead auction price; there is no tomorrow, because a half hour's index only
exists once that half hour is traded.

The source. GET https://data.elexon.co.uk/bmrs/api/v1/balancing/pricing/market-index?from=<RFC3339>&to=<RFC3339>&format=json
(no API key; the BMRS developer portal says "All our APIs are public and no API key is required") returns
    {"metadata": {"datasets": ["MID"]}, "data": [
       {"startTime": "2026-11-02T20:30:00Z", "dataProvider": "APXMIDP", "settlementDate": "2026-11-02",
        "settlementPeriod": 42, "price": 218.60, "volume": 3656.250}, ...]}
Each half hour has one row per provider. What the job relies on (each from a real response, see fixtures/elexon_mid_*):
* `startTime` is the START of the half hour in UTC. The settlement day is the London day; 46 periods the day the clocks go
  forward, 50 the day they go back, so the UTC startTime (never settlementPeriod) is what is read.
* A provider that traded nothing in a half hour reports price 0.00 AND volume 0.000 (N2EX does so most of the time). That is
  "no trade", not a price of zero: the half hour's price is the VOLUME-WEIGHTED mean over the providers with volume, which is
  how Elexon derives the Market Price. A half hour whose volume is 0 for every provider has no price.
* The price is GBP per MWh. Negative prices are real and are kept.
* The newest half hour appears at about its own start; the page sees an hour once both its half hours are in.

Licence. BMRS data are licensed by Elexon Limited to anyone who is not a BSC Party for any use, commercial included, with the
attribution "Contains BMRS data (c) Elexon Limited copyright and database right [year]." (the (c) is the copyright sign) and a link
to https://www.elexon.co.uk/bsc/data/balancing-mechanism-reporting-agent/copyright-licence-bmrs-data/ . This module changes
the data (hourly means of half-hourly index prices), which the site says wherever it shows them.

Local days. By the London wall clock (Europe/London), hour 0..23, like every other zone. An hour's price is the mean of its
half hours and the hour counts ONLY WHEN COMPLETE: every half hour that belongs to that local hour on that day (2; 4 for the
hour that happens twice when the clocks go back, 0 for the hour that does not exist when they go forward) has a price.
A day is kept from its first complete hour (MIN_HOURS = 1 here: a day-ahead day is published whole, today's index builds up
hour by hour, so energy_charts_parse's 12 would hide today until noon), and today is always present once yesterday is.
"""
import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import energy_charts_parse as P

UTC = timezone.utc
HALF = 30          # minutes: the settlement period
UNIT = "GBP/MWh"


def _when(s):
    """'2026-11-02T20:30:00Z' -> aware UTC datetime."""
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    d = datetime.fromisoformat(s)
    if d.tzinfo is None:
        d = d.replace(tzinfo=UTC)
    return d.astimezone(UTC)


def parse_mid(body):
    """[(start_utc, 30, GBP/MWh)] for every half hour with a price, sorted by start.

    `body` is the response text (or the parsed dict). The price of a half hour is the volume-weighted mean of the providers'
    prices over the providers with volume above zero; a half hour with no volume has none and is left out. An empty `data`
    parses to []. Raises ValueError for anything that is not a MID document."""
    if isinstance(body, (str, bytes)):
        try:
            body = json.loads(body)
        except ValueError as e:
            raise ValueError(f"not JSON: {e}")
    if not isinstance(body, dict) or not isinstance(body.get("data"), list):
        raise ValueError("not a BMRS Market Index Data document")
    acc = {}
    for row in body["data"]:
        try:
            start = _when(row["startTime"])
            price, vol = row["price"], row["volume"]
        except (KeyError, TypeError, ValueError, AttributeError) as e:
            raise ValueError(f"unexpected MID row {row!r}: {e}")
        if price is None or vol is None:
            continue
        price, vol = float(price), float(vol)
        if vol <= 0:
            continue                      # "no trade": price 0.00 with volume 0.000, not a price
        a = acc.setdefault(start, [0.0, 0.0])
        a[0] += price * vol
        a[1] += vol
    return [(t, HALF, v[0] / v[1]) for t, v in sorted(acc.items())]


def _expected_cells(date_iso, tzname):
    """{local hour: number of half hours that belong to it} for the local day `date_iso` (48 on a normal day)."""
    tz = ZoneInfo(tzname)
    d = datetime.fromisoformat(date_iso)
    start = datetime(d.year, d.month, d.day, tzinfo=tz).astimezone(UTC)
    end = datetime(d.year, d.month, d.day, tzinfo=tz) + timedelta(days=1)
    end = datetime(end.year, end.month, end.day, tzinfo=tz).astimezone(UTC)
    out, t = {}, start
    while t < end:
        h = t.astimezone(tz).hour
        out[h] = out.get(h, 0) + 1
        t += timedelta(minutes=HALF)
    return out


def complete_slots(slots, tzname, dates):
    """The slots of `dates` (local ISO dates) that belong to a COMPLETE local hour; the rest is dropped."""
    tz = ZoneInfo(tzname)
    want = {d: _expected_cells(d, tzname) for d in dates}
    have = {}
    for start, _, _ in slots:
        loc = start.astimezone(tz)
        have[(loc.date().isoformat(), loc.hour)] = have.get((loc.date().isoformat(), loc.hour), 0) + 1
    keep = []
    for s in slots:
        loc = s[0].astimezone(tz)
        d, h = loc.date().isoformat(), loc.hour
        if d in want and want[d].get(h) and have.get((d, h)) == want[d][h]:
            keep.append(s)
    return keep


MIN_HOURS = 1      # unlike a day-ahead day (energy_charts_parse.MIN_HOURS = 12 of 24 published at once), today is built up hour by hour


def build_days(slots, tzname, dates, min_hours=MIN_HOURS):
    """The feed's days[] for the local `dates`: [{date, type:'actual', prices:[{hour, eur_mwh}] * 24}], an hour without a
    complete set of half hours null. A day counts from its FIRST complete hour (a day-ahead day needs P.MIN_HOURS): the index of
    today appears hour by hour. The LAST date (today) is always there once any earlier day is, with every hour null in the
    first hour after midnight, so the page shows an empty day rather than "could not be loaded". The field keeps its name
    `eur_mwh` for every zone (the apps read that name); the payload's `unit` says GBP/MWh, and /api/nordic's zoneInfo.currency
    says GBP with rate 1."""
    days = P.build_days(complete_slots(slots, tzname, dates), tzname, dates, min_hours)
    last = sorted(dates)[-1]
    if days and days[-1]["date"] != last:
        days.append({"date": last, "type": "actual", "prices": [{"hour": h, "eur_mwh": None} for h in range(24)]})
    return days


def build_payload(zone, body, tzname, dates, generated):
    """The KV value for one zone, shaped like the other EU zones' (every day 'actual', no model) but in GBP/MWh."""
    days = build_days(parse_mid(body), tzname, dates)
    return {"zone": zone, "generated": generated, "trainedThrough": None, "unit": UNIT, "days": days}
