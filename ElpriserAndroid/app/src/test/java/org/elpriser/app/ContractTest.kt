package org.elpriser.app

import org.elpriser.app.data.Api
import org.elpriser.app.data.Day
import org.elpriser.app.data.Nets
import org.elpriser.app.ui.cheapestWindow
import org.elpriser.app.ui.dayLong
import org.elpriser.app.ui.dayMonth
import org.elpriser.app.ui.dayShort
import org.elpriser.app.ui.verdict
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Checks this app's copies of the shared logic against tests/golden/app-contract.json,
 * the same file the web test and the iOS test read. If one of them drifts, its own
 * suite goes red instead of the apps quietly disagreeing about a price or a net.
 */
class ContractTest {
    private val golden: JSONObject = run {
        // Gradle runs unit tests with the module directory (app/) as working directory.
        val f = File("../../tests/golden/app-contract.json")
        assertTrue("golden file not found at ${f.absolutePath}", f.exists())
        JSONObject(f.readText())
    }

    private fun doubles(a: JSONArray) = List(a.length()) { a.getDouble(it) }
    private fun nullableDoubles(a: JSONArray?) = a?.let { List(it.length()) { i -> if (it.isNull(i)) null else it.getDouble(i) } }

    @Test fun netListMatchesTheWebList() {
        val nets = golden.getJSONArray("nets")
        assertEquals(nets.length(), Nets.all.size)
        for (i in 0 until nets.length()) {
            val n = nets.getJSONObject(i)
            val mine = Nets.all[i]
            assertEquals(n.getString("name"), mine.name)
            assertEquals(n.getString("gln"), mine.gln)
            assertEquals(n.getString("area"), mine.area)
            assertEquals(List(n.getJSONArray("match").length()) { n.getJSONArray("match").getString(it) }, mine.match)
        }
    }

    @Test fun grid_company_names_resolve_to_the_same_net() {
        val cases = golden.getJSONArray("matchCases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val input = if (c.isNull("input")) null else c.getString("input")
            val expect = if (c.isNull("expect")) null else c.getString("expect")
            assertEquals("match(${input})", expect, Nets.match(input)?.name)
        }
    }

    @Test fun cheapestWindowAgrees() {
        val cases = golden.getJSONArray("cheapestWindow")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val w = cheapestWindow(doubles(c.getJSONArray("vals")), c.getInt("n"), c.getBoolean("highest"))
            val e = c.getJSONObject("expect")
            assertEquals("case $i start", e.getInt("s"), w.s)
            assertEquals("case $i end", e.getInt("e"), w.e)
            assertEquals("case $i avg", e.getDouble("avg"), w.avg, 1e-9)
            assertEquals("case $i label", e.getString("label"), w.label)
        }
    }

    @Test fun verdictAgrees() {
        val cases = golden.getJSONArray("verdict")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val v = verdict(c.getDouble("price"), doubles(c.getJSONArray("vals")))
            val e = c.getJSONObject("expect")
            assertEquals("case $i kind", e.getInt("kind"), v.kind)
            assertEquals("case $i label", e.getString("label"), v.label)
        }
    }

    @Test fun dayNamesAgree() {
        val cases = golden.getJSONArray("dayNames")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val d = Day(c.getString("date"), true, List(24) { 1.0 }, null, null)
            assertEquals(c.getString("short"), dayShort(d))
            assertEquals(c.getString("month"), dayMonth(d))
            assertEquals(c.getString("long"), dayLong(d))
        }
    }

    @Test fun forecastParsingAgrees() {
        val f = golden.getJSONObject("forecast")
        val parsed = Api.parseForecast(f.getJSONObject("response"), "DK1", "net_inkl_alt")
        val expect = f.getJSONObject("expect")
        val days = expect.getJSONArray("days")
        assertEquals("days kept", days.length(), parsed.days.size)
        for (i in 0 until days.length()) {
            val e = days.getJSONObject(i)
            val d = parsed.days[i]
            assertEquals(e.getString("date"), d.date)
            assertEquals(e.getBoolean("actual"), d.actual)
            assertEquals(doubles(e.getJSONArray("price")), d.price)
            val lo = nullableDoubles(e.optJSONArray("lo"))
            val hi = nullableDoubles(e.optJSONArray("hi"))
            if (e.isNull("lo")) { assertNull(d.lo); assertNull(d.hi) } else {
                assertNotNull(d.lo)
                // The app keeps NaN where the API gave no band for an hour; the contract says null.
                assertEquals(lo, d.lo!!.map { if (it.isNaN()) null else it })
                assertEquals(hi, d.hi!!.map { if (it.isNaN()) null else it })
            }
        }
        assertEquals(expect.getString("model"), parsed.model)
    }

    @Test fun co2ParsingAgrees() {
        val c = golden.getJSONObject("co2")
        val parsed = Api.parseCo2(c.getJSONObject("response"))
        val expect = c.getJSONObject("expect")
        assertEquals(expect.keys().asSequence().toSet(), parsed.keys)
        for (k in expect.keys()) {
            assertEquals(List(24) { expect.getJSONArray(k).getInt(it) }, parsed[k])
        }
    }
}
