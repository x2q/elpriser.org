"""Bank holidays of England and Wales (the calendar of the Great Britain price), computed - no package: Easter (calendar_features.easter), the
Monday rules and the substitute days. Scotland differs in a few days (2 January, the August holiday); a missing local holiday costs a little
accuracy on one day a year, this is a model feature and not a statement of law."""
from datetime import date, timedelta


def _easter(year):
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


def _first_monday(y, m):
    d = date(y, m, 1)
    return d + timedelta(days=(7 - d.weekday()) % 7)


def _last_monday(y, m):
    d = date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)
    return d - timedelta(days=d.weekday())


_cache = {}


def holidays(year):
    if year in _cache:
        return _cache[year]
    out = set()
    ny = date(year, 1, 1)
    out.add(ny if ny.weekday() < 5 else ny + timedelta(days=(7 - ny.weekday())))
    e = _easter(year)
    out |= {e - timedelta(days=2), e + timedelta(days=1)}
    out |= {_first_monday(year, 5), _last_monday(year, 5), _last_monday(year, 8)}
    xmas, box = date(year, 12, 25), date(year, 12, 26)
    if xmas.weekday() < 5:
        out.add(xmas)
        out.add(box if box.weekday() < 5 else date(year, 12, 28))
    elif xmas.weekday() == 5:              # Christmas Sat: Mon 27 Christmas, Tue 28 Boxing Day
        out |= {date(year, 12, 27), date(year, 12, 28)}
    else:                                  # Christmas Sun: Boxing Day Mon 26 stays, Christmas moves to Tue 27
        out |= {date(year, 12, 26), date(year, 12, 27)}
    _cache[year] = out
    return out


def is_holiday(d):
    return d in holidays(d.year)


def xmas_week(d):
    return (d.month == 12 and d.day >= 24) or (d.month == 1 and d.day == 1)
