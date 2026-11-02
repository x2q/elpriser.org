#!/usr/bin/env python3
"""Unit tests for elexon_parse.py and build_elexon_prices.py, on REAL Elexon BMRS Market Index Data responses (fixtures/
elexon_mid_*.json, fetched 2026-11-02): the day the clocks went back (25 hours), the day they went forward (23 hours) and a
partial day with the newest half hour just in. No network."""
import contextlib
import io
import os
import sys
import unittest
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_elexon_prices as J   # noqa: E402
import elexon_parse as X          # noqa: E402
import energy_charts_parse as P   # noqa: E402

LON = "Europe/London"


def fx(name):
    with open(os.path.join(HERE, "fixtures", f"elexon_mid_{name}.json"), encoding="utf-8") as f:
        return f.read()


def row(start, price, vol, prov="APXMIDP"):
    return {"startTime": start, "dataProvider": prov, "settlementDate": start[:10], "settlementPeriod": 1, "price": price, "volume": vol}


def doc(*rows):
    return {"metadata": {"datasets": ["MID"]}, "data": list(rows)}


class Parse(unittest.TestCase):
    def test_volume_weighted_mean_over_the_providers_that_traded(self):
        got = X.parse_mid(doc(row("2026-11-02T10:00:00Z", 100, 1000), row("2026-11-02T10:00:00Z", 200, 3000, "N2EXMIDP")))
        self.assertEqual(got, [(datetime(2026, 11, 2, 10, tzinfo=timezone.utc), 30, 175.0)])

    def test_a_provider_with_price_zero_and_volume_zero_is_no_trade_not_a_price(self):
        got = X.parse_mid(doc(row("2026-11-02T10:00:00Z", 120.5, 800), row("2026-11-02T10:00:00Z", 0, 0, "N2EXMIDP")))
        self.assertEqual([p for _, _, p in got], [120.5])

    def test_a_half_hour_without_any_volume_has_no_price(self):
        self.assertEqual(X.parse_mid(doc(row("2026-11-02T10:00:00Z", 0, 0), row("2026-11-02T10:00:00Z", 0, 0, "N2EXMIDP"))), [])

    def test_negative_prices_are_kept_and_zero_price_with_volume_is_a_price(self):
        got = X.parse_mid(doc(row("2026-11-02T10:00:00Z", -12.5, 10), row("2026-11-02T10:30:00Z", 0, 10)))
        self.assertEqual([p for _, _, p in got], [-12.5, 0.0])

    def test_empty_data_is_empty_not_an_error(self):
        self.assertEqual(X.parse_mid({"data": []}), [])

    def test_not_a_mid_document_is_an_error(self):
        for bad in ("<html>", "[]", '{"x":1}', '{"data": 3}', doc({"startTime": "x"})):
            with self.assertRaises(ValueError, msg=repr(bad)):
                X.parse_mid(bad)

    def test_accepts_text_or_parsed(self):
        self.assertEqual(X.parse_mid(fx("2026-11-02_partial")), X.parse_mid(__import__("json").loads(fx("2026-11-02_partial"))))


class Hours(unittest.TestCase):
    def test_an_hour_needs_both_half_hours(self):
        d = doc(row("2026-11-02T10:00:00Z", 100, 1), row("2026-11-02T10:30:00Z", 200, 1), row("2026-11-02T11:00:00Z", 300, 1))
        days = X.build_days(X.parse_mid(d), LON, ["2026-11-02"], min_hours=1)
        got = {p["hour"]: p["eur_mwh"] for p in days[0]["prices"]}
        self.assertEqual(got[10], 150.0)
        self.assertIsNone(got[11], "the 11:00 hour has one half hour only: not a price")

    def test_a_half_hour_without_volume_makes_its_hour_incomplete(self):
        d = doc(row("2026-11-02T10:00:00Z", 100, 1), row("2026-11-02T10:30:00Z", 0, 0))
        days = X.build_days(X.parse_mid(d), LON, ["2026-11-02"])
        self.assertEqual(days, [])

    def test_hours_are_by_the_london_clock_in_summer(self):
        # 2026-07-01 12:00Z is 13:00 London (BST)
        d = doc(row("2026-07-01T12:00:00Z", 50, 1), row("2026-07-01T12:30:00Z", 70, 1))
        days = X.build_days(X.parse_mid(d), LON, ["2026-07-01"], min_hours=1)
        self.assertEqual({p["hour"]: p["eur_mwh"] for p in days[0]["prices"] if p["eur_mwh"] is not None}, {13: 60.0})

    def test_a_day_counts_from_its_first_complete_hour_not_from_twelve(self):
        d = doc(row("2026-11-02T10:00:00Z", 100, 1), row("2026-11-02T10:30:00Z", 200, 1))
        days = X.build_days(X.parse_mid(d), LON, ["2026-11-02"])
        self.assertEqual(len(days), 1)
        self.assertEqual(sum(p["eur_mwh"] is not None for p in days[0]["prices"]), 1)
        self.assertEqual((X.MIN_HOURS, P.MIN_HOURS), (1, 12), "a day-ahead day needs 12 hours; today's index builds up hour by hour")
        self.assertEqual(X.build_days(X.parse_mid(d), LON, ["2026-11-02"], min_hours=2), [])

    def test_today_is_there_empty_in_the_first_hour_after_midnight_once_yesterday_is(self):
        d = doc(*[row(f"2026-11-01T{h:02d}:{m}:00Z", 100 + h, 1) for h in range(24) for m in ("00", "30")])
        days = X.build_days(X.parse_mid(d), LON, ["2026-11-01", "2026-11-02"])
        self.assertEqual([x["date"] for x in days], ["2026-11-01", "2026-11-02"])
        self.assertTrue(all(p["eur_mwh"] is None for p in days[1]["prices"]))
        self.assertEqual(len(days[1]["prices"]), 24)
        self.assertEqual(X.build_days([], LON, ["2026-11-01", "2026-11-02"]), [], "no data at all: no days, KV untouched")


class RealResponses(unittest.TestCase):
    def test_clocks_back_day_has_25_hours_and_the_repeated_hour_is_the_mean_of_four_half_hours(self):
        slots = X.parse_mid(fx("2026-10-25_fallback"))
        days = X.build_days(slots, LON, ["2026-10-25"])
        self.assertEqual([d["date"] for d in days], ["2026-10-25"])
        prices = days[0]["prices"]
        self.assertTrue(all(p["eur_mwh"] is not None for p in prices))
        self.assertEqual(sum(1 for s in slots if s[0].astimezone(__import__("zoneinfo").ZoneInfo(LON)).date().isoformat() == "2026-10-25"), 50)
        one = [p for s, _, p in slots if s.hour in (0, 1) and s.day == 25 and s.month == 10]   # 00:00Z..01:59Z = local hour 1 twice
        self.assertEqual(len(one), 4)
        self.assertAlmostEqual(prices[1]["eur_mwh"], round(sum(one) / 4, 2), places=2)

    def test_clocks_forward_day_has_no_hour_1(self):
        days = X.build_days(X.parse_mid(fx("2026-03-29_springforward")), LON, ["2026-03-29"])
        prices = days[0]["prices"]
        self.assertIsNone(prices[1]["eur_mwh"])
        self.assertEqual(sum(1 for p in prices if p["eur_mwh"] is None), 1)

    def test_partial_day_stops_at_the_last_complete_hour(self):
        days = X.build_days(X.parse_mid(fx("2026-11-02_partial")), LON, ["2026-11-01", "2026-11-02"])
        self.assertEqual([d["date"] for d in days], ["2026-11-01", "2026-11-02"])
        today = days[1]["prices"]
        # the newest half hour is 20:30Z; the 20:00 hour is complete (20:00 and 20:30), the 21:00 hour is not there yet
        self.assertIsNotNone(today[20]["eur_mwh"])
        self.assertTrue(all(p["eur_mwh"] is None for p in today[21:]))
        self.assertEqual(len([p for p in days[0]["prices"] if p["eur_mwh"] is not None]), 24)

    def test_payload_shape_and_unit(self):
        p = X.build_payload("gb", fx("2026-11-02_partial"), LON, ["2026-11-01", "2026-11-02"], "2026-11-02")
        self.assertEqual(set(p), {"zone", "generated", "trainedThrough", "unit", "days"})
        self.assertEqual((p["zone"], p["unit"], p["trainedThrough"]), ("gb", "GBP/MWh", None))
        self.assertTrue(all(d["type"] == "actual" and [q["hour"] for q in d["prices"]] == list(range(24)) for d in p["days"]))


class Job(unittest.TestCase):
    now = datetime(2026, 11, 2, 21, tzinfo=timezone.utc)

    def setUp(self):
        self.orig = (J.fetch_mid, J.B.kv_get, J.B.kv_put)
        self.puts = []
        J.fetch_mid = lambda s, e: fx("2026-11-02_partial")
        J.B.kv_put = lambda key, value, ttl, a, t: self.puts.append((key, value, ttl))

    def tearDown(self):
        J.fetch_mid, J.B.kv_get, J.B.kv_put = self.orig

    def test_zone_table_is_great_britain_only_on_the_london_clock(self):
        self.assertEqual(J.ZONES, {"gb": ("Europe/London",)})

    def test_interval_is_local_midnight_to_local_midnight_in_utc(self):
        self.assertEqual(J.interval(["2026-11-01", "2026-11-02"], LON), ("2026-11-01T00:00Z", "2026-11-03T00:00Z"))
        self.assertEqual(J.interval(["2026-07-01", "2026-07-02"], LON), ("2026-06-30T23:00Z", "2026-07-02T23:00Z"))

    def test_only_yesterday_and_today_are_asked_for(self):
        seen = []
        J.fetch_mid = lambda s, e: seen.append((s, e)) or fx("2026-11-02_partial")
        J.run_zone("gb", self.now, None, True)
        self.assertEqual(seen, [("2026-11-01T00:00Z", "2026-11-03T00:00Z")])

    def test_dry_run_writes_nothing_and_names_the_unit(self):
        line = J.run_zone("gb", self.now, None, True)
        self.assertIn("would write eu-prices-gb", line)
        self.assertIn("GBP/MWh", line)
        self.assertEqual(self.puts, [])

    def test_write_then_unchanged_write_is_skipped(self):
        J.B.kv_get = lambda k, a, t: None
        self.assertIn("wrote eu-prices-gb", J.run_zone("gb", self.now, ("a", "t"), False))
        stored = self.puts[0][1]
        self.assertEqual(self.puts[0][2], J.B.KV_TTL)
        J.B.kv_get = lambda k, a, t: stored
        self.assertIn("unchanged, no write", J.run_zone("gb", self.now, ("a", "t"), False))
        self.assertEqual(len(self.puts), 1)

    def test_no_complete_hour_leaves_kv_alone(self):
        J.fetch_mid = lambda s, e: '{"data": []}'
        self.assertIn("KV untouched", J.run_zone("gb", self.now, ("a", "t"), False))
        self.assertEqual(self.puts, [])

    def test_a_failing_fetch_is_logged_not_raised_and_the_job_exits_0(self):
        def boom(s, e):
            raise RuntimeError("Elexon HTTP 503")
        J.fetch_mid = boom
        old = J.B.load_env_file
        J.B.load_env_file = lambda: None
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                self.assertEqual(J.main(["--dry-run", "--date", "2026-11-02"]), 0)
        finally:
            J.B.load_env_file = old
        self.assertIn("FAILED (non-fatal): Elexon HTTP 503", out.getvalue())

    def test_missing_cloudflare_configuration_exits_2_before_fetching(self):
        for k in ("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"):
            os.environ.pop(k, None)
        J.fetch_mid = lambda s, e: self.fail("fetched")
        old = J.B.load_env_file
        J.B.load_env_file = lambda: None
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(J.main([]), 2)
        finally:
            J.B.load_env_file = old


class FetchBehaviour(unittest.TestCase):
    def setUp(self):
        self.sleeps = []
        self.orig = (J.urllib.request.urlopen, J.time.sleep)
        J.time.sleep = lambda s: self.sleeps.append(s)

    def tearDown(self):
        J.urllib.request.urlopen, J.time.sleep = self.orig

    def _resp(self, text):
        class R:
            def __enter__(s): return s
            def __exit__(s, *a): return False
            def read(s): return text.encode()
        return R()

    def test_request_shape_no_key_and_user_agent(self):
        seen = {}
        def urlopen(req, timeout=0):
            seen["url"], seen["ua"], seen["hdrs"] = req.full_url, req.get_header("User-agent"), dict(req.header_items())
            return self._resp("{}")
        J.urllib.request.urlopen = urlopen
        J.fetch_mid("2026-11-01T00:00Z", "2026-11-03T00:00Z")
        self.assertEqual(seen["url"], "https://data.elexon.co.uk/bmrs/api/v1/balancing/pricing/market-index?from=2026-11-01T00%3A00Z&to=2026-11-03T00%3A00Z&format=json")
        self.assertEqual(seen["ua"], "elpriser.org/1.0 (+https://elpriser.org; hello@elpriser.org)")
        self.assertFalse(any("key" in k.lower() or "authorization" in k.lower() for k in seen["hdrs"]), "BMRS needs no API key")

    def test_429_waits_for_retry_after_once_and_then_succeeds(self):
        import urllib.error
        from email.message import Message
        calls = []
        def urlopen(req, timeout=0):
            calls.append(1)
            if len(calls) == 1:
                h = Message()
                h["Retry-After"] = "20"
                raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", h, None)
            return self._resp('{"data":[]}')
        J.urllib.request.urlopen = urlopen
        self.assertEqual(J.fetch_mid("a", "b"), '{"data":[]}')
        self.assertEqual(self.sleeps, [21])

    def test_other_http_errors_and_network_errors_raise(self):
        import urllib.error
        def e500(req, timeout=0):
            raise urllib.error.HTTPError(req.full_url, 500, "x", {}, None)
        J.urllib.request.urlopen = e500
        with self.assertRaises(RuntimeError) as cm:
            J.fetch_mid("a", "b")
        self.assertIn("500", str(cm.exception))
        def net(req, timeout=0):
            raise urllib.error.URLError("down")
        J.urllib.request.urlopen = net
        with self.assertRaises(RuntimeError):
            J.fetch_mid("a", "b")


if __name__ == "__main__":
    unittest.main(verbosity=1)
