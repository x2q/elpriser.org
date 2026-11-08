#!/usr/bin/env python3
"""Pure parsing for OMIE's day-ahead price file (marginalpdbc): the Iberian market's own result file in, the same
(start_utc, minutes, EUR/MWh) slots the other sources give. No network, no files, stdlib only.

The source. OMIE (the Iberian NEMO) publishes the day-ahead marginal prices of one market day (CET calendar day) as a
plain-text file, free to download with no key:
    GET https://www.omie.es/en/file-download?parents%5B0%5D=marginalpdbc&filename=marginalpdbc_YYYYMMDD.1
(the site first answers 302 to the same URL with `parents=` unbracketed, then 200 application/octet-stream; a file that is
not published yet answers 404). Verified 2026-11-08 against real files for 2026-11-09 (96 quarter hours), 2026-10-25
(100, the day the clocks go back), 2026-03-29 (92, the day they go forward) and 2025-09-30 / 2025-10-01 (24 hourly rows
before the 15-minute market time unit, 96 after):
    MARGINALPDBC;
    2026;11;09;1;170.2;170.2;
    ...
    *
Columns: year; month; day; period; price Portugal; price Spain; (a trailing ';'). Prices are EUR/MWh. Period 1 starts at
local midnight of the market day (Europe/Madrid, which is CET/CEST); the periods are consecutive in elapsed time, so a
market day of 23, 24 or 25 hours has 92, 96 or 100 quarter-hour periods (or 23/24/25 hourly ones before October 2025).
The step is therefore the length of the market day divided by the number of rows, and it must be 15 or 60 minutes.

Terms (https://www.omie.es/en/legal-warning, read 2026-11-08): the public information "can be used freely, provided that its
original content is fully respected"; when it is "used in its original format, you must cite the source". The site cites OMIE
and says that its hourly means are its own change of the data.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

UTC = timezone.utc
MARKET_TZ = "Europe/Madrid"
COLUMN = {"pt": 4, "es": 5}     # index in the row, after splitting on ';'
URL = "https://www.omie.es/en/file-download"


def file_name(market_date, version=1):
    return f"marginalpdbc_{market_date.replace('-', '')}.{version}"


def file_url(market_date, version=1):
    """The download URL of one market day's file (the unbracketed `parents` is the form the site redirects to)."""
    return f"{URL}?parents=marginalpdbc&filename={file_name(market_date, version)}"


def market_day_span(market_date):
    """(start_utc, minutes) of the market day: from local Madrid midnight to the next one."""
    tz = ZoneInfo(MARKET_TZ)
    d = datetime.fromisoformat(market_date)
    a = d.replace(tzinfo=tz).astimezone(UTC)
    b = (d + timedelta(days=1)).replace(tzinfo=tz).astimezone(UTC)
    return a, int((b - a).total_seconds() // 60)


def parse_marginalpdbc(text, market_date):
    """{'es': [(start_utc, minutes, price)], 'pt': [...]} for the market day `market_date` (ISO date).

    Raises ValueError for anything that is not a marginalpdbc file of that day: wrong header, a row of another day,
    a row count that does not give a 15- or 60-minute step, a price that is not a number, a repeated period."""
    if isinstance(text, bytes):
        text = text.decode("utf-8", "replace")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines or not lines[0].upper().startswith("MARGINALPDBC"):
        raise ValueError("not an OMIE marginalpdbc file")
    rows = {}
    for ln in lines[1:]:
        if ln.startswith("*"):
            continue
        f = ln.split(";")
        if len(f) < 6:
            raise ValueError(f"short row {ln!r}")
        try:
            y, m, d, period = int(f[0]), int(f[1]), int(f[2]), int(f[3])
            pt, es = float(f[COLUMN["pt"]]), float(f[COLUMN["es"]])
        except ValueError:
            raise ValueError(f"bad row {ln!r}")
        if f"{y:04d}-{m:02d}-{d:02d}" != market_date:
            raise ValueError(f"row of {y}-{m}-{d} in the file of {market_date}")
        if period in rows:
            raise ValueError(f"period {period} twice")
        rows[period] = (pt, es)
    if not rows:
        return {"es": [], "pt": []}
    start, minutes = market_day_span(market_date)
    n = len(rows)
    if sorted(rows) != list(range(1, n + 1)):
        raise ValueError("periods are not 1..N")
    if minutes % n or minutes // n not in (15, 60):
        raise ValueError(f"{n} rows do not fit a market day of {minutes} minutes")
    step = minutes // n
    out = {"es": [], "pt": []}
    for p in range(1, n + 1):
        t = start + timedelta(minutes=step * (p - 1))
        out["pt"].append((t, step, rows[p][0]))
        out["es"].append((t, step, rows[p][1]))
    return out
