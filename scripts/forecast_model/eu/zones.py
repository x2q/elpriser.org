"""The 26 EU price zones of /api/nordic that have no model of their own yet (xk is Albania's price in 98 % of the hours: docs/forecast-xk.md), plus what the model needs to know about
each: the ENTSO-E EIC code, the zone's wall clock and the weather points that stand in for the zone.

The zone keys, EIC codes and time zones are the ones of scripts/eu_prices (build_eu_prices.py and
build_entsoe_prices.py) - test_zones.py pins that this list stays identical to the one the price jobs write.

Weather points. One point per small zone, two or three for the big ones, where wind (north) and solar (south) sit in
different places - the same idea as the Danish v3 model's 14 points, kept short because this model covers 25 zones.
Each zone's weather feature is the MEAN over its points, so the model sees one wind / radiation / temperature /
precipitation number per zone and hour.
"""

# zone key -> (EIC, IANA time zone, [(lat, lon), ...])
ZONES = {
    "de":   ("10Y1001A1001A82H", "Europe/Berlin",     [(53.6, 9.5), (51.2, 9.0), (48.6, 11.5)]),
    "fr":   ("10YFR-RTE------C", "Europe/Paris",      [(49.5, 2.5), (47.0, 1.5), (44.0, 3.5)]),
    "pl":   ("10YPL-AREA-----S", "Europe/Warsaw",     [(54.0, 17.5), (51.8, 19.5)]),
    "it-n": ("10Y1001A1001A73I", "Europe/Rome",       [(45.3, 9.2), (44.7, 11.3)]),
    "at":   ("10YAT-APG------L", "Europe/Vienna",     [(47.8, 13.5), (48.2, 16.4)]),
    "be":   ("10YBE----------2", "Europe/Brussels",   [(50.9, 4.4)]),
    "ch":   ("10YCH-SWISSGRIDZ", "Europe/Zurich",     [(46.9, 8.0)]),
    "cz":   ("10YCZ-CEPS-----N", "Europe/Prague",     [(49.8, 15.5)]),
    "hu":   ("10YHU-MAVIR----U", "Europe/Budapest",   [(47.2, 19.0)]),
    "si":   ("10YSI-ELES-----O", "Europe/Ljubljana",  [(46.1, 14.8)]),
    "es":   ("10YES-REE------0", "Europe/Madrid",     [(42.0, -5.0), (40.2, -3.7), (37.6, -5.0)]),
    "pt":   ("10YPT-REN------W", "Europe/Lisbon",     [(39.5, -8.5)]),
    "sk":   ("10YSK-SEPS-----K", "Europe/Bratislava", [(48.6, 19.0)]),
    "gr":   ("10YGR-HTSO-----Y", "Europe/Athens",     [(38.5, 23.0)]),
    "ro":   ("10YRO-TEL------P", "Europe/Bucharest",  [(44.5, 26.0), (44.5, 28.0)]),
    "bg":   ("10YCA-BULGARIA-R", "Europe/Sofia",      [(42.8, 25.0)]),
    "hr":   ("10YHR-HEP------M", "Europe/Zagreb",     [(45.5, 16.0)]),
    "rs":   ("10YCS-SERBIATSOV", "Europe/Belgrade",   [(44.5, 20.8)]),
    "ee":   ("10Y1001A1001A39I", "Europe/Tallinn",    [(58.8, 25.0)]),
    "lv":   ("10YLV-1001A00074", "Europe/Riga",       [(57.0, 24.8)]),
    "lt":   ("10YLT-1001A0008Q", "Europe/Vilnius",    [(55.3, 23.9)]),
    "ie":   ("10Y1001A1001A59C", "Europe/Dublin",     [(53.3, -8.0)]),
    "me":   ("10YCS-CG-TSO---S", "Europe/Podgorica",  [(42.8, 19.2)]),
    "mk":   ("10YMK-MEPSO----8", "Europe/Skopje",     [(41.6, 21.7)]),
    "al":   ("10YAL-KESH-----5", "Europe/Tirane",     [(41.0, 19.9)]),
    "xk":   ("10Y1001C--00100H", "Europe/Belgrade",   [(42.65, 21.15)]),     # Kosovo: CET, tzdata has no zone of its own; Pristina
}

# the zones' ISO country codes, for the holiday calendar (it-n -> IT, de -> DE ...)
COUNTRY = {z: z.split("-")[0].upper() for z in ZONES}


def all_points():
    """[(zone, index, lat, lon)] - every weather point once, in a stable order."""
    return [(z, i, lat, lon) for z, (_, _, pts) in ZONES.items() for i, (lat, lon) in enumerate(pts)]
