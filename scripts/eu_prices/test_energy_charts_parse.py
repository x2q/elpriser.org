#!/usr/bin/env python3
"""Unit tests for energy_charts_parse.py and build_eu_prices.py. Run: python3 scripts/eu_prices/test_energy_charts_parse.py

The fixtures in fixtures/ are REAL Energy-Charts /price responses (fetched 2026-10-26 13:33 UTC, start=2026-10-25 end=2026-10-27):
DE-LU is the whole range (Sunday 2026-10-25, the 25-hour day the clocks went back in Germany, then Monday, then Tuesday which
was already published); IT-North is the range with TOMORROW ABSENT (the API returns what exists and no error); FR and PL are
trimmed to Monday 2026-10-26. Expectations are computed here from the raw arrays by index, not by the code under test."""
import contextlib
import io
import json
import os
import sys
import unittest
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import energy_charts_parse as P

LICENSE = "CC BY 4.0 (creativecommons.org/licenses/by/4.0) from Bundesnetzagentur | SMARD.de"


def fx(name):
    with open(os.path.join(HERE, "fixtures", f"price-{name}.json"), encoding="utf-8") as f:
        return f.read()


def utc(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)


def doc(unix, price, unit="EUR / MWh"):
    return json.dumps({"license_info": LICENSE, "unix_seconds": unix, "price": price, "unit": unit, "deprecated": False})


def ts(iso):
    return int(utc(iso).timestamp())


class RealFixtures(unittest.TestCase):
    def setUp(self):
        self.de = json.loads(fx("DE-LU"))

    def test_the_fixtures_are_what_the_api_sends(self):
        for z in ("DE-LU", "FR", "PL", "IT-North"):
            d = json.loads(fx(z))
            self.assertEqual(set(d), {"license_info", "unix_seconds", "price", "unit", "deprecated"}, z)
            self.assertEqual(d["license_info"], LICENSE)
            self.assertEqual(d["unit"], "EUR / MWh")
            self.assertEqual(len(d["unix_seconds"]), len(d["price"]))
            self.assertTrue(all(b - a == 900 for a, b in zip(d["unix_seconds"], d["unix_seconds"][1:])), z)
        self.assertEqual(len(self.de["price"]), 100 + 96 + 96)           # 25 h + 24 h + 24 h of quarters
        self.assertEqual(len(json.loads(fx("IT-North"))["price"]), 100 + 96)   # tomorrow absent
        self.assertEqual(len(json.loads(fx("FR"))["price"]), 96)

    def test_slots_are_the_quarters_in_order(self):
        s = P.parse_price(fx("DE-LU"))
        self.assertEqual(len(s), 292)
        self.assertEqual(s[0], (utc("2026-10-24T22:00Z"), 15, self.de["price"][0]))
        self.assertEqual(s[-1][0], utc("2026-10-27T22:45Z"))
        self.assertTrue(all(m == 15 for _, m, _ in s))

    def test_the_25_hour_day(self):
        # Sunday 2026-10-25 in Berlin: midnight is 22:00Z, the clocks go back at 01:00Z. Quarter index i is 15*i minutes after it.
        p = self.de["price"]
        mean = lambda ix: round(sum(p[i] for i in ix) / len(ix), 2)
        d = {x["date"]: [q["eur_mwh"] for q in x["prices"]] for x in P.build_days(P.parse_price(fx("DE-LU")), "Europe/Berlin", ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"])}
        self.assertEqual(sorted(d), ["2026-10-25", "2026-10-26", "2026-10-27"], "a day without prices is absent")
        sun = d["2026-10-25"]
        self.assertEqual(len(sun), 24)
        self.assertEqual(sun[0], mean(range(0, 4)))
        self.assertEqual(sun[1], mean(range(4, 8)))
        self.assertEqual(sun[2], mean(range(8, 16)), "02:00 CEST and 02:00 CET are one wall-clock hour: both are averaged")
        self.assertEqual(sun[3], mean(range(16, 20)))
        self.assertEqual(sun[23], mean(range(96, 100)))
        # Monday starts at quarter 100 (23:00Z); Tuesday at 196.
        self.assertEqual(d["2026-10-26"][0], mean(range(100, 104)))
        self.assertEqual(d["2026-10-26"][23], mean(range(192, 196)))
        self.assertEqual(d["2026-10-27"][5], mean(range(196 + 20, 196 + 24)))
        self.assertTrue(all(v is not None for day in d.values() for v in day))

    def test_tomorrow_absent_is_not_an_error(self):
        body = fx("IT-North")
        dates = P.local_dates(utc("2026-10-26T13:34Z"), "Europe/Rome")
        self.assertEqual(dates, ["2026-10-25", "2026-10-26", "2026-10-27"])
        p = P.build_payload("it-n", body, "Europe/Rome", dates, "2026-10-26")
        self.assertEqual([d["date"] for d in p["days"]], ["2026-10-25", "2026-10-26"])
        self.assertEqual(p["zone"], "it-n")

    def test_france_and_poland_one_day(self):
        for z, tz, zone in (("FR", "Europe/Paris", "fr"), ("PL", "Europe/Warsaw", "pl")):
            d = json.loads(fx(z))["price"]
            p = P.build_payload(zone, fx(z), tz, ["2026-10-25", "2026-10-26", "2026-10-27"], "2026-10-26")
            self.assertEqual([x["date"] for x in p["days"]], ["2026-10-26"], z)
            self.assertEqual(p["days"][0]["prices"][7]["eur_mwh"], round(sum(d[28:32]) / 4, 2), z)
            self.assertEqual(len(p["days"][0]["prices"]), 24)

    def test_payload_is_the_nordic_feeds_shape(self):
        p = P.build_payload("de", fx("DE-LU"), "Europe/Berlin", ["2026-10-25", "2026-10-26", "2026-10-27"], "2026-10-26")
        self.assertEqual(list(p), ["zone", "generated", "trainedThrough", "unit", "days"])
        self.assertEqual((p["generated"], p["trainedThrough"], p["unit"]), ("2026-10-26", None, "EUR/MWh"))
        self.assertTrue(all(list(d) == ["date", "type", "prices"] and d["type"] == "actual" and [q["hour"] for q in d["prices"]] == list(range(24)) for d in p["days"]))
        self.assertLess(len(P.canonical(p)), 2600)

    def test_license_line(self):
        self.assertEqual(P.license_info(fx("PL")), LICENSE)
        self.assertEqual(P.license_info("not json"), "")


class Synthetic(unittest.TestCase):
    """What the real samples do not contain."""

    def test_hourly_resolution(self):
        t0 = ts("2026-10-26T23:00Z")                      # Berlin midnight, Tuesday 2026-10-27
        s = P.parse_price(doc([t0 + 3600 * i for i in range(24)], [100 + i for i in range(24)]))
        self.assertTrue(all(m == 60 for _, m, _ in s))
        d = P.build_days(s, "Europe/Berlin", ["2026-10-27"])[0]
        self.assertEqual([q["eur_mwh"] for q in d["prices"]], [100 + i for i in range(24)])

    def test_resolution_change_inside_a_series(self):
        # Six hourly values, then quarters: each value's step is the distance to the next timestamp.
        t0 = ts("2026-10-26T23:00Z")
        unix = [t0 + 3600 * i for i in range(6)] + [t0 + 6 * 3600 + 900 * i for i in range(72)]
        price = [10.0] * 6 + [20.0] * 72
        s = P.parse_price(doc(unix, price))
        self.assertEqual([m for _, m, _ in s[:7]], [60] * 6 + [15])
        d = P.hourly_days(s, "Europe/Berlin")["2026-10-27"]
        self.assertEqual(d[0], 10.0)
        self.assertEqual(d[6], 20.0)
        self.assertEqual(d[23], 20.0)

    def test_null_prices_are_skipped_and_an_hour_of_nulls_has_no_price(self):
        t0 = ts("2026-10-26T23:00Z")
        price = [1.0] * 96
        price[0:4] = [None] * 4                           # hour 0: nothing
        price[4] = None                                    # hour 1: three quarters of 5.0
        for i in range(5, 8):
            price[i] = 5.0
        s = P.parse_price(doc([t0 + 900 * i for i in range(96)], price))
        self.assertEqual(len(s), 96 - 5)
        d = P.build_days(s, "Europe/Berlin", ["2026-10-27"])[0]["prices"]
        self.assertIsNone(d[0]["eur_mwh"])
        self.assertEqual(d[1]["eur_mwh"], 5.0)
        self.assertEqual(d[2]["eur_mwh"], 1.0)

    def test_23_hour_day_has_a_null_hour(self):
        # Berlin 2026-03-29: clocks go forward at 02:00 CET, so local hour 2 does not exist: 23 hourly values.
        t0 = ts("2026-03-28T23:00Z")
        d = P.build_days(P.parse_price(doc([t0 + 3600 * i for i in range(23)], [(i + 1) * 10 for i in range(23)])), "Europe/Berlin", ["2026-03-29"])[0]
        got = [q["eur_mwh"] for q in d["prices"]]
        self.assertEqual(len(got), 24)
        self.assertEqual(got[:2], [10, 20])
        self.assertIsNone(got[2])
        self.assertEqual(got[3], 30)
        self.assertEqual(got[23], 230)

    def test_a_day_with_too_few_hours_is_not_published(self):
        t0 = ts("2026-10-26T23:00Z")
        s = P.parse_price(doc([t0 + 3600 * i for i in range(6)], [1.0] * 6))
        self.assertEqual(P.build_days(s, "Europe/Berlin", ["2026-10-27"]), [])

    def test_negative_prices_and_rounding(self):
        t0 = ts("2026-10-26T23:00Z")
        price = [-35.15] * 4 + [12.345, 12.345, 12.345, 12.346] + [1.0] * 88
        d = P.build_days(P.parse_price(doc([t0 + 900 * i for i in range(96)], price)), "Europe/Berlin", ["2026-10-27"])[0]["prices"]
        self.assertEqual(d[0]["eur_mwh"], -35.15)
        self.assertEqual(d[1]["eur_mwh"], round((12.345 * 3 + 12.346) / 4, 2))

    def test_empty_and_malformed_documents(self):
        self.assertEqual(P.parse_price(json.dumps({"license_info": LICENSE, "unix_seconds": None, "price": None, "unit": "EUR / MWh", "deprecated": False})), [])
        self.assertEqual(P.parse_price(doc([], [])), [])
        for bad in ("no content available", "<html>502</html>", json.dumps({"detail": "Not Found"}), json.dumps([1, 2])):
            with self.assertRaises(ValueError):
                P.parse_price(bad)
        with self.assertRaises(ValueError):
            P.parse_price(doc([0, 900], [1.0]))                       # lengths differ
        with self.assertRaises(ValueError):
            P.parse_price(doc([0, 900], [1.0, 2.0], unit="USD / MWh"))
        with self.assertRaises(ValueError):
            P.parse_price(doc([0, 1000], [1.0, 2.0]))                 # a step that is not a whole number of quarters

    def test_window_uses_the_zones_own_calendar(self):
        now = utc("2026-10-26T23:30Z")                    # already the 27th in Warsaw (UTC+1), still the 26th in London
        self.assertEqual(P.local_dates(now, "Europe/Warsaw")[1], "2026-10-27")
        self.assertEqual(P.local_dates(now, "Europe/Lisbon")[1], "2026-10-26")

    def test_body_hash_is_stable_and_sensitive(self):
        a = P.build_payload("de", fx("DE-LU"), "Europe/Berlin", ["2026-10-26"], "2026-10-26")
        b = P.build_payload("de", fx("DE-LU"), "Europe/Berlin", ["2026-10-26"], "2026-10-26")
        self.assertEqual(P.body_hash(a), P.body_hash(b))
        b["days"][0]["prices"][0]["eur_mwh"] += 0.01
        self.assertNotEqual(P.body_hash(a), P.body_hash(b))
        self.assertNotIn(" ", P.canonical(a))
        self.assertRegex(P.body_hash(a), r"^[0-9a-f]+:\d+$")


class Job(unittest.TestCase):
    """The orchestration in build_eu_prices.py with the network and KV replaced."""

    def setUp(self):
        import importlib
        import build_eu_prices as B
        self.B = importlib.reload(B)
        self.now = utc("2026-10-26T13:34Z")
        self.store, self.puts, self.calls = {}, [], []
        def fetch(bzn, start, end):
            self.calls.append((bzn, start, end))
            return fx({"DE-LU": "DE-LU", "IT-North": "IT-North", "FR": "FR", "PL": "PL"}[bzn])
        B.fetch_prices = fetch
        B.kv_get = lambda key, acct, tok: self.store.get(key)
        B.kv_put = lambda key, val, ttl, acct, tok: (self.puts.append((key, ttl)), self.store.__setitem__(key, val))
        B.load_env_file = lambda: None
        B.time.sleep = lambda s: None

    def test_zone_table_is_the_four_licensed_zones(self):
        self.assertEqual(self.B.ZONES, {"de": ("DE-LU", "Europe/Berlin"), "fr": ("FR", "Europe/Paris"), "pl": ("PL", "Europe/Warsaw"), "it-n": ("IT-North", "Europe/Rome")})

    def test_one_request_per_zone_for_yesterday_to_tomorrow_by_the_zones_calendar(self):
        self.B.run_zone("de", self.now, ("a", "b"))
        self.B.run_zone("it-n", self.now, ("a", "b"))
        self.assertEqual(self.calls, [("DE-LU", "2026-10-25", "2026-10-27"), ("IT-North", "2026-10-25", "2026-10-27")])

    def test_second_run_with_the_same_data_writes_nothing(self):
        r1 = self.B.run_zone("de", self.now, ("a", "b"))
        r2 = self.B.run_zone("de", self.now, ("a", "b"))
        self.assertIn("wrote eu-prices-de", r1)
        self.assertIn("unchanged, no write", r2)
        self.assertEqual(self.puts, [("eu-prices-de", 3 * 86400)])

    def test_changed_data_is_written_again(self):
        self.B.run_zone("de", self.now, ("a", "b"))
        d = json.loads(fx("DE-LU"))
        d["price"][150] += 1
        self.B.fetch_prices = lambda *a: json.dumps(d)
        self.B.run_zone("de", self.now, ("a", "b"))
        self.assertEqual(len(self.puts), 2)

    def test_nothing_published_leaves_kv_alone(self):
        self.B.fetch_prices = lambda *a: ""               # the API's 404
        self.assertIn("no prices", self.B.run_zone("fr", self.now, ("a", "b")))
        self.B.fetch_prices = lambda *a: doc([], [])
        self.assertIn("no prices", self.B.run_zone("fr", self.now, ("a", "b")))
        self.assertEqual(self.puts, [])

    def test_dry_run_writes_nothing_needs_no_kv_and_shows_the_licence(self):
        r = self.B.run_zone("de", self.now, None, dry=True)
        self.assertIn("would write eu-prices-de", r)
        self.assertIn("CC BY 4.0", r)
        self.assertEqual(self.puts, [])

    def test_a_failing_zone_does_not_stop_the_others_and_secrets_are_never_printed(self):
        os.environ["CLOUDFLARE_ACCOUNT_ID"] = "acct"
        os.environ["CLOUDFLARE_API_TOKEN"] = "cf-secret-456"
        def fetch(bzn, s, e):
            if bzn == "FR":
                raise RuntimeError("boom with cf-secret-456 inside")
            return fx(bzn)
        self.B.fetch_prices = fetch
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = self.B.main(["--zones", "de,fr,pl", "--date", "2026-10-26", "--pause", "0"])
        text = out.getvalue()
        self.assertEqual(code, 0)
        self.assertIn("fr: FAILED", text)
        self.assertIn("wrote eu-prices-de", text)
        self.assertIn("wrote eu-prices-pl", text)
        self.assertNotIn("cf-secret-456", text)
        self.assertIn("DONE 2/3", text)

    def test_no_entsoe_token_is_needed_or_read(self):
        os.environ.pop("ENTSOE_TOKEN", None)
        os.environ["CLOUDFLARE_ACCOUNT_ID"] = "acct"
        os.environ["CLOUDFLARE_API_TOKEN"] = "tok"
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.B.main(["--zones", "de", "--date", "2026-10-26"]), 0)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.B.main(["--zones", "de", "--date", "2026-10-26", "--dry-run"]), 0)

    def test_missing_cloudflare_configuration_exits_2_before_fetching(self):
        for k in ("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"):
            os.environ.pop(k, None)
        self.B.fetch_prices = lambda *a: self.fail("fetched without configuration")
        with contextlib.redirect_stdout(io.StringIO()) as out:
            code = self.B.main(["--zones", "de"])
        self.assertEqual(code, 2)
        self.assertIn("missing environment", out.getvalue())

    def test_unknown_zone_is_refused(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.B.main(["--zones", "ie", "--dry-run"]), 2)
            self.assertEqual(self.B.main(["--zones", "it-cn", "--dry-run"]), 2)


class FetchBehaviour(unittest.TestCase):
    """fetch_prices itself, with urllib replaced: the request, the 404, the 429."""

    def setUp(self):
        import importlib
        import build_eu_prices as B
        self.B = importlib.reload(B)
        self.sleeps = []
        B.time.sleep = lambda s: self.sleeps.append(s)
        self.orig = B.urllib.request.urlopen

    def tearDown(self):
        self.B.urllib.request.urlopen = self.orig

    def _resp(self, text):
        class R:
            def __enter__(s): return s
            def __exit__(s, *a): return False
            def read(s): return text.encode()
        return R()

    def test_request_shape_and_user_agent(self):
        seen = {}
        def urlopen(req, timeout=0):
            seen["url"], seen["ua"] = req.full_url, req.get_header("User-agent")
            return self._resp("{}")
        self.B.urllib.request.urlopen = urlopen
        self.B.fetch_prices("IT-North", "2026-10-25", "2026-10-27")
        self.assertEqual(seen["url"], "https://api.energy-charts.info/price?bzn=IT-North&start=2026-10-25&end=2026-10-27")
        self.assertEqual(seen["ua"], "elpriser.org/1.0 (+https://elpriser.org; hello@elpriser.org)")

    def test_404_is_nothing_published(self):
        import urllib.error
        def urlopen(req, timeout=0):
            raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, None)
        self.B.urllib.request.urlopen = urlopen
        self.assertEqual(self.B.fetch_prices("DE-LU", "2026-10-28", "2026-10-28"), "")

    def test_429_waits_for_retry_after_once_and_then_succeeds(self):
        import urllib.error
        from email.message import Message
        calls = []
        def urlopen(req, timeout=0):
            calls.append(1)
            if len(calls) == 1:
                h = Message()
                h["Retry-After"] = "42"
                raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", h, None)
            return self._resp('{"ok":1}')
        self.B.urllib.request.urlopen = urlopen
        self.assertEqual(self.B.fetch_prices("FR", "a", "b"), '{"ok":1}')
        self.assertEqual(self.sleeps, [43])

    def test_429_with_a_very_long_retry_after_or_twice_gives_up(self):
        import urllib.error
        from email.message import Message
        def make(sec):
            def urlopen(req, timeout=0):
                h = Message()
                h["Retry-After"] = str(sec)
                raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", h, None)
            return urlopen
        self.B.urllib.request.urlopen = make(3600)
        with self.assertRaises(RuntimeError):
            self.B.fetch_prices("FR", "a", "b")
        self.assertEqual(self.sleeps, [])
        self.B.urllib.request.urlopen = make(5)
        with self.assertRaises(RuntimeError) as cm:
            self.B.fetch_prices("FR", "a", "b")
        self.assertIn("429", str(cm.exception))
        self.assertEqual(self.sleeps, [6])

    def test_the_job_spaces_its_requests(self):
        B = self.B
        B.fetch_prices = lambda *a: ""
        os.environ["CLOUDFLARE_ACCOUNT_ID"], os.environ["CLOUDFLARE_API_TOKEN"] = "a", "b"
        B.load_env_file = lambda: None
        with contextlib.redirect_stdout(io.StringIO()):
            B.main(["--date", "2026-10-26"])
        self.assertEqual(self.sleeps, [35, 35, 35], "one request per zone, 35 s apart (the API allows 2 a minute)")


if __name__ == "__main__":
    unittest.main(verbosity=1)
