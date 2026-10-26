#!/usr/bin/env python3
"""Pure parsing for the EU price job: an Energy-Charts /price response in, the hourly local-time days that
/api/nordic serves out. No network, no files, stdlib only.

The source. https://api.energy-charts.info/price?bzn=<zone>&start=<date>&end=<date> (Fraunhofer ISE) returns the
day-ahead price of a bidding zone as JSON:
    {"license_info": "CC BY 4.0 (creativecommons.org/licenses/by/4.0) from Bundesnetzagentur | SMARD.de",
     "unix_seconds": [1792879200, ...], "price": [9.67, ...], "unit": "EUR / MWh", "deprecated": false}
* Every timestamp is the START of the period its price covers (the API's own rule), in unix seconds.
* The step is 900 s (15 minutes) from the 15-minute market time unit of October 2025, 3600 s before; the step of a
  value is the distance to the next timestamp, so a series that changes resolution is read correctly.
* A price can be null: that slot has no price and is skipped (an hour made only of null slots has none).
* A day that is not published yet is simply not in the arrays (tomorrow before the auction results, about 13:00 CET);
  the API answers 404 when there is nothing at all in the range.
* The data of DE-LU, FR, PL and IT-North is licensed CC BY 4.0, attributed to "Bundesnetzagentur | SMARD.de"; this
  module changes it (hourly means of the 15-minute prices), which the site says wherever it shows them.

Local days. The site shows a zone's prices by the zone's own wall clock (Europe/Berlin, Paris, Warsaw, Rome), hour
0..23, like the Nordic feed. Every slot is cut into 15-minute cells and each cell is put in the local (date, hour) it
starts in; an hour's price is the mean of its cells. On the day the clocks go back, local hour 2 happens twice and its
price is the mean of both (as the Nordic dataset does); on the day they go forward, hour 2 does not exist and its price
is null. A day is kept when at least MIN_HOURS of its hours have a price.
"""
import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

CELL = 15                  # minutes; every step the API uses is a multiple of this
MIN_HOURS = 12             # a local day needs at least this many priced hours to count as published
UTC = timezone.utc


def parse_price(body):
    """[(start_utc, minutes, price EUR/MWh)] for every priced slot, sorted by start.

    `body` is the response text (or the parsed dict). A response with no series (HTTP 404 in practice, or null
    arrays) parses to []. Raises ValueError for something that is not a price document."""
    if isinstance(body, (str, bytes)):
        try:
            body = json.loads(body)
        except ValueError as e:
            raise ValueError(f"not JSON: {e}")
    if not isinstance(body, dict) or "unix_seconds" not in body or "price" not in body:
        raise ValueError("not an Energy-Charts price document")
    u, p = body["unix_seconds"], body["price"]
    if not u or not p:
        return []
    if len(u) != len(p):
        raise ValueError(f"unix_seconds ({len(u)}) and price ({len(p)}) differ in length")
    unit = str(body.get("unit", "EUR / MWh")).replace(" ", "").upper()
    if unit != "EUR/MWH":
        raise ValueError(f"unexpected unit {body.get('unit')!r}")
    steps = [b - a for a, b in zip(u, u[1:])]
    default = min([s for s in steps if s > 0] or [3600])
    out = []
    for i, (t, price) in enumerate(zip(u, p)):
        if price is None:
            continue
        step = steps[i] if i < len(steps) else (steps[-1] if steps else default)
        if step <= 0 or step % (CELL * 60):
            raise ValueError(f"odd step of {step} s at {t}")
        out.append((datetime.fromtimestamp(t, UTC), step // 60, float(price)))
    return sorted(out)


def license_info(body):
    """The licence line the API sends with the data, or ''."""
    if isinstance(body, (str, bytes)):
        try:
            body = json.loads(body)
        except ValueError:
            return ""
    return str(body.get("license_info", "")) if isinstance(body, dict) else ""


def hourly_days(slots, tzname):
    """{'YYYY-MM-DD': {hour: mean price}} by the wall clock of `tzname`."""
    tz = ZoneInfo(tzname)
    acc = {}
    for start, minutes, price in slots:
        for i in range(minutes // CELL):
            loc = (start + timedelta(minutes=CELL * i)).astimezone(tz)
            acc.setdefault(loc.date().isoformat(), {}).setdefault(loc.hour, []).append(price)
    return {d: {h: sum(v) / len(v) for h, v in hours.items()} for d, hours in acc.items()}


def build_days(slots, tzname, dates, min_hours=MIN_HOURS):
    """The feed's days[] for the local `dates` (ISO strings) that have enough prices, in date order:
    [{date, type:'actual', prices:[{hour, eur_mwh}] * 24}], eur_mwh null for an hour without a price."""
    hd = hourly_days(slots, tzname)
    out = []
    for d in sorted(dates):
        hours = hd.get(d, {})
        if len(hours) < min_hours:
            continue
        out.append({"date": d, "type": "actual",
                    "prices": [{"hour": h, "eur_mwh": (round(hours[h], 2) if h in hours else None)}
                               for h in range(24)]})
    return out


def local_dates(now_utc, tzname):
    """[yesterday, today, tomorrow] as ISO dates of the zone's own calendar."""
    today = now_utc.astimezone(ZoneInfo(tzname)).date()
    return [(today + timedelta(days=i)).isoformat() for i in (-1, 0, 1)]


def build_payload(zone, body, tzname, dates, generated):
    """The KV value for one zone, shaped like nordic-forecast-<zone> (and so like /api/nordic, which adds
    zoneInfo when it serves it): every day is 'actual', there is no model, so trainedThrough is null.
    `generated` is a date, not a timestamp, so a rerun with unchanged data is byte-identical."""
    days = build_days(parse_price(body), tzname, dates)
    return {"zone": zone, "generated": generated, "trainedThrough": None,
            "unit": "EUR/MWh", "days": days}


def canonical(value):
    """The one serialisation that is written to KV and compared against what is stored."""
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def body_hash(value):
    """FNV-1a of the canonical body, like bodyHash() in functions/api/[[catchall]].js (the same idea: an
    unchanged body must not consume one of the free plan's 1,000 KV writes a day)."""
    s = canonical(value).encode("utf-8")
    h = 0x811c9dc5
    for b in s:
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return f"{h:x}:{len(s)}"
