#!/usr/bin/env python3
"""Unit tests for semopx_parse.py and build_semopx_prices.py, on a REAL SEMOpx day-ahead result document (fixtures/
semopx_dam_20261102.json: the auction of 2 November 2026, delivery 3 November) and the real listing it was found in
(fixtures/semopx_listing_dam.json). The hourly means of the half-hour prices were checked against the ENTSO-E hourly day-ahead
prices of the same day (fixtures/entsoe_a44_ie.xml): equal to the cent. No network."""
import contextlib
import copy
import io
import json
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_semopx_prices as J   # noqa: E402
import energy_charts_parse as P   # noqa: E402
import entsoe_parse as E          # noqa: E402
import semopx_parse as S          # noqa: E402

DUB = "Europe/Dublin"


def fx(name):
    with open(os.path.join(HERE, "fixtures", name), encoding="utf-8") as f:
        return f.read()


DOC = lambda: json.loads(fx("semopx_dam_20261102.json"))
LISTING = lambda: json.loads(fx("semopx_listing_dam.json"))


def small_doc(day="2026-11-03", prices=(10, 20), auction="SEM-DA", unit="EUR", market="ROI-DA", minutes=30):
    h0 = "T23:00:00Z"
    times = ["2026-11-02T23:00:00Z", "2026-11-02T23:30:00Z", "2026-11-03T00:00:00Z"][:len(prices)]
    return {"AreaSet": [["Auction", auction]], "rows": [
        [["Market", market], ["Index prices", minutes, unit], times, list(prices), ["Index volumes", minutes], times, [1] * len(prices)]]}


class Parse(unittest.TestCase):
    def test_real_document_has_48_half_hours_from_2300z_in_euro(self):
        slots = S.parse_dam(DOC())
        self.assertEqual(len(slots), 48)
        self.assertEqual(slots[0], (datetime(2026, 11, 2, 23, tzinfo=timezone.utc), 30, 420.0))
        self.assertEqual(slots[-1][0], datetime(2026, 11, 3, 22, 30, tzinfo=timezone.utc))
        self.assertTrue(all(m == 30 for _, m, _ in slots))

    def test_the_gbp_block_is_never_read(self):
        d = DOC()
        gbp = [a for a in d["rows"][1] if isinstance(a, list) and a[:1] == ["Index prices"] and a[2] == "GBP"]
        self.assertEqual(len(gbp), 1)
        self.assertNotEqual(S.parse_dam(d)[0][2], 350.97)

    def test_roi_is_read_and_ni_only_when_roi_is_absent(self):
        d = DOC()
        self.assertEqual([r[0][1] for r in d["rows"]], ["NI-DA", "ROI-DA"])
        self.assertEqual(S.parse_dam(d), S.parse_dam({**d, "rows": d["rows"][:1]}))     # NI-DA alone gives the same one price
        only_ni = small_doc(market="NI-DA")
        self.assertEqual(len(S.parse_dam(only_ni)), 2)

    def test_text_or_parsed(self):
        self.assertEqual(S.parse_dam(fx("semopx_dam_20261102.json")), S.parse_dam(DOC()))

    def test_refusals(self):
        bad = [("not json", "<html>"), ("not a document", {"x": 1}), ("intraday", small_doc(auction="SEM-IDA1")),
               ("only gbp", small_doc(unit="GBP")), ("length mismatch", {**small_doc(), "rows": [[["Market", "ROI-DA"], ["Index prices", 30, "EUR"], ["2026-11-02T23:00:00Z"], [1, 2]]]}),
               ("odd step", small_doc(minutes=7)), ("no price arrays", {**small_doc(), "rows": [[["Market", "ROI-DA"], ["Index prices", 30, "EUR"]]]})]
        for name, d in bad:
            with self.assertRaises(ValueError, msg=name):
                S.parse_dam(d)

    def test_a_null_price_is_skipped(self):
        self.assertEqual([p for _, _, p in S.parse_dam(small_doc(prices=(5, None, 7)))], [5.0, 7.0])


class Days(unittest.TestCase):
    def test_hourly_means_by_the_dublin_clock_hour_23_waits_for_the_next_auction(self):
        p = S.build_payload("ie", [DOC()], DUB, ["2026-11-02", "2026-11-03"], "2026-11-02")
        self.assertEqual([d["date"] for d in p["days"]], ["2026-11-03"])    # Nov 2 has only its hour 23 in this file: under MIN_HOURS
        prices = p["days"][0]["prices"]
        self.assertEqual([q["hour"] for q in prices], list(range(24)))
        self.assertEqual(prices[0]["eur_mwh"], 379.5)        # (00:00Z 394.59-ish and 00:30Z halves) -> equals ENTSO-E's hour
        self.assertIsNone(prices[23]["eur_mwh"])
        self.assertEqual(sum(q["eur_mwh"] is None for q in prices), 1)

    def test_equals_the_entsoe_hourly_prices_of_the_same_day_to_the_cent(self):
        a = S.build_payload("ie", [DOC()], DUB, ["2026-11-03"], "x")["days"][0]["prices"]
        b = P.build_days(E.parse_a44(fx("entsoe_a44_ie.xml")), DUB, ["2026-11-03"])[0]["prices"]
        for x, y in zip(a, b):
            if x["eur_mwh"] is None:
                self.assertIsNone(y["eur_mwh"])
            else:
                self.assertAlmostEqual(x["eur_mwh"], y["eur_mwh"], delta=0.011, msg=f"hour {x['hour']}")

    def test_two_files_fill_the_last_hour_and_a_later_file_wins_a_shared_half_hour(self):
        d1 = DOC()
        # a second delivery day: shift every timestamp by one day
        d2 = copy.deepcopy(d1)
        for row in d2["rows"]:
            for i, el in enumerate(row):
                if isinstance(el, list) and el[:1] == ["Index prices"]:
                    row[i + 1] = [(datetime.fromisoformat(t.replace("Z", "+00:00")) + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ") for t in row[i + 1]]
        p = S.build_payload("ie", [d1, d2], DUB, ["2026-11-03", "2026-11-04"], "x")
        self.assertEqual([x["date"] for x in p["days"]], ["2026-11-03", "2026-11-04"])
        self.assertIsNotNone(p["days"][0]["prices"][23]["eur_mwh"], "hour 23 of Nov 3 comes from the file of Nov 4")
        self.assertIsNone(p["days"][1]["prices"][23]["eur_mwh"])

    def test_payload_shape_and_unit(self):
        p = S.build_payload("ie", [DOC()], DUB, ["2026-11-03"], "2026-11-02")
        self.assertEqual(set(p), {"zone", "generated", "trainedThrough", "unit", "days"})
        self.assertEqual((p["zone"], p["unit"], p["trainedThrough"]), ("ie", "EUR/MWh", None))
        self.assertTrue(all(d["type"] == "actual" for d in p["days"]))

    def test_summer_time_the_file_starts_at_2200z(self):
        d = small_doc(prices=(100, 200))
        d["rows"][0][2] = ["2026-07-01T22:00:00Z", "2026-07-01T22:30:00Z"]
        slots = S.parse_dam(d)
        days = P.build_days(slots, DUB, ["2026-07-01"], min_hours=1)
        self.assertEqual({q["hour"]: q["eur_mwh"] for q in days[0]["prices"] if q["eur_mwh"] is not None}, {23: 150.0})


class Listing(unittest.TestCase):
    def test_real_listing_parses_and_names_delivery_days(self):
        items = S.parse_listing(fx("semopx_listing_dam.json"))
        self.assertEqual(items[0]["Date"][:10], "2026-11-03")           # the auction of Nov 2 delivers Nov 3: tomorrow is in the listing
        self.assertTrue(all(i["ResourceName"].startswith(S.LIST_NAME) for i in items))

    def test_select_from_yesterday_one_file_per_delivery_day_oldest_first(self):
        got = S.select_documents(S.parse_listing(LISTING()), "2026-11-01")
        self.assertEqual([d for d, _ in got], ["2026-11-01", "2026-11-02", "2026-11-03"])
        self.assertEqual(got[-1][1], "6ae87f195c4e36b208019ded")

    def test_a_republished_day_takes_the_latest_publish_time(self):
        a = {"_id": "old", "DPuG_ID": "EA-001", "ResourceName": S.LIST_NAME + "+1_a.csv", "Date": "2026-11-03T11:00:00", "PublishTime": "2026-11-02T11:55:01"}
        b = {**a, "_id": "new", "PublishTime": "2026-11-02T12:30:00"}
        self.assertEqual(S.select_documents([a, b], "2026-11-01"), [("2026-11-03", "new")])
        self.assertEqual(S.select_documents([b, a], "2026-11-01"), [("2026-11-03", "new")])

    def test_other_reports_are_not_day_ahead_results(self):
        idc = {"_id": "x", "DPuG_ID": "EA-009", "ResourceName": "IDC_Statistics_20261101.csv", "Date": "2026-11-02", "PublishTime": "p"}
        ida = {"_id": "y", "DPuG_ID": "EA-001", "ResourceName": "MarketResult_SEM-IDA1_PWR-SEM-GB-D+1_x.csv", "Date": "2026-11-02T10:00:00", "PublishTime": "p"}
        self.assertEqual(S.select_documents([idc, ida], "2026-11-01"), [])

    def test_not_a_listing_is_an_error(self):
        for bad in ("<html>", "{}", '{"items": 3}'):
            with self.assertRaises(ValueError):
                S.parse_listing(bad)


class Job(unittest.TestCase):
    now = datetime(2026, 11, 2, 21, tzinfo=timezone.utc)

    def setUp(self):
        self.orig = (J.fetch_listing, J.fetch_document, J.B.kv_get, J.B.kv_put)
        self.puts, self.docs = [], []
        J.fetch_listing = lambda *a, **k: fx("semopx_listing_dam.json")
        def fetch_document(doc_id):
            self.docs.append(doc_id)
            return fx("semopx_dam_20261102.json")
        J.fetch_document = fetch_document
        J.B.kv_put = lambda key, value, ttl, a, t: self.puts.append((key, value, ttl))

    def tearDown(self):
        J.fetch_listing, J.fetch_document, J.B.kv_get, J.B.kv_put = self.orig

    def test_zone_table_is_ireland_on_the_dublin_clock(self):
        self.assertEqual(J.ZONES, {"ie": (DUB,)})

    def test_fetches_one_document_per_delivery_day_from_yesterday(self):
        J.run_zone("ie", self.now, None, True, pause=0)
        self.assertEqual(len(self.docs), 3)
        self.assertEqual(self.docs[-1], "6ae87f195c4e36b208019ded")

    def test_dry_run_writes_nothing(self):
        line = J.run_zone("ie", self.now, None, True, pause=0)
        self.assertIn("would write eu-prices-ie", line)
        self.assertIn("EUR/MWh", line)
        self.assertEqual(self.puts, [])

    def test_write_then_unchanged_write_is_skipped(self):
        J.B.kv_get = lambda k, a, t: None
        self.assertIn("wrote eu-prices-ie", J.run_zone("ie", self.now, ("a", "t"), False, pause=0))
        stored = self.puts[0][1]
        self.assertEqual((self.puts[0][0], self.puts[0][2]), ("eu-prices-ie", J.B.KV_TTL))
        J.B.kv_get = lambda k, a, t: stored
        self.assertIn("unchanged, no write", J.run_zone("ie", self.now, ("a", "t"), False, pause=0))
        self.assertEqual(len(self.puts), 1)

    def test_nothing_published_leaves_kv_alone(self):
        J.fetch_listing = lambda *a, **k: '{"items": []}'
        self.assertIn("KV untouched", J.run_zone("ie", self.now, ("a", "t"), False, pause=0))
        self.assertEqual(self.puts, [])

    def test_the_job_spaces_its_requests(self):
        sleeps = []
        old = J.time.sleep
        J.time.sleep = lambda s: sleeps.append(s)
        try:
            J.run_zone("ie", self.now, None, True)
        finally:
            J.time.sleep = old
        self.assertEqual(sleeps, [J.PAUSE, J.PAUSE])

    def test_a_failing_fetch_is_logged_not_raised_and_the_job_exits_0(self):
        def boom():
            raise RuntimeError("SEMOpx HTTP 503")
        J.fetch_listing = lambda *a, **k: boom()
        old = J.B.load_env_file
        J.B.load_env_file = lambda: None
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                self.assertEqual(J.main(["--dry-run", "--date", "2026-11-02"]), 0)
        finally:
            J.B.load_env_file = old
        self.assertIn("FAILED (non-fatal): SEMOpx HTTP 503", out.getvalue())

    def test_missing_cloudflare_configuration_exits_2_before_fetching(self):
        for k in ("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"):
            os.environ.pop(k, None)
        J.fetch_listing = lambda *a, **k: self.fail("fetched")
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

    def test_request_shapes_user_agent_and_no_credentials(self):
        seen = []
        def urlopen(req, timeout=0):
            seen.append((req.full_url, req.get_header("User-agent"), dict(req.header_items())))
            return self._resp("{}")
        J.urllib.request.urlopen = urlopen
        J.fetch_listing()
        J.fetch_document("6ae87f195c4e36b208019ded")
        self.assertEqual(seen[0][0], "https://reports.semopx.com/api/v1/documents/static-reports?DPuG_ID=EA-001&ResourceName=MarketResult_SEM-DA_PWR-MRC-D"
                                     "&ExcludeDelayedPublication=0&sort_by=Date&order_by=DESC&page_size=12")
        self.assertEqual(seen[1][0], "https://reports.semopx.com/api/v1/documents/6ae87f195c4e36b208019ded")
        for _, ua, hdrs in seen:
            self.assertEqual(ua, "elpriser.org/1.0 (+https://elpriser.org; hello@elpriser.org)")
            self.assertFalse(any("authorization" in k.lower() or "key" in k.lower() for k in hdrs))

    def test_429_waits_for_retry_after_once_then_succeeds_and_twice_gives_up(self):
        import urllib.error
        from email.message import Message
        calls = []
        def once(req, timeout=0):
            calls.append(1)
            if len(calls) == 1:
                h = Message()
                h["Retry-After"] = "9"
                raise urllib.error.HTTPError(req.full_url, 429, "x", h, None)
            return self._resp("{}")
        J.urllib.request.urlopen = once
        self.assertEqual(J._get("https://x"), "{}")
        self.assertEqual(self.sleeps, [10])
        def always(req, timeout=0):
            h = Message()
            h["Retry-After"] = "5"
            raise urllib.error.HTTPError(req.full_url, 429, "x", h, None)
        J.urllib.request.urlopen = always
        with self.assertRaises(RuntimeError):
            J._get("https://x")
        def too_long(req, timeout=0):
            h = Message()
            h["Retry-After"] = "3600"
            raise urllib.error.HTTPError(req.full_url, 429, "x", h, None)
        J.urllib.request.urlopen = too_long
        with self.assertRaises(RuntimeError):
            J._get("https://x")

    def test_other_errors_raise(self):
        import urllib.error
        def e404(req, timeout=0):
            raise urllib.error.HTTPError(req.full_url, 404, "x", {}, None)
        J.urllib.request.urlopen = e404
        with self.assertRaises(RuntimeError) as cm:
            J._get("https://x")
        self.assertIn("404", str(cm.exception))


if __name__ == "__main__":
    unittest.main(verbosity=1)
