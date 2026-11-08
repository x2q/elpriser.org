#!/usr/bin/env python3
"""The source-priority layer for the EU price zones: pure logic, no network, no files, stdlib only.

A zone has an ORDERED list of sources (CHAINS). Every source is read into the same thing, a list of price slots
[(start_utc, minutes, EUR/MWh)], and `combine` takes, PER DELIVERY DAY, the first source in the zone's order that has a
COMPLETE day. So yesterday may come from ENTSO-E and tomorrow from Energy-Charts (when ENTSO-E has not published it, or is
down), and a zone's price never vanishes because one source lags or fails. The payload is the very shape the Worker reads
(scripts/eu_prices/energy_charts_parse.build_payload), with one added field on each day, `source`, naming the source the
day came from.

Complete day. A local day (the zone's own calendar day) is complete when EVERY 15-minute cell of it that the market has
published by now has a price from that source: 24 hours of the day's four quarter hours each (23 hours on the day the
clocks go forward, 25 on the day they go back, where the doubled hour is the mean of both, as everywhere else). "Published
by now" is the end of tomorrow's market day on the CET/CEST clock (the day-ahead market is a CET market everywhere): a
cell later than that cannot exist yet, so Portugal's tomorrow (Lisbon is an hour behind CET) is complete with 23 hours,
its last hour belonging to the day after tomorrow's market day. A day with any other missing or null cell is NOT complete:
it is never published from that source, and the next source is tried.

Disagreements. Where two sources both have a cell, a difference of more than DIFF_EUR_MWH (0.01 EUR/MWh) is reported; the
report never changes what is published (the first complete source wins) and never fails the run.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import energy_charts_parse as P

UTC = timezone.utc
CELL = P.CELL                       # 15 minutes
MARKET_TZ = "Europe/Brussels"       # the clock the day-ahead market (SDAC) and OMIE use
DIFF_EUR_MWH = 0.01

ENTSOE, EC, OMIE = "entsoe", "energy-charts", "omie"

# zone -> sources in priority order. Pinned by test-eu-prices.mjs against the Worker's zone lists and credit lines.
#  * Energy-Charts' own zones: ENTSO-E first. Energy-Charts takes its day-ahead prices from the same auction results and was the
#    slower one (on weekends it delivered the next day hours after ENTSO-E had it), so it is the fallback and the cross-check.
#    Switzerland is the exception: its auction clears at ~11:00 CET, before the coupled one, and Energy-Charts has carried it by
#    11:30 UTC every day since 2026-11-03 (eu_prices.log); no log shows ENTSO-E earlier, so Energy-Charts stays first there.
#  * Spain, Portugal: ENTSO-E first, OMIE (the market operator itself) as the fallback and the cross-check.
#  * Every other zone has ENTSO-E only: Energy-Charts licenses no other zone to us, OMIE covers only ES and PT, and Nord Pool's
#    public data portal may not be redistributed without a paid licence (docs/price-sources.md), so it is not a source.
CHAINS = {
    "de": [ENTSOE, EC], "at": [ENTSOE, EC], "fr": [ENTSOE, EC], "be": [ENTSOE, EC], "pl": [ENTSOE, EC], "cz": [ENTSOE, EC],
    "hu": [ENTSOE, EC], "si": [ENTSOE, EC], "it-n": [ENTSOE, EC],
    "ch": [EC, ENTSOE],
    "es": [ENTSOE, OMIE], "pt": [ENTSOE, OMIE],
    "sk": [ENTSOE], "gr": [ENTSOE], "ro": [ENTSOE], "bg": [ENTSOE], "hr": [ENTSOE], "rs": [ENTSOE], "ee": [ENTSOE],
    "lv": [ENTSOE], "lt": [ENTSOE], "me": [ENTSOE], "mk": [ENTSOE], "al": [ENTSOE], "xk": [ENTSOE],
}

# A source that is rate limited is not asked for a day that only "tomorrow" is missing from before this wall-clock time (MARKET_TZ):
# the auction results are not out before ~12:45 CET, and an earlier ask is a request that cannot succeed. None: always asked.
FALLBACK_AFTER = {EC: "13:45", ENTSOE: None, OMIE: None}


def _tz(name):
    return ZoneInfo(name)


def local_midnight(date, tzname):
    return datetime.fromisoformat(date).replace(tzinfo=_tz(tzname)).astimezone(UTC)


def horizon_end(now):
    """The instant after the last cell the day-ahead market can have published at `now`: the end of tomorrow's market day."""
    today = now.astimezone(_tz(MARKET_TZ)).date()
    return local_midnight((today + timedelta(days=2)).isoformat(), MARKET_TZ)


def expected_cells(date, tzname, horizon):
    """The start (UTC) of every 15-minute cell of local day `date` that is earlier than `horizon`."""
    a, b = local_midnight(date, tzname), local_midnight((datetime.fromisoformat(date) + timedelta(days=1)).date().isoformat(), tzname)
    out, t = [], a
    while t < min(b, horizon):
        out.append(t)
        t += timedelta(minutes=CELL)
    return out


def cells(slots):
    """{start_utc: price} for every 15-minute cell the slots cover (a 60-minute slot is four cells of its price)."""
    out = {}
    for start, minutes, price in slots:
        for i in range(minutes // CELL):
            out[start + timedelta(minutes=CELL * i)] = price
    return out


def day_complete(cellmap, date, tzname, horizon):
    """True when every expected cell of the local day has a price and at least P.MIN_HOURS hours are covered."""
    exp = expected_cells(date, tzname, horizon)
    return len(exp) >= P.MIN_HOURS * 4 and all(c in cellmap for c in exp)


def market_dates(dates, tzname, horizon):
    """The market-day (MARKET_TZ calendar) dates the expected cells of local `dates` fall on: the files an
    OMIE-style per-market-day source has to be asked for."""
    mt = _tz(MARKET_TZ)
    return sorted({c.astimezone(mt).date().isoformat() for d in dates for c in expected_cells(d, tzname, horizon)})


def gate_open(source, now, missing, dates):
    """May `source` be asked now for the `missing` local dates? False only when the source has a FALLBACK_AFTER time, it is earlier
    than that on the market clock, and the only thing missing is the last date of `dates` (tomorrow)."""
    after = FALLBACK_AFTER.get(source)
    if not after or not missing:
        return True
    if set(missing) != {dates[-1]}:
        return True
    hh, mm = (int(x) for x in after.split(":"))
    local = now.astimezone(_tz(MARKET_TZ))
    return (local.hour, local.minute) >= (hh, mm)


def disagreements(a_cells, b_cells, dates, tzname, a_name, b_name, tol=DIFF_EUR_MWH):
    """[(date, hour, max |difference| EUR/MWh, a_name, b_name)] for every local hour of `dates` in which a cell both sources have
    differs by more than `tol`. Informational only."""
    tz = _tz(tzname)
    worst = {}
    for t, pa in a_cells.items():
        pb = b_cells.get(t)
        if pb is None:
            continue
        diff = abs(pa - pb)
        if diff > tol + 1e-9:
            loc = t.astimezone(tz)
            d = loc.date().isoformat()
            if d in dates:
                k = (d, loc.hour)
                worst[k] = max(worst.get(k, 0.0), diff)
    return [(d, h, round(v, 2), a_name, b_name) for (d, h), v in sorted(worst.items())]


def combine(zone, tzname, dates, results, now, stored=None, allow_partial=False):
    """Merge the sources' slots into the zone's payload.

    `results`: [(source, slots)] in the zone's priority order; `slots` is a list of (start_utc, minutes, price), or None when the
    source was not asked or failed (it contributes nothing). `stored`: the zone's previously published payload or None; a day of it
    that is still complete fills a date no source delivers now (a source outage must never delete a day the site already has).
    `allow_partial` (off): when no source has a date complete and nothing complete is stored, publish the first source's day that has at
    least P.MIN_HOURS priced hours (the old jobs' rule) instead of no day. The default is the owner's rule: never a partial day.

    Returns a dict:
      payload   the KV value, or None when there is no day at all
      slots     [(start_utc, minutes, price)] the slots of the published days from the sources the days came from
      sources   {date: source the day came from (a day kept from the store keeps the source it had, else 'stored')}
      fresh     [date] of the days read from a source in this run (the others stayed from the store)
      missing   [date] with no complete day from any source and none stored
      diffs     disagreements between sources, see `disagreements`
    """
    horizon = horizon_end(now)
    cellmaps = {src: cells(sl) for src, sl in results if sl}
    picked, days, rows, fresh = {}, {}, [], set()
    tz = _tz(tzname)
    for date in sorted(dates):
        for src, sl in results:
            if sl and day_complete(cellmaps[src], date, tzname, horizon):
                picked[date] = src
                day = P.build_days(sl, tzname, [date], min_hours=0)
                if day:
                    d = day[0]
                    days[date] = {"date": d["date"], "type": d["type"], "source": src, "prices": d["prices"]}
                    fresh.add(date)
                    rows += [s for s in sl if s[0].astimezone(tz).date().isoformat() == date]
                break
        else:
            old = _stored_day(stored, date, tzname, horizon)
            if old:
                days[date], picked[date] = old, old.get("source", "stored")
            elif allow_partial:
                for src, sl in results:
                    day = P.build_days(sl, tzname, [date]) if sl else []     # MIN_HOURS applies
                    if day:
                        d = day[0]
                        days[date] = {"date": d["date"], "type": d["type"], "source": src, "prices": d["prices"]}
                        picked[date] = src
                        fresh.add(date)
                        rows += [s for s in sl if s[0].astimezone(tz).date().isoformat() == date]
                        break
    diffs = []
    srcs = [s for s, sl in results if sl]
    for i in range(len(srcs)):
        for j in range(i + 1, len(srcs)):
            diffs += disagreements(cellmaps[srcs[i]], cellmaps[srcs[j]], set(dates), tzname, srcs[i], srcs[j])
    payload = None
    if days and fresh:
        payload = {"zone": zone, "generated": now.date().isoformat(), "trainedThrough": None, "unit": "EUR/MWh",
                   "days": [days[d] for d in sorted(days)]}
    return {"payload": payload, "slots": sorted(rows, key=lambda s: s[0]), "sources": picked, "fresh": sorted(fresh),
            "missing": [d for d in sorted(dates) if d not in days], "diffs": diffs}


def _stored_day(stored, date, tzname, horizon):
    """A day of the stored payload that is complete by the same rule (every hour of the expected cells priced), else None."""
    if not isinstance(stored, dict):
        return None
    for d in stored.get("days") or []:
        if not isinstance(d, dict) or d.get("date") != date or d.get("type") != "actual":
            continue
        exp_hours = {c.astimezone(_tz(tzname)).hour for c in expected_cells(date, tzname, horizon)}
        have = {p.get("hour") for p in d.get("prices") or [] if isinstance(p, dict) and isinstance(p.get("eur_mwh"), (int, float))}
        if len(exp_hours) >= P.MIN_HOURS and exp_hours <= have:
            return d
    return None
