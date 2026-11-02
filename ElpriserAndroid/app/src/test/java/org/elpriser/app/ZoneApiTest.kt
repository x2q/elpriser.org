package org.elpriser.app

import org.elpriser.app.data.Api
import org.elpriser.app.data.Day
import org.elpriser.app.data.Zones
import org.elpriser.app.data.daysFrom
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The /api/nordic parser (parseZone) and the day cut (daysFrom) against tests/golden/app-contract.json, the same cases the web and iOS test. */
class ZoneApiTest {
    private val golden = Golden.json

    private fun doubles(a: JSONArray) = List(a.length()) { a.getDouble(it) }
    private fun nullable(a: JSONArray?) = a?.let { List(it.length()) { i -> if (it.isNull(i)) null else it.getDouble(i) } }

    private fun assertClose(msg: String, expect: List<Double?>, actual: List<Double>) {
        assertEquals("$msg size", expect.size, actual.size)
        for (i in expect.indices) {
            val e = expect[i]
            // the app keeps NaN where the contract says null (an hour without a band)
            if (e == null) assertTrue("$msg[$i] should be missing", actual[i].isNaN())
            else assertEquals("$msg[$i]", e, actual[i], 1e-6)
        }
    }

    @Test fun every_contract_response_parses_to_the_expected_days() {
        val cases = golden.getJSONArray("zoneResponses")
        assertTrue(cases.length() >= 3)
        for (c in 0 until cases.length()) {
            val case = cases.getJSONObject(c)
            val resp = case.getJSONObject("response")
            val expect = case.getJSONObject("expect")
            val zone = Zones.byKey(resp.getString("zone"))!!
            val parsed = Api.parseZone(resp, zone)
            val tag = "case $c (${zone.key})"
            assertEquals(zone.key, parsed.area)
            assertEquals("zone", parsed.mode)
            val days = expect.getJSONArray("days")
            assertEquals("$tag days kept", days.length(), parsed.days.size)
            for (i in 0 until days.length()) {
                val e = days.getJSONObject(i)
                val d = parsed.days[i]
                assertEquals("$tag date", e.getString("date"), d.date)
                assertEquals("$tag actual ${d.date}", e.getBoolean("actual"), d.actual)
                assertClose("$tag price ${d.date}", doubles(e.getJSONArray("price")), d.price)
                if (e.isNull("lo")) { assertNull("$tag lo ${d.date}", d.lo); assertNull("$tag hi ${d.date}", d.hi) } else {
                    assertNotNull("$tag lo ${d.date}", d.lo)
                    assertClose("$tag lo ${d.date}", nullable(e.getJSONArray("lo"))!!, d.lo!!)
                    assertClose("$tag hi ${d.date}", nullable(e.getJSONArray("hi"))!!, d.hi!!)
                }
                assertNull(d.gridTariff)
            }
        }
    }

    @Test fun the_rate_comes_from_the_response_or_the_fallback_table() {
        val cases = golden.getJSONArray("zoneResponses")
        val no = cases.getJSONObject(0)
        val pl = cases.getJSONObject(2)
        // NO1: rate 10.84 in zoneInfo; 60 EUR/MWh -> 65.04 øre/kWh
        assertEquals(65.04, Api.parseZone(no.getJSONObject("response"), Zones.byKey("no1")!!).days[1].price[0], 1e-9)
        // PL: no rate in zoneInfo -> the fallback 4.39: 90 EUR/MWh -> 39.51 gr/kWh
        assertEquals(39.51, Api.parseZone(pl.getJSONObject("response"), Zones.byKey("pl")!!).days[0].price[0], 1e-9)
        // a rate of 0 (or missing zoneInfo altogether) falls back too; EUR is 1
        val noInfo = JSONObject("""{"zone":"se3","days":[{"date":"2026-10-10","type":"actual","prices":${hours { """{"hour":$it,"eur_mwh":100}""" }}}]}""")
        assertEquals(112.9, Api.parseZone(noInfo, Zones.byKey("se3")!!).days[0].price[0], 1e-9)
        val zeroRate = JSONObject("""{"zone":"se3","zoneInfo":{"currency":"SEK","rate":0},"days":[{"date":"2026-10-10","type":"actual","prices":${hours { """{"hour":$it,"eur_mwh":100}""" }}}]}""")
        assertEquals(112.9, Api.parseZone(zeroRate, Zones.byKey("se3")!!).days[0].price[0], 1e-9)
        val eur = JSONObject("""{"zone":"de","zoneInfo":{"currency":"EUR"},"days":[{"date":"2026-10-10","type":"actual","prices":${hours { """{"hour":$it,"eur_mwh":123.4}""" }}}]}""")
        assertEquals(12.34, Api.parseZone(eur, Zones.byKey("de")!!).days[0].price[5], 1e-9)
    }

    private fun hours(count: Int = 24, make: (Int) -> String) = (0 until count).joinToString(",", "[", "]") { make(it) }

    @Test fun only_complete_days_count_and_null_prices_make_a_day_incomplete() {
        val nullHour = JSONObject("""{"zone":"de","zoneInfo":{"currency":"EUR","rate":1},"days":[
            {"date":"2026-10-10","type":"actual","prices":${hours { if (it == 7) """{"hour":7,"eur_mwh":null}""" else """{"hour":$it,"eur_mwh":10}""" }}},
            {"date":"2026-10-11","type":"actual","prices":${hours { """{"hour":$it,"eur_mwh":10}""" }}},
            {"date":"2026-10-12","type":"actual","prices":${hours(23) { """{"hour":$it,"eur_mwh":10}""" }}}
        ]}""".replace("\n", ""))
        val p = Api.parseZone(nullHour, Zones.byKey("de")!!)
        assertEquals(listOf("2026-10-11"), p.days.map { it.date })
        // a response without days is an empty series, not a crash
        assertTrue(Api.parseZone(JSONObject("""{"zone":"de"}"""), Zones.byKey("de")!!).days.isEmpty())
    }

    @Test fun the_band_needs_both_ends_and_actual_is_the_days_type() {
        val j = JSONObject("""{"zone":"nl","zoneInfo":{"currency":"EUR","rate":1},"days":[
            {"date":"2026-10-10","type":"actual","prices":${hours { """{"hour":$it,"eur_mwh":50,"min_eur_mwh":40}""" }}},
            {"date":"2026-10-11","type":"forecast","prices":${hours { """{"hour":$it,"eur_mwh":50,"min_eur_mwh":40,"max_eur_mwh":70}""" }}}
        ]}""".replace("\n", ""))
        val p = Api.parseZone(j, Zones.byKey("nl")!!)
        assertTrue(p.days[0].actual); assertNull(p.days[0].lo)
        assertFalse(p.days[1].actual)
        assertEquals(4.0, p.days[1].lo!![3], 1e-9); assertEquals(7.0, p.days[1].hi!![3], 1e-9)
    }

    @Test fun days_from_cuts_at_today_and_stays_consecutive() {
        val cases = golden.getJSONArray("zoneDays")
        assertEquals(4, cases.length())
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val days = Golden.strings(c.getJSONArray("dates")).map { Day(it, true, List(24) { 1.0 }, null, null) }
            assertEquals("case $i", Golden.strings(c.getJSONArray("expect")), daysFrom(days, c.getString("today")).map { it.date })
        }
    }

    @Test fun days_from_sorts_a_shuffled_feed_and_handles_month_ends() {
        fun d(date: String) = Day(date, true, List(24) { 1.0 }, null, null)
        assertEquals(listOf("2026-10-31", "2026-11-01"), daysFrom(listOf(d("2026-11-01"), d("2026-10-30"), d("2026-10-31")), "2026-10-31").map { it.date })
        assertEquals(emptyList<String>(), daysFrom(emptyList(), "2026-10-31").map { it.date })
        // a hole on the first day: tomorrow must not become today
        assertEquals(emptyList<String>(), daysFrom(listOf(d("2026-10-12"), d("2026-10-13")), "2026-10-11").map { it.date })
    }
}
