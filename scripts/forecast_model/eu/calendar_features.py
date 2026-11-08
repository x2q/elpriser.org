"""Public holidays per country, for the one calendar feature the Nordic model does not have.

A holiday flattens demand for the whole day, and in the EU zones that moves the day's price level and its shape more
than the weekday does (Christmas week, Easter, 1 May). The Nordic model gets by with weekday alone; across 25 countries
that would be the first thing a quick look at the residuals finds.

No `holidays` package (it is not on the Spark and the model should not need pip): the dates are computed here, from
Easter (the anonymous Gregorian algorithm) and a short table of the days that are a holiday in (almost) every country plus
the national ones that move a price. A missing local holiday costs a little accuracy on one day a year, a wrong flag is not
possible to avoid completely either - this is a model feature, not a statement of law.
"""
from datetime import date, timedelta


def easter(year):
    """Easter Sunday of the Gregorian calendar (Meeus/Jones/Butcher)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return date(year, month, day + 1)


# fixed-date holidays: (month, day) per country
FIXED = {
    "DE": [(1, 1), (5, 1), (10, 3), (12, 25), (12, 26)],
    "FR": [(1, 1), (5, 1), (5, 8), (7, 14), (8, 15), (11, 1), (11, 11), (12, 25)],
    "PL": [(1, 1), (1, 6), (5, 1), (5, 3), (8, 15), (11, 1), (11, 11), (12, 25), (12, 26)],
    "IT": [(1, 1), (1, 6), (4, 25), (5, 1), (6, 2), (8, 15), (11, 1), (12, 8), (12, 25), (12, 26)],
    "AT": [(1, 1), (1, 6), (5, 1), (8, 15), (10, 26), (11, 1), (12, 8), (12, 25), (12, 26)],
    "BE": [(1, 1), (5, 1), (7, 21), (8, 15), (11, 1), (11, 11), (12, 25)],
    "CH": [(1, 1), (8, 1), (12, 25), (12, 26)],
    "CZ": [(1, 1), (5, 1), (5, 8), (7, 5), (7, 6), (9, 28), (10, 28), (11, 17), (12, 24), (12, 25), (12, 26)],
    "HU": [(1, 1), (3, 15), (5, 1), (8, 20), (10, 23), (11, 1), (12, 25), (12, 26)],
    "SI": [(1, 1), (1, 2), (2, 8), (4, 27), (5, 1), (5, 2), (6, 25), (8, 15), (10, 31), (11, 1), (12, 25), (12, 26)],
    "ES": [(1, 1), (1, 6), (5, 1), (8, 15), (10, 12), (11, 1), (12, 6), (12, 8), (12, 25)],
    "PT": [(1, 1), (4, 25), (5, 1), (6, 10), (8, 15), (10, 5), (11, 1), (12, 1), (12, 8), (12, 25)],
    "SK": [(1, 1), (1, 6), (5, 1), (5, 8), (7, 5), (8, 29), (9, 1), (9, 15), (11, 1), (11, 17), (12, 24), (12, 25), (12, 26)],
    "GR": [(1, 1), (1, 6), (3, 25), (5, 1), (8, 15), (10, 28), (12, 25), (12, 26)],
    "RO": [(1, 1), (1, 2), (1, 24), (5, 1), (6, 1), (8, 15), (11, 30), (12, 1), (12, 25), (12, 26)],
    "BG": [(1, 1), (3, 3), (5, 1), (5, 6), (5, 24), (9, 6), (9, 22), (12, 24), (12, 25), (12, 26)],
    "HR": [(1, 1), (1, 6), (5, 1), (5, 30), (6, 22), (6, 25), (8, 5), (8, 15), (11, 1), (11, 18), (12, 25), (12, 26)],
    "RS": [(1, 1), (1, 2), (1, 7), (2, 15), (2, 16), (5, 1), (5, 2), (11, 11)],
    "EE": [(1, 1), (2, 24), (5, 1), (6, 23), (6, 24), (8, 20), (12, 24), (12, 25), (12, 26)],
    "LV": [(1, 1), (5, 1), (5, 4), (6, 23), (6, 24), (11, 18), (12, 24), (12, 25), (12, 26), (12, 31)],
    "LT": [(1, 1), (2, 16), (3, 11), (5, 1), (6, 24), (7, 6), (8, 15), (11, 1), (11, 2), (12, 24), (12, 25), (12, 26)],
    "IE": [(1, 1), (3, 17), (12, 25), (12, 26)],
    "ME": [(1, 1), (1, 2), (5, 1), (5, 2), (5, 21), (5, 22), (7, 13), (7, 14)],
    "MK": [(1, 1), (1, 7), (5, 1), (5, 24), (8, 2), (9, 8), (10, 11), (10, 23), (12, 8)],
    "AL": [(1, 1), (1, 2), (3, 14), (3, 22), (5, 1), (10, 19), (11, 28), (11, 29), (12, 8), (12, 25)],
    "XK": [(1, 1), (1, 2), (1, 7), (2, 17), (4, 9), (5, 1), (5, 9), (12, 25)],
}

# Easter-relative days (offset from Easter Sunday) per country, Western Easter
EASTER = {
    "DE": [-2, 1, 39, 50], "FR": [1, 39, 50], "PL": [1, 60], "IT": [1], "AT": [1, 39, 50, 60],
    "BE": [1, 39, 50], "CH": [-2, 1, 39, 50], "CZ": [-2, 1], "HU": [-2, 1, 50], "SI": [1, 50],
    "ES": [-2], "PT": [-2, 60], "SK": [-2, 1], "GR": [], "RO": [], "BG": [], "HR": [1, 60], "RS": [],
    "EE": [-2], "LV": [-2, 1], "LT": [1], "IE": [1], "ME": [], "MK": [], "AL": [], "XK": [1],
}
# Orthodox Easter countries keep the Orthodox feasts; the dates are tabled below (computed by the Julian algorithm)
ORTHODOX = {"GR": [-2, 1, 50], "RO": [-2, 1, 50], "BG": [-2, 1], "RS": [-2, 1], "ME": [1], "MK": [1], "AL": [], "XK": [1]}


def orthodox_easter(year):
    """Orthodox Easter Sunday as a Gregorian date (Julian algorithm, +13 days in 1900-2099)."""
    a, b, c = year % 4, year % 7, year % 19
    d = (19 * c + 15) % 30
    e = (2 * a + 4 * b - d + 34) % 7
    month, day = divmod(d + e + 114, 31)
    return date(year, month, day + 1) + timedelta(days=13)


_cache = {}


def holidays_of(country, year):
    key = (country, year)
    if key not in _cache:
        days = {date(year, m, d) for m, d in FIXED.get(country, [])}
        e = easter(year)
        days |= {e + timedelta(days=o) for o in EASTER.get(country, [])}
        oe = orthodox_easter(year)
        days |= {oe + timedelta(days=o) for o in ORTHODOX.get(country, [])}
        _cache[key] = days
    return _cache[key]


def is_holiday(d, country):
    return d in holidays_of(country, d.year)


def xmas_week(d):
    """24 December to 1 January: demand is low in every country, holiday or not."""
    return (d.month == 12 and d.day >= 24) or (d.month == 1 and d.day == 1)


def flags(dates, country):
    """(is_holiday, xmas_week) as two lists of 0/1 for an iterable of dates."""
    h, x = [], []
    for d in dates:
        h.append(1 if is_holiday(d, country) else 0)
        x.append(1 if xmas_week(d) else 0)
    return h, x
