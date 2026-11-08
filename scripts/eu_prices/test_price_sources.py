#!/usr/bin/env python3
"""Unit tests for omie_parse.py, price_sources.py and build_prices.py: the source-priority layer. REAL OMIE files (fixtures/
omie_marginalpdbc_*.txt, fetched 2026-11-08: a normal day, the 100-period and 92-period DST days, an hourly day of 2025) and the real
ENTSO-E / Energy-Charts fixtures of the other tests; synthetic slots only where a case needs a hole. No network, no KV."""
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_entsoe_prices as BE  # noqa: E402
import build_eu_prices as B       # noqa: E402
import build_prices as J          # noqa: E402
import energy_charts_parse as P   # noqa: E402
import entsoe_parse as E          # noqa: E402
import omie_parse as O            # noqa: E402
import price_sources as S         # noqa: E402

UTC = timezone.utc


def fx(name):
    with open(os.path.join(HERE, "fixtures", name), encoding="utf-8") as f:
        return f.read()


def fx_text(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


def at(s):
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


def day_slots(date, tzname, price=lambda i: 100.0 + i, minutes=15, skip=()):
    """A local day's slots; `price(i)` for the i-th slot of the day; `skip`: indexes left out (a hole)."""
    exp = S.expected_cells(date, tzname, at("2099-01-01T00:00:00"))
    return [(c, minutes, price(i)) for i, c in enumerate(exp) if i not in skip]


NOW = at("2026-11-08T12:30:00")       # Sunday; tomorrow is 2026-11-09
DATES = ["2026-11-07", "2026-11-08", "2026-11-09"]


class Omie(unittest.TestCase):
    def test_a_normal_day_is_96_quarter_hours_with_both_columns(self):
        got = O.parse_marginalpdbc(fx("omie_marginalpdbc_20261109.txt"), "2026-11-09")
        self.assertEqual(len(got["es"]), 96)
        self.assertEqual(got["es"][0], (at("2026-11-08T23:00:00"), 15, 170.2))      # period 1 = 00:00 CET of the market day
        self.assertEqual(got["es"][-1][0], at("2026-11-09T22:45:00"))
        self.assertEqual(got["pt"][2][2], 170.0)
        self.assertTrue(all(a[2] == b[2] for a, b in zip(got["es"], got["pt"])))     # no market split that day

    def test_dst_days_have_100_and_92_periods_in_elapsed_time(self):
        back = O.parse_marginalpdbc(fx("omie_marginalpdbc_20261025.txt"), "2026-10-25")["es"]
        self.assertEqual(len(back), 100)
        self.assertEqual(back[0][0], at("2026-10-24T22:00:00"))                      # CEST midnight
        self.assertEqual(back[-1][0] + timedelta(minutes=15), at("2026-10-25T23:00:00"))
        fwd = O.parse_marginalpdbc(fx("omie_marginalpdbc_20260329.txt"), "2026-03-29")["es"]
        self.assertEqual(len(fwd), 92)
        self.assertEqual(fwd[-1][0] + timedelta(minutes=15), at("2026-03-29T22:00:00"))

    def test_the_hourly_files_before_october_2025_are_60_minute_slots(self):
        got = O.parse_marginalpdbc(fx("omie_marginalpdbc_20250930.txt"), "2025-09-30")["es"]
        self.assertEqual([m for _, m, _ in got], [60] * 24)
        self.assertEqual(got[0][2], 95.46)

    def test_a_file_that_is_not_a_clean_day_is_refused(self):
        good = fx("omie_marginalpdbc_20261109.txt")
        for bad, why in ((good.replace("MARGINALPDBC", "<html>"), "header"),
                         (good, "wrong day"),
                         (good.replace("2026;11;09;96;198;198;\n", ""), "95 rows"),
                         (good.replace("2026;11;09;5;166.4;166.4;", "2026;11;09;5;x;166.4;"), "price"),
                         (good.replace("2026;11;09;5;", "2026;11;09;4;"), "twice")):
            with self.assertRaises(ValueError, msg=why):
                O.parse_marginalpdbc(bad, "2026-11-10" if why == "wrong day" else "2026-11-09")

    def test_url_is_the_one_the_site_redirects_to(self):
        self.assertEqual(O.file_url("2026-11-09"), "https://www.omie.es/en/file-download?parents=marginalpdbc&filename=marginalpdbc_20261109.1")


class Rules(unittest.TestCase):
    def test_every_zone_has_known_sources_and_the_licences_allow_them(self):
        for z, chain in S.CHAINS.items():
            self.assertIn(z, J.TZ)
            self.assertTrue(chain and len(set(chain)) == len(chain), z)
            for src in chain:
                self.assertIn(src, (S.ENTSOE, S.EC, S.OMIE))
            if S.ENTSOE in chain:
                self.assertRegex(J.EIC[z], r"^10Y[0-9A-Z-]{13}$", z)
            if S.EC in chain:
                self.assertIn(z, B.ZONES, f"{z}: Energy-Charts licenses CC BY 4.0 only for the zones of build_eu_prices.ZONES")
            if S.OMIE in chain:
                self.assertIn(z, O.COLUMN, f"{z}: OMIE covers Spain and Portugal only")
        self.assertEqual({z for z, c in S.CHAINS.items() if S.EC in c}, set(B.ZONES))
        self.assertEqual({z for z, c in S.CHAINS.items() if S.OMIE in c}, {"es", "pt"})
        self.assertEqual(set(S.CHAINS) - set(B.ZONES), set(BE.ZONES), "the ENTSO-E zones of the old job are all here")
        self.assertEqual(S.CHAINS["de"], [S.ENTSOE, S.EC])
        self.assertEqual(S.CHAINS["es"], [S.ENTSOE, S.OMIE])
        for z in ("gb", "ie", "nl", "dk1", "fi"):
            self.assertNotIn(z, S.CHAINS, f"{z} keeps its own job")

    def test_expected_cells_follow_the_zones_clock_and_the_publication_horizon(self):
        far = at("2099-01-01T00:00:00")
        self.assertEqual(len(S.expected_cells("2026-11-08", "Europe/Berlin", far)), 96)
        self.assertEqual(len(S.expected_cells("2026-10-25", "Europe/Berlin", far)), 100)       # the clocks go back
        self.assertEqual(len(S.expected_cells("2026-03-29", "Europe/Berlin", far)), 92)        # and forward
        h = S.horizon_end(NOW)
        self.assertEqual(h, at("2026-11-09T23:00:00"))                                        # the end of tomorrow's CET market day
        self.assertEqual(len(S.expected_cells("2026-11-09", "Europe/Berlin", h)), 96)
        self.assertEqual(len(S.expected_cells("2026-11-09", "Europe/Lisbon", h)), 92, "Lisbon's tomorrow ends an hour after the market day: 23 hours")
        self.assertEqual(len(S.expected_cells("2026-11-10", "Europe/Berlin", h)), 0)

    def test_a_day_is_complete_only_with_every_published_cell(self):
        h = S.horizon_end(NOW)
        full = S.cells(day_slots("2026-11-09", "Europe/Berlin"))
        self.assertTrue(S.day_complete(full, "2026-11-09", "Europe/Berlin", h))
        hole = S.cells(day_slots("2026-11-09", "Europe/Berlin", skip=(40,)))
        self.assertFalse(S.day_complete(hole, "2026-11-09", "Europe/Berlin", h), "one missing quarter hour makes the day partial")
        self.assertFalse(S.day_complete(S.cells(day_slots("2026-11-09", "Europe/Berlin")[:60]), "2026-11-09", "Europe/Berlin", h))
        self.assertFalse(S.day_complete({}, "2026-11-09", "Europe/Berlin", h))
        pt = S.cells(day_slots("2026-11-09", "Europe/Lisbon")[:92])
        self.assertTrue(S.day_complete(pt, "2026-11-09", "Europe/Lisbon", h), "Portugal's tomorrow is complete with 23 hours")

    def test_hourly_sources_count_as_four_cells_an_hour(self):
        hourly = day_slots("2026-11-08", "Europe/Berlin", minutes=60)[::4]
        hourly = [(t, 60, p) for t, _, p in hourly]
        self.assertEqual(len(hourly), 24)
        self.assertTrue(S.day_complete(S.cells(hourly), "2026-11-08", "Europe/Berlin", S.horizon_end(NOW)))

    def test_the_real_es_fixture_is_complete_for_both_days(self):
        slots = E.parse_a44(fx("entsoe_a44_es.xml"))
        now = at("2026-11-02T12:00:00")
        h = S.horizon_end(now)
        cm = S.cells(slots)
        self.assertTrue(S.day_complete(cm, "2026-11-02", "Europe/Madrid", h))
        self.assertTrue(S.day_complete(cm, "2026-11-03", "Europe/Madrid", h))
        self.assertFalse(S.day_complete(cm, "2026-11-04", "Europe/Madrid", h))

    def test_market_dates_for_the_omie_files(self):
        h = S.horizon_end(NOW)
        self.assertEqual(S.market_dates(["2026-11-09"], "Europe/Madrid", h), ["2026-11-09"])
        self.assertEqual(S.market_dates(["2026-11-08"], "Europe/Lisbon", h), ["2026-11-08", "2026-11-09"], "Lisbon's last hour is in the next market day")
        self.assertEqual(S.market_dates(["2026-11-09"], "Europe/Lisbon", h), ["2026-11-09"], "...which is not published yet for tomorrow")

    def test_the_fallback_gate_only_closes_for_tomorrow_before_the_auction(self):
        early, late = at("2026-11-08T11:00:00"), at("2026-11-08T13:00:00")     # 12:00 and 14:00 CET
        self.assertFalse(S.gate_open(S.EC, early, ["2026-11-09"], DATES))
        self.assertTrue(S.gate_open(S.EC, late, ["2026-11-09"], DATES))
        self.assertTrue(S.gate_open(S.EC, early, ["2026-11-08", "2026-11-09"], DATES), "today missing: ask at once")
        self.assertTrue(S.gate_open(S.OMIE, early, ["2026-11-09"], DATES), "OMIE has no gate")
        self.assertTrue(S.gate_open(S.EC, early, [], DATES))
        self.assertTrue(S.gate_open(S.EC, at("2026-07-08T11:50:00"), ["2026-07-09"], ["2026-07-07", "2026-07-08", "2026-07-09"]), "13:50 CEST")
        self.assertFalse(S.gate_open(S.EC, at("2026-07-08T11:30:00"), ["2026-07-09"], ["2026-07-07", "2026-07-08", "2026-07-09"]), "13:30 CEST")


class Combine(unittest.TestCase):
    TZ = "Europe/Berlin"

    def two_sources(self):
        ent = day_slots("2026-11-07", self.TZ) + day_slots("2026-11-08", self.TZ)
        ec = day_slots("2026-11-07", self.TZ) + day_slots("2026-11-08", self.TZ) + day_slots("2026-11-09", self.TZ, price=lambda i: 50.0 + i)
        return ent, ec

    def test_tomorrow_comes_from_the_next_source_and_each_day_says_where_from(self):
        ent, ec = self.two_sources()
        out = S.combine("de", self.TZ, DATES, [(S.ENTSOE, ent), (S.EC, ec)], NOW)
        self.assertEqual(out["sources"], {"2026-11-07": S.ENTSOE, "2026-11-08": S.ENTSOE, "2026-11-09": S.EC})
        self.assertEqual(out["missing"], [])
        p = out["payload"]
        self.assertEqual(list(p), ["zone", "generated", "trainedThrough", "unit", "days"])      # the shape the Worker reads
        self.assertEqual((p["zone"], p["generated"], p["trainedThrough"], p["unit"]), ("de", "2026-11-08", None, "EUR/MWh"))
        self.assertEqual([(d["date"], d["type"], d["source"], len(d["prices"])) for d in p["days"]],
                         [("2026-11-07", "actual", S.ENTSOE, 24), ("2026-11-08", "actual", S.ENTSOE, 24), ("2026-11-09", "actual", S.EC, 24)])
        self.assertEqual(list(p["days"][0]), ["date", "type", "source", "prices"])
        self.assertEqual(p["days"][2]["prices"][0], {"hour": 0, "eur_mwh": round(sum(50.0 + i for i in range(4)) / 4, 2)})

    def test_the_first_complete_source_wins_and_its_numbers_are_the_old_jobs_numbers(self):
        es = E.parse_a44(fx("entsoe_a44_es.xml"))
        now = at("2026-11-02T12:00:00")
        dates = ["2026-11-01", "2026-11-02", "2026-11-03"]
        old = E.build_payload("es", fx("entsoe_a44_es.xml"), "Europe/Madrid", dates, now.date().isoformat())
        other = [(t, m, p + 1.0) for t, m, p in es]
        new = S.combine("es", "Europe/Madrid", dates, [(S.ENTSOE, es), (S.OMIE, other)], now)
        self.assertEqual([(d["date"], d["prices"]) for d in new["payload"]["days"]], [(d["date"], d["prices"]) for d in old["days"]],
                         "same source, same numbers as build_entsoe_prices.py wrote")
        self.assertEqual(new["missing"], ["2026-11-01"], "yesterday is not in the fixture (a partial day is not published)")
        slot_old = P.build_slots_payload("es", es, "Europe/Madrid", old["days"], now.date().isoformat())
        slot_new = P.build_slots_payload("es", new["slots"], "Europe/Madrid", new["payload"]["days"], now.date().isoformat())
        self.assertEqual(slot_old, slot_new)

    def test_a_partial_day_is_never_published(self):
        ent = day_slots("2026-11-08", self.TZ) + day_slots("2026-11-09", self.TZ, skip=(40,))
        out = S.combine("de", self.TZ, DATES, [(S.ENTSOE, ent)], NOW)
        self.assertEqual([d["date"] for d in out["payload"]["days"]], ["2026-11-08"])
        self.assertEqual(out["missing"], ["2026-11-07", "2026-11-09"])
        self.assertTrue(all(s[0].astimezone(ZoneInfo(self.TZ)).date().isoformat() == "2026-11-08" for s in out["slots"]), "its slots are not published either")

    def test_allow_partial_is_the_old_jobs_rule_and_is_off_by_default(self):
        ent = day_slots("2026-11-08", self.TZ, skip=(3,))                       # one quarter hour missing: 23 full hours + a 3-quarter hour
        strict = S.combine("de", self.TZ, ["2026-11-08"], [(S.ENTSOE, ent)], NOW)
        self.assertIsNone(strict["payload"])
        self.assertEqual(strict["missing"], ["2026-11-08"])
        loose = S.combine("de", self.TZ, ["2026-11-08"], [(S.ENTSOE, ent)], NOW, allow_partial=True)
        self.assertEqual([(d["date"], d["source"]) for d in loose["payload"]["days"]], [("2026-11-08", S.ENTSOE)])
        short = S.combine("de", self.TZ, ["2026-11-08"], [(S.ENTSOE, day_slots("2026-11-08", self.TZ)[:40])], NOW, allow_partial=True)
        self.assertIsNone(short["payload"], "even then a day of fewer than 12 hours is not a day")

    def test_a_null_price_in_a_source_makes_that_day_partial_for_that_source_only(self):
        ent, ec = self.two_sources()
        ent = ent[:150] + ent[151:]
        out = S.combine("de", self.TZ, DATES, [(S.ENTSOE, ent), (S.EC, ec)], NOW)
        self.assertEqual(out["sources"]["2026-11-07"], S.ENTSOE)
        self.assertEqual(out["sources"]["2026-11-08"], S.EC)

    def test_disagreements_are_reported_not_acted_on(self):
        ent, ec = self.two_sources()
        ec = [(t, m, p + 0.05) if (t.astimezone(ZoneInfo(self.TZ)).date().isoformat(), t.astimezone(ZoneInfo(self.TZ)).hour) == ("2026-11-08", 13) else (t, m, p) for t, m, p in ec]
        ec = [(t, m, p + 0.005) if t == at("2026-11-07T10:00:00") else (t, m, p) for t, m, p in ec]       # under the tolerance
        out = S.combine("de", self.TZ, DATES, [(S.ENTSOE, ent), (S.EC, ec)], NOW)
        self.assertEqual(out["diffs"], [("2026-11-08", 13, 0.05, S.ENTSOE, S.EC)])
        self.assertEqual(out["sources"]["2026-11-08"], S.ENTSOE, "the first source still wins")

    def test_the_stored_day_survives_a_source_that_has_nothing(self):
        ent, ec = self.two_sources()
        first = S.combine("de", self.TZ, DATES, [(S.ENTSOE, ent), (S.EC, ec)], NOW)["payload"]
        again = S.combine("de", self.TZ, DATES, [(S.ENTSOE, None), (S.EC, None)], NOW + timedelta(minutes=10), stored=first)
        self.assertIsNone(again["payload"], "nothing fresh: nothing to write")
        self.assertEqual(sorted(again["sources"]), DATES)
        self.assertEqual(again["fresh"], [])
        later = S.combine("de", self.TZ, DATES, [(S.ENTSOE, day_slots("2026-11-08", self.TZ, price=lambda i: 1.0)), (S.EC, None)], NOW, stored=first)
        self.assertEqual([d["date"] for d in later["payload"]["days"]], DATES, "today fresh, yesterday and tomorrow stay")
        self.assertEqual(later["fresh"], ["2026-11-08"])
        self.assertEqual(later["payload"]["days"][2], first["days"][2])

    def test_a_partial_stored_day_is_not_kept(self):
        ent, ec = self.two_sources()
        first = S.combine("de", self.TZ, DATES, [(S.ENTSOE, ent), (S.EC, ec)], NOW)["payload"]
        first["days"][2]["prices"][5]["eur_mwh"] = None
        again = S.combine("de", self.TZ, DATES, [(S.ENTSOE, day_slots("2026-11-08", self.TZ))], NOW, stored=first)
        self.assertNotIn("2026-11-09", again["sources"])

    def test_dst_days_publish_the_hours_the_day_has(self):
        o = O.parse_marginalpdbc(fx("omie_marginalpdbc_20261025.txt"), "2026-10-25")["es"]
        now = at("2026-10-24T12:00:00")
        out = S.combine("es", "Europe/Madrid", ["2026-10-25"], [(S.OMIE, o)], now)
        d = out["payload"]["days"][0]
        self.assertEqual((d["source"], len(d["prices"])), (S.OMIE, 24))
        self.assertTrue(all(p["eur_mwh"] is not None for p in d["prices"]), "the doubled hour 2 is the mean of both")
        f = O.parse_marginalpdbc(fx("omie_marginalpdbc_20260329.txt"), "2026-03-29")["es"]
        out = S.combine("es", "Europe/Madrid", ["2026-03-29"], [(S.OMIE, f)], at("2026-03-28T12:00:00"))
        d = out["payload"]["days"][0]
        self.assertEqual([p["hour"] for p in d["prices"] if p["eur_mwh"] is None], [2], "the hour that does not exist is null")

    def test_portugal_tomorrow_has_23_hours_and_is_still_published(self):
        o = O.parse_marginalpdbc(fx("omie_marginalpdbc_20261109.txt"), "2026-11-09")["pt"]
        # the hour 23:00-24:00 Lisbon of the 8th is market-day 9th's first hour: the OMIE file of the 9th supplies it
        slots = [s for s in day_slots("2026-11-08", "Europe/Lisbon")[:92]] + o
        out = S.combine("pt", "Europe/Lisbon", ["2026-11-08", "2026-11-09"], [(S.OMIE, slots)], NOW)
        self.assertEqual(out["sources"], {"2026-11-08": S.OMIE, "2026-11-09": S.OMIE})
        last = out["payload"]["days"][1]["prices"]
        self.assertEqual((sum(1 for p in last if p["eur_mwh"] is not None), last[23]["eur_mwh"]), (23, None))


class Runner(unittest.TestCase):
    """build_prices.run_zone with a fake fetcher and a fake KV: who is asked, in which order, and what is written."""

    class Fake:
        def __init__(self, data):
            self.data, self.calls = data, []

        def fetch(self, src, zone, tzname, dates, horizon):
            self.calls.append(src)
            v = self.data.get(src)
            if isinstance(v, Exception):
                raise v
            return v or []

    def setUp(self):
        self.kv, self.writes = {}, []
        self._get, self._put = B.kv_get, B.kv_put
        B.kv_get = lambda key, a, t: self.kv.get(key)
        B.kv_put = lambda key, v, ttl, a, t: (self.writes.append(key), self.kv.__setitem__(key, v))
        self.tz = "Europe/Berlin"
        self.today = day_slots("2026-11-07", self.tz) + day_slots("2026-11-08", self.tz)
        self.full = self.today + day_slots("2026-11-09", self.tz)

    def tearDown(self):
        B.kv_get, B.kv_put = self._get, self._put

    def run_zone(self, data, now=NOW, **kw):
        f = self.Fake(data)
        lines = J.run_zone("de", now, f, kw.pop("kv", ("a", "t")), **kw)
        return f.calls, lines

    def test_the_first_source_is_enough_when_it_has_every_day(self):
        calls, lines = self.run_zone({S.ENTSOE: self.full, S.EC: self.full})
        self.assertEqual(calls, [S.ENTSOE])
        self.assertIn("wrote eu-prices-de", lines[0])
        self.assertIn("entsoe", lines[0])
        self.assertEqual({d["source"] for d in self.kv["eu-prices-de"]["days"]}, {S.ENTSOE})
        self.assertEqual(len(self.kv["eu-slots-de"]["slots"]), 288)

    def test_energy_charts_is_not_asked_for_tomorrow_before_the_auction_but_is_after(self):
        early = at("2026-11-08T10:30:00")
        calls, _ = self.run_zone({S.ENTSOE: self.today, S.EC: self.full}, now=early)
        self.assertEqual(calls, [S.ENTSOE])
        self.kv.clear()
        calls, lines = self.run_zone({S.ENTSOE: self.today, S.EC: self.full}, now=at("2026-11-08T13:00:00"))
        self.assertEqual(calls, [S.ENTSOE, S.EC])
        self.assertEqual([d["source"] for d in self.kv["eu-prices-de"]["days"]], [S.ENTSOE, S.ENTSOE, S.EC])
        self.assertIn("2026-11-09 (24 h, energy-charts)", lines[0])

    def test_a_source_that_fails_is_logged_and_the_next_one_serves_the_zone(self):
        calls, lines = self.run_zone({S.ENTSOE: RuntimeError("ENTSO-E HTTP 503"), S.EC: self.full}, now=at("2026-11-08T13:00:00"))
        self.assertEqual(calls, [S.ENTSOE, S.EC])
        self.assertIn("entsoe FAILED (RuntimeError: ENTSO-E HTTP 503)", lines[0])
        self.assertEqual({d["source"] for d in self.kv["eu-prices-de"]["days"]}, {S.EC})

    def test_every_source_failing_leaves_the_store_alone(self):
        self.run_zone({S.ENTSOE: self.full})
        before = dict(self.kv)
        self.writes.clear()
        calls, lines = self.run_zone({S.ENTSOE: RuntimeError("x"), S.EC: RuntimeError("y")}, now=at("2026-11-08T13:30:00"))
        self.assertEqual(self.writes, [])
        self.assertEqual(self.kv, before)
        self.assertIn("KV untouched", lines[0])

    def test_an_unchanged_run_writes_nothing(self):
        self.run_zone({S.ENTSOE: self.full})
        self.writes.clear()
        _, lines = self.run_zone({S.ENTSOE: self.full})
        self.assertEqual(self.writes, [])
        self.assertIn("unchanged, no write", lines[0])

    def test_a_source_that_loses_tomorrow_does_not_take_it_from_the_site(self):
        self.run_zone({S.ENTSOE: self.full})
        _, lines = self.run_zone({S.ENTSOE: self.today}, now=at("2026-11-08T13:30:00"))
        self.assertEqual([d["date"] for d in self.kv["eu-prices-de"]["days"]], DATES)
        self.assertEqual(self.kv["eu-prices-de"]["days"][2]["source"], S.ENTSOE)

    def test_crosscheck_asks_the_later_sources_and_logs_the_difference(self):
        ec = [(t, m, p + 0.5 if i == 7 else p) for i, (t, m, p) in enumerate(self.full)]
        calls, lines = self.run_zone({S.ENTSOE: self.full, S.EC: ec}, crosscheck=True, dry=True, kv=None)
        self.assertEqual(calls, [S.ENTSOE, S.EC])
        self.assertTrue(any("DIFF 2026-11-07 h01 0.50 EUR/MWh (entsoe vs energy-charts)" in l for l in lines), lines)
        self.assertIn("would write eu-prices-de", lines[0])
        self.assertEqual(self.writes, [])

    def test_compare_reads_the_store_and_never_writes(self):
        self.run_zone({S.ENTSOE: self.full})
        self.writes.clear()
        changed = [(t, m, p + 1.0 if i == 40 else p) for i, (t, m, p) in enumerate(self.full)]
        _, lines = self.run_zone({S.ENTSOE: changed}, dry=True, compare=True)
        self.assertEqual(self.writes, [])
        self.assertIn("compare:", lines[0])
        self.assertIn("2026-11-07 1 h differ", lines[0])
        self.assertIn("2026-11-08 identical", lines[0])
        self.assertIn("slots differ (2 rows)", lines[0], "the 15-minute rows are compared too")

    def test_stored_days_keep_their_15_minute_rows(self):
        self.run_zone({S.ENTSOE: self.full})
        rows_before = [r for r in self.kv["eu-slots-de"]["slots"] if r[0] >= at("2026-11-08T23:00:00").timestamp()]
        self.run_zone({S.ENTSOE: self.today}, now=at("2026-11-08T13:30:00"))
        rows_after = [r for r in self.kv["eu-slots-de"]["slots"] if r[0] >= at("2026-11-08T23:00:00").timestamp()]
        self.assertEqual(rows_before, rows_after)
        self.assertEqual(len(rows_after), 96)

    def test_no_secret_reaches_a_log_line(self):
        calls, lines = self.run_zone({S.ENTSOE: RuntimeError("ENTSO-E HTTP 401")}, now=at("2026-11-08T10:00:00"))
        self.assertFalse(any("securityToken" in l for l in lines))


class Measure(unittest.TestCase):
    def test_windows_and_the_production_job_blackout(self):
        import measure_first_seen as M
        self.assertTrue(M.in_window(at("2026-11-09T12:00:00")))
        self.assertFalse(M.in_window(at("2026-11-09T09:00:00")))
        self.assertTrue(M.in_window(at("2026-11-09T09:00:00"), start_extra=at("2026-11-09T08:30:00")))
        self.assertTrue(M.ec_blocked(at("2026-11-09T14:05:00")))
        self.assertTrue(M.ec_blocked(at("2026-11-09T13:58:00")))
        self.assertFalse(M.ec_blocked(at("2026-11-09T14:12:00")))
        self.assertFalse(M.ec_blocked(at("2026-11-09T12:00:00")))

    def test_report_prints_the_first_time_each_source_had_the_day(self):
        import io
        import json
        import measure_first_seen as M
        import tempfile
        from contextlib import redirect_stdout
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "x.jsonl")
            with open(p, "w", encoding="utf-8") as f:
                f.write(json.dumps({"seen_utc": "2026-11-09T12:05:01Z", "zone": "de", "date": "2026-11-10", "source": "entsoe"}) + "\n")
                f.write(json.dumps({"seen_utc": "2026-11-09T13:35:00Z", "zone": "de", "date": "2026-11-10", "source": "energy-charts", "first_round": True}) + "\n")
            buf = io.StringIO()
            with redirect_stdout(buf):
                M.report(p)
        self.assertEqual(buf.getvalue().split(), ["de", "2026-11-10", "entsoe=12:05Z", "energy-charts=<=13:35Z", "omie=-"])


class Wiring(unittest.TestCase):
    def test_the_job_reads_its_credentials_from_the_environment_only(self):
        src = fx_text("build_prices.py")
        for name in ("ENTSOE_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"):
            self.assertIn(f'os.environ.get("{name}")', src)
        import re
        self.assertIsNone(re.search(r"[0-9a-f]{32}", src), "a 32-hex literal (a token?)")
        self.assertNotIn("epex", src.lower(), "EPEX is not a source (owner's rule)")
        for f in ("price_sources.py", "omie_parse.py"):
            self.assertNotIn("epex", fx_text(f).lower().replace("euphemia", ""), f)


if __name__ == "__main__":
    unittest.main()
