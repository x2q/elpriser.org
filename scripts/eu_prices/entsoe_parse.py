#!/usr/bin/env python3
"""Pure parsing for the ENTSO-E day-ahead price job: a Transparency Platform A44 response (XML) in, the same hourly
local-time days that /api/nordic serves out as for the Energy-Charts zones. No network, no files, stdlib only.

The source. GET https://web-api.tp.entsoe.eu/api?documentType=A44&in_Domain=<EIC>&out_Domain=<EIC>&periodStart=..&periodEnd=..
returns a Publication_MarketDocument with one TimeSeries per contract and per delivery day. What the job relies on
(each from a real response, see fixtures/entsoe_a44_*.xml):
* `contract_MarketAgreement.type` A01 is the day-ahead auction. A07 is an INTRADAY auction (Spain returns both in one
  document) and must never be read as a day-ahead price: only A01 counts.
* `curveType` A03 is a variable-sized block: a Point only appears where the price CHANGES, and a position with no
  Point repeats the price before it (Hungary's day has 95 Points for 96 quarter hours). Every Period is expanded.
* `resolution` is PT15M (most zones, since the 15-minute market time unit of October 2025), PT30M or PT60M.
* `currency_Unit.name` is EUR and `price_Measure_Unit.name` MWH for every zone, whatever the national currency, so the
  same unit as the Energy-Charts zones: EUR/MWh.
* A period that is not published yet is simply absent (tomorrow before the auction results, about 13:00 CET). A request
  with nothing in the range is answered HTTP 200 with an Acknowledgement_MarketDocument (reason code 999), not an error.
* Two TimeSeries can cover the same start; the one listed last wins.

The re-use terms of the A44 prices on the Transparency Platform were not settled when this was written (ENTSO-E
publishes a list of data open for free re-use, under CC BY 4.0 since 2022); the site attributes them to "ENTSO-E
Transparency Platform" and says that the hourly means are its own change, like the Energy-Charts zones.

The hourly local days are built by energy_charts_parse (the same 15-minute cells, the same DST rules, the same
MIN_HOURS), so the two sources produce the very same payload shape.
"""
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import energy_charts_parse as P

UTC = timezone.utc
_RES = {"PT15M": 15, "PT30M": 30, "PT60M": 60}


def _strip(tag):
    return tag.split("}", 1)[1] if "}" in tag else tag


def _text(el, name):
    """The text of the first child of `el` called `name`, namespace ignored, or None."""
    for c in el:
        if _strip(c.tag) == name:
            return (c.text or "").strip()
    return None


def _children(el, name):
    return [c for c in el if _strip(c.tag) == name]


def _when(s):
    """'2026-11-01T23:00Z' -> aware UTC datetime."""
    return datetime.strptime(s, "%Y-%m-%dT%H:%MZ").replace(tzinfo=UTC)


def parse_a44(xml):
    """[(start_utc, minutes, EUR/MWh)] of the DAY-AHEAD prices in the document, sorted by start.

    No data (an Acknowledgement_MarketDocument with reason 999) parses to []. Raises ValueError for anything else
    that is not a price document, a currency other than EUR or a unit other than MWH."""
    if isinstance(xml, bytes):
        xml = xml.decode("utf-8", "replace")
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as e:
        raise ValueError(f"not XML: {e}")
    kind = _strip(root.tag)
    if kind == "Acknowledgement_MarketDocument":
        reasons = [_text(r, "code") for r in _children(root, "Reason")]
        if "999" in reasons:
            return []
        raise ValueError("ENTSO-E answered with an acknowledgement: " + "; ".join(filter(None, (_text(r, "text") for r in _children(root, "Reason")))))
    if kind != "Publication_MarketDocument":
        raise ValueError(f"not a price document ({kind})")
    out = {}
    for ts in _children(root, "TimeSeries"):
        if _text(ts, "contract_MarketAgreement.type") != "A01":
            continue            # intraday (A07) and anything else is not a day-ahead price
        if _text(ts, "currency_Unit.name") != "EUR" or _text(ts, "price_Measure_Unit.name") != "MWH":
            raise ValueError(f"unexpected unit {_text(ts, 'currency_Unit.name')}/{_text(ts, 'price_Measure_Unit.name')}")
        for per in _children(ts, "Period"):
            res = _text(per, "resolution")
            if res not in _RES:
                raise ValueError(f"unexpected resolution {res!r}")
            step = _RES[res]
            ti = _children(per, "timeInterval")[0]
            start, end = _when(_text(ti, "start")), _when(_text(ti, "end"))
            n = int((end - start).total_seconds() // 60 // step)
            given = {}
            for pt in _children(per, "Point"):
                given[int(_text(pt, "position"))] = float(_text(pt, "price.amount"))
            last = None
            for pos in range(1, n + 1):
                if pos in given:
                    last = given[pos]
                if last is None:
                    continue    # no price yet at the start of the period
                out[start + timedelta(minutes=step * (pos - 1))] = (step, last)
    return [(t, m, p) for t, (m, p) in sorted(out.items())]


def build_payload(zone, xml, tzname, dates, generated):
    """The KV value for one zone, shaped like the Energy-Charts zones' (and so like nordic-forecast-<zone>): every day
    is 'actual', there is no model, so trainedThrough is null."""
    days = P.build_days(parse_a44(xml), tzname, dates)
    return {"zone": zone, "generated": generated, "trainedThrough": None, "unit": "EUR/MWh", "days": days}
