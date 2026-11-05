#!/usr/bin/env python3
"""Unit tests for entsoe_parse.py and build_entsoe_prices.py, on REAL Transparency Platform responses (fixtures/
entsoe_a44_*.xml, fetched 2026-11-02): Spain (day-ahead A01 AND intraday A07 in one document, A03 blocks), Hungary (a
day of 95 Points for 96 quarter hours), Ireland (hourly), and the 'nothing in this range' acknowledgement. No network."""
import os
import sys
import unittest
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_entsoe_prices as J   # noqa: E402
import energy_charts_parse as P   # noqa: E402
import entsoe_parse as E          # noqa: E402


def fx(name):
    with open(os.path.join(HERE, "fixtures", f"entsoe_a44_{name}.xml"), encoding="utf-8") as f:
        return f.read()


def doc(ts_xml, extra=""):
    return ('<?xml version="1.0"?><Publication_MarketDocument xmlns="urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3">'
            + ts_xml + "</Publication_MarketDocument>")


def series(agreement="A01", cur="EUR", unit="MWH", res="PT60M", start="2026-11-01T23:00Z", end="2026-11-02T01:00Z", pts=((1, 10), (2, 20))):
    p = "".join(f"<Point><position>{i}</position><price.amount>{v}</price.amount></Point>" for i, v in pts)
    return (f"<TimeSeries><contract_MarketAgreement.type>{agreement}</contract_MarketAgreement.type><curveType>A03</curveType>"
            f"<currency_Unit.name>{cur}</currency_Unit.name><price_Measure_Unit.name>{unit}</price_Measure_Unit.name>"
            f"<Period><timeInterval><start>{start}</start><end>{end}</end></timeInterval><resolution>{res}</resolution>{p}</Period></TimeSeries>")


class Parse(unittest.TestCase):
    def test_no_data_is_empty_not_an_error(self):
        self.assertEqual(E.parse_a44(fx("nodata")), [])

    def test_other_acknowledgement_is_an_error(self):
        bad = fx("nodata").replace("<code>999</code>", "<code>401</code>")
        if "<code>401</code>" not in bad:
            self.skipTest("fixture carries no reason code element")
        with self.assertRaises(ValueError):
            E.parse_a44(bad)

    def test_not_xml_and_not_a_price_document(self):
        with self.assertRaises(ValueError):
            E.parse_a44("<html>")
        with self.assertRaises(ValueError):
            E.parse_a44("<Foo/>")

    def test_only_day_ahead_counts_intraday_is_ignored(self):
        x = doc(series("A01", pts=((1, 10), (2, 20))) + series("A07", pts=((1, 999), (2, 999))))
        self.assertEqual([p for _, _, p in E.parse_a44(x)], [10.0, 20.0])

    def test_a03_missing_positions_repeat_the_price_before(self):
        x = doc(series(res="PT15M", end="2026-11-02T00:00Z", pts=((1, 5), (3, 7))))
        got = E.parse_a44(x)
        self.assertEqual([p for _, _, p in got], [5.0, 5.0, 7.0, 7.0])
        self.assertTrue(all(m == 15 for _, m, _ in got))

    def test_nothing_before_the_first_point(self):
        x = doc(series(res="PT15M", end="2026-11-02T00:00Z", pts=((3, 7),)))
        self.assertEqual([p for _, _, p in E.parse_a44(x)], [7.0, 7.0])

    def test_two_series_for_the_same_start_the_later_wins(self):
        x = doc(series(pts=((1, 1), (2, 2))) + series(pts=((1, 8), (2, 9))))
        self.assertEqual([p for _, _, p in E.parse_a44(x)], [8.0, 9.0])

    def test_foreign_currency_or_unit_is_refused(self):
        for kw in ({"cur": "CZK"}, {"unit": "KWH"}):
            with self.assertRaises(ValueError):
                E.parse_a44(doc(series(**kw)))

    def test_unknown_resolution_is_refused(self):
        with self.assertRaises(ValueError):
            E.parse_a44(doc(series(res="PT7M")))


class RealResponses(unittest.TestCase):
    def test_spain_has_two_day_ahead_days_and_the_intraday_is_not_in_them(self):
        slots = E.parse_a44(fx("es"))
        self.assertEqual(len(slots), 2 * 96)           # 2026-11-02 and 2026-11-03 local, quarter-hourly, A01 only
        self.assertTrue(all(m == 15 for _, m, _ in slots))
        days = P.build_days(slots, "Europe/Madrid", ["2026-11-02", "2026-11-03"])
        self.assertEqual([d["date"] for d in days], ["2026-11-02", "2026-11-03"])
        self.assertTrue(all(len(d["prices"]) == 24 and all(p["eur_mwh"] is not None for p in d["prices"]) for d in days))

    def test_hungary_95_points_make_96_quarter_hours(self):
        slots = E.parse_a44(fx("hu"))
        self.assertEqual(len(slots), 96)
        d = P.build_days(slots, "Europe/Budapest", ["2026-11-02"])
        self.assertEqual(len(d), 1)
        self.assertTrue(all(p["eur_mwh"] is not None for p in d[0]["prices"]))

    def test_ireland_is_hourly_for_two_days(self):
        slots = E.parse_a44(fx("ie"))
        self.assertEqual((len(slots), {m for _, m, _ in slots}), (48, {60}))
        d = P.build_days(slots, "Europe/Dublin", ["2026-11-02", "2026-11-03"])
        self.assertEqual([x["date"] for x in d], ["2026-11-02", "2026-11-03"])

    def test_kosovo_is_hourly_day_ahead_in_euro_for_three_days(self):
        slots = E.parse_a44(fx("xk"))           # EIC 10Y1001C--00100H, fetched 2026-11-02 21:01Z: 1, 2 and 3 November
        self.assertEqual((len(slots), {m for _, m, _ in slots}), (72, {60}))
        d = P.build_days(slots, J.ZONES["xk"][1], ["2026-11-01", "2026-11-02", "2026-11-03"])
        self.assertEqual([x["date"] for x in d], ["2026-11-01", "2026-11-02", "2026-11-03"])
        self.assertTrue(all(p["eur_mwh"] is not None for x in d for p in x["prices"]))
        p = E.build_payload("xk", fx("xk"), J.ZONES["xk"][1], ["2026-11-01", "2026-11-02", "2026-11-03"], "2026-11-02")
        self.assertEqual((p["zone"], p["unit"]), ("xk", "EUR/MWh"))

    def test_netherlands_is_a_nordic_overlay_zone_with_two_full_cet_days(self):
        # NL is served from the Nordic feed (nordic-forecast-nl); this job only supplies the settled days laid over it. Real response,
        # fetched 2026-11-03 03:02Z: 2 and 3 November, 15-minute prices, Amsterdam's clock (CET from 2026-10-25, UTC+1).
        self.assertNotIn("nl", J.ZONES)                       # ZONES is pinned to the API's EU_ZONES_ENTSOE (no Nordic feed)
        self.assertIn("nl", J.NORDIC_OVERLAY)
        self.assertEqual(J.ALL_ZONES["nl"], ("10YNL----------L", "Europe/Amsterdam"))
        slots = E.parse_a44(fx("nl"))
        self.assertEqual((len(slots), {m for _, m, _ in slots}), (192, {15}))
        p = E.build_payload("nl", fx("nl"), J.ALL_ZONES["nl"][1], ["2026-11-01", "2026-11-02", "2026-11-03"], "2026-11-03")
        self.assertEqual([d["date"] for d in p["days"]], ["2026-11-02", "2026-11-03"])      # 1 November is outside the request: absent, not invented
        self.assertTrue(all(d["type"] == "actual" and [q["hour"] for q in d["prices"]] == list(range(24))
                            and all(q["eur_mwh"] is not None for q in d["prices"]) for d in p["days"]))
        # hour 0 of 3 November is the mean of the first four quarter-hours, which start at 2026-11-02T23:00Z
        first = [pr for t, m, pr in slots if t == datetime(2026, 11, 2, 23, tzinfo=timezone.utc)
                 or (0 < (t - datetime(2026, 11, 2, 23, tzinfo=timezone.utc)).total_seconds() < 3600)]
        self.assertEqual(len(first), 4)
        self.assertAlmostEqual(p["days"][1]["prices"][0]["eur_mwh"], round(sum(first) / 4, 2), places=2)

    def test_netherlands_keeps_the_dst_days_whole(self):
        # 25 October 2026 has 25 hours in Amsterdam, as in Copenhagen (the Nordic job): local hour 2 is the mean of both, 24 hours, none null.
        from datetime import timedelta
        start = datetime(2026, 10, 24, 22, tzinfo=timezone.utc)
        slots = [(start + timedelta(hours=i), 60, float(i)) for i in range(25)]
        d = P.build_days(slots, J.ALL_ZONES["nl"][1], ["2026-10-25"])[0]
        self.assertEqual([q["hour"] for q in d["prices"]], list(range(24)))
        self.assertEqual(d["prices"][2]["eur_mwh"], 2.5)
        # 29 March 2026: 23 hours, local hour 2 does not exist and is null
        start = datetime(2026, 3, 28, 23, tzinfo=timezone.utc)
        slots = [(start + timedelta(hours=i), 60, float(i)) for i in range(23)]
        d = P.build_days(slots, J.ALL_ZONES["nl"][1], ["2026-03-29"])[0]
        self.assertIsNone(d["prices"][2]["eur_mwh"])
        self.assertEqual(sum(1 for q in d["prices"] if q["eur_mwh"] is not None), 23)

    def test_dry_run_of_the_netherlands_writes_eu_prices_nl(self):
        old = J.fetch_a44
        J.fetch_a44 = lambda token, eic, s, e: fx("nl")
        try:
            line = J.run_zone("nl", datetime(2026, 11, 3, 3, tzinfo=timezone.utc), "SECRETTOKEN", None, True)
        finally:
            J.fetch_a44 = old
        self.assertIn("nl: 2026-11-02 (24 h), 2026-11-03 (24 h)", line)
        self.assertIn("would write eu-prices-nl", line)
        self.assertNotIn("SECRETTOKEN", line)

    def test_ireland_is_no_longer_a_zone_of_this_job(self):
        self.assertNotIn("ie", J.ZONES)         # build_semopx_prices.py writes eu-prices-ie (the SEMOpx day-ahead results)
        self.assertIn("xk", J.ZONES)

    def test_payload_shape_is_the_energy_charts_zones(self):
        p = E.build_payload("ie", fx("ie"), "Europe/Dublin", ["2026-11-02", "2026-11-03"], "2026-11-02")
        self.assertEqual(set(p), {"zone", "generated", "trainedThrough", "unit", "days"})
        self.assertEqual((p["zone"], p["unit"], p["trainedThrough"]), ("ie", "EUR/MWh", None))
        self.assertTrue(all(d["type"] == "actual" and [q["hour"] for q in d["prices"]] == list(range(24)) for d in p["days"]))


class Job(unittest.TestCase):
    def test_interval_is_local_midnight_to_local_midnight_in_utc(self):
        self.assertEqual(J.interval(["2026-11-01", "2026-11-02", "2026-11-03"], "Europe/Madrid"), ("202610312300", "202611032300"))
        self.assertEqual(J.interval(["2026-07-01", "2026-07-03"], "Europe/Dublin"), ("202606302300", "202607032300"))

    def test_every_zone_has_an_eic_and_a_real_timezone(self):
        from zoneinfo import ZoneInfo
        for z, (eic, tz) in J.ALL_ZONES.items():
            self.assertRegex(eic, r"^10Y[0-9A-Z-]{12}[0-9A-Z]$", z)
            ZoneInfo(tz)

    def test_dry_run_of_one_zone_and_the_token_is_never_in_the_status(self):
        old = J.fetch_a44
        J.fetch_a44 = lambda token, eic, s, e: fx("xk")
        try:
            line = J.run_zone("xk", datetime(2026, 11, 2, 12, tzinfo=timezone.utc), "SECRETTOKEN", None, True)
        finally:
            J.fetch_a44 = old
        self.assertIn("would write eu-prices-xk", line)
        self.assertNotIn("SECRETTOKEN", line)

    def test_a_zone_without_prices_leaves_kv_alone(self):
        old = J.fetch_a44
        J.fetch_a44 = lambda token, eic, s, e: fx("nodata")
        try:
            line = J.run_zone("xk", datetime(2026, 11, 2, 12, tzinfo=timezone.utc), "x", ("acc", "tok"), False)
        finally:
            J.fetch_a44 = old
        self.assertIn("KV untouched", line)

    def _run(self, zone, xml, dry=False):
        import build_eu_prices as B
        store, puts = {}, []
        saved = (J.fetch_a44, B.kv_get, B.kv_put)
        J.fetch_a44 = lambda token, eic, s, e: xml
        B.kv_get = lambda key, acct, tok: store.get(key)
        B.kv_put = lambda key, val, ttl, acct, tok: (puts.append(key), store.__setitem__(key, val))
        try:
            line = J.run_zone(zone, datetime(2026, 11, 2, 12, tzinfo=timezone.utc), "tok", None if dry else ("acc", "cf"), dry)
        finally:
            J.fetch_a44, B.kv_get, B.kv_put = saved
        return line, store, puts

    def test_a_quarter_hourly_zone_writes_its_15_minute_prices_next_to_the_hourly_ones(self):
        line, store, puts = self._run("nl", fx("nl"))
        self.assertEqual(puts, ["eu-slots-nl", "eu-prices-nl"])
        rec = store["eu-slots-nl"]
        self.assertTrue(rec["slots"] and all(r[1] == 15 for r in rec["slots"]))
        self.assertIn("wrote eu-slots-nl", line)

    def test_an_hourly_zone_writes_no_15_minute_record(self):
        line, store, puts = self._run("xk", fx("xk"))
        self.assertEqual(puts, ["eu-prices-xk"])
        self.assertNotIn("eu-slots", line)

    def test_nordic_zones_get_only_their_15_minute_prices_written_here(self):
        # The hourly prices of dk1, no1, se3, fi ... are the Nordic job's (nordic-forecast-<zone>): this job must never write an eu-prices key for them.
        for z in ("dk1", "dk2", "no1", "no5", "se1", "se4", "fi"):
            line, store, puts = self._run(z, fx("nl"))
            self.assertEqual(puts, [f"eu-slots-{z}"], z)
            self.assertIn("not ours", line)
        self.assertEqual(set(J.NORDIC_SLOTS_ONLY), {"dk1", "dk2", "no1", "no2", "no3", "no4", "no5", "se1", "se2", "se3", "se4", "fi"})
        self.assertTrue(not set(J.NORDIC_SLOTS_ONLY) & set(J.ZONES), "an EU zone is never also a slots-only Nordic zone")

    def test_dry_run_names_the_15_minute_key(self):
        line, store, puts = self._run("dk1", fx("nl"), dry=True)
        self.assertIn("would write eu-slots-dk1", line)
        self.assertEqual(puts, [])

    def test_missing_environment_exits_2_before_any_fetch(self):
        for k in ("ENTSOE_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"):
            os.environ.pop(k, None)
        old = J.B.load_env_file
        J.B.load_env_file = lambda: None
        try:
            self.assertEqual(J.main(["--dry-run"]), 2)
            os.environ["ENTSOE_TOKEN"] = "x"
            self.assertEqual(J.main(["--dry-run", "--zones", "xx"]), 2)
        finally:
            J.B.load_env_file = old
            os.environ.pop("ENTSOE_TOKEN", None)


if __name__ == "__main__":
    unittest.main()
