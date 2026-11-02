package org.elpriser.app

import org.elpriser.app.data.Zones
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.ZoneId
import java.util.Locale

/** tests/golden/app-contract.json, the file the web test and the iOS test read too. Gradle runs unit tests with the module directory (app/) as working directory. */
object Golden {
    val json: JSONObject by lazy {
        val f = File("../../tests/golden/app-contract.json")
        assertTrue("golden file not found at ${f.absolutePath}", f.exists())
        JSONObject(f.readText())
    }

    fun strings(a: JSONArray) = List(a.length()) { a.getString(it) }
}

/** The zone table, the countries and the default-zone rule against the shared contract. */
class ZonesTest {
    private val golden = Golden.json

    @Test fun table_equals_the_contract_in_order() {
        val zs = golden.getJSONArray("zones")
        assertEquals(38, zs.length())
        assertEquals(zs.length(), Zones.all.size)
        for (i in 0 until zs.length()) {
            val c = zs.getJSONObject(i)
            val z = Zones.all[i]
            assertEquals("key $i", c.getString("key"), z.key)
            assertEquals("country ${z.key}", c.getString("country"), z.country)
            assertEquals("tz ${z.key}", c.getString("tz"), z.tz)
            assertEquals("currency ${z.key}", c.getString("currency"), z.currency)
            assertEquals("sub ${z.key}", c.getString("sub"), z.sub)
            assertEquals("city ${z.key}", if (c.isNull("city")) null else c.getString("city"), z.city)
        }
    }

    @Test fun the_30_countries_and_their_zones_equal_the_contract() {
        val cs = golden.getJSONArray("countries")
        assertEquals(30, cs.length())
        assertEquals(cs.length(), Zones.countries.size)
        for (i in 0 until cs.length()) {
            val c = cs.getJSONObject(i)
            assertEquals(c.getString("country"), Zones.countries[i])
            assertEquals(Golden.strings(c.getJSONArray("zones")), Zones.zonesOf(Zones.countries[i]).map { it.key })
        }
    }

    @Test fun every_time_zone_exists_and_only_denmark_is_danish() {
        for (z in Zones.all) assertNotNull(z.key, ZoneId.of(z.tz))
        assertEquals(listOf("dk1", "dk2"), Zones.all.filter { it.isDanish }.map { it.key })
        assertTrue(Zones.isDanish("dk2")); assertFalse(Zones.isDanish("no1")); assertFalse(Zones.isDanish(null))
        assertEquals("NO1", Zones.byKey("no1")!!.code)
        assertEquals("IT-N", Zones.byKey("it-n")!!.code)
        assertEquals(Zones.byKey("de"), Zones.byKey("DE"))
    }

    @Test fun fx_fallback_equals_the_contract() {
        val fx = golden.getJSONObject("fxFallback")
        assertEquals(fx.keys().asSequence().toSet(), Zones.FX_FALLBACK.keys)
        for (k in fx.keys()) assertEquals(k, fx.getDouble(k), Zones.FX_FALLBACK.getValue(k), 0.0)
        // every currency in the table has a fallback rate
        for (z in Zones.all) assertTrue(z.currency, z.currency in Zones.FX_FALLBACK)
    }

    @Test fun default_zone_follows_the_contract_on_every_case() {
        val cases = golden.getJSONArray("defaultZone")
        assertTrue(cases.length() > 20)
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            // region / language may be null in the contract (nothing known)
            val region = if (c.isNull("region")) null else c.getString("region")
            val language = if (c.isNull("language")) null else c.getString("language")
            assertEquals("region=$region language=$language", c.getString("expect"), Zones.defaultFor(region, language).key)
        }
        assertEquals("de", golden.getString("fallbackZone"))
        for (e in golden.getJSONObject("regionZone").keys()) assertEquals(golden.getJSONObject("regionZone").getString(e), Zones.defaultFor(e, "xx").key)
        for (e in golden.getJSONObject("languageZone").keys()) assertEquals(golden.getJSONObject("languageZone").getString(e), Zones.defaultFor("", e).key)
    }

    @Test fun default_zone_reads_the_device_locale() {
        assertEquals("dk1", Zones.deviceDefault(Locale("da", "DK")).key)
        assertEquals("at", Zones.deviceDefault(Locale("de", "AT")).key)
        assertEquals("de", Zones.deviceDefault(Locale.forLanguageTag("de")).key)
        assertEquals("de", Zones.deviceDefault(Locale.US).key)          // no country, no language of the list: Germany
        assertEquals("rs", Zones.deviceDefault(Locale.forLanguageTag("sr-Latn")).key)
        assertEquals("no1", Zones.deviceDefault(Locale.forLanguageTag("nn")).key)
        assertEquals("pl", Zones.deviceDefault(Locale("pl")).key)
    }

    @Test fun device_country_is_only_a_country_of_the_list() {
        assertEquals("DE", Zones.deviceCountry(Locale("de", "DE")))
        assertEquals(null, Zones.deviceCountry(Locale("fr", "LU")))
        assertEquals(null, Zones.deviceCountry(Locale.forLanguageTag("de")))
    }

    @Test fun country_names_resolve_in_every_shipped_language() {
        val languages = TestStrings.folders().map { if (it == "values") "en" else it.removePrefix("values-").removePrefix("b+").replace('+', '-') }
        assertTrue(languages.size >= 26)
        for (lang in languages) {
            val loc = Locale.forLanguageTag(lang)
            for (cc in Zones.countries) {
                val name = Zones.countryName(cc, loc)
                assertTrue("$cc in $lang", name.isNotBlank())
                assertNotEquals("$cc in $lang has no name, only the code", cc, name)
            }
        }
        assertEquals("Germany", Zones.countryName("DE", Locale.ENGLISH))
        assertEquals("Tyskland", Zones.countryName("DE", Locale("da")))
    }

    @Test fun countries_sort_by_the_localized_name_with_the_languages_collation() {
        val en = Zones.countriesSorted(Locale.ENGLISH).map { Zones.countryName(it, Locale.ENGLISH) }
        assertEquals(30, en.size)
        assertEquals(en.sortedWith(java.text.Collator.getInstance(Locale.ENGLISH)), en)
        assertEquals("Albania", en.first())
        // Danish puts Å, Ø, Æ after Z: Østrig (Austria) comes last, Albanien first.
        val da = Zones.countriesSorted(Locale("da")).map { Zones.countryName(it, Locale("da")) }
        assertEquals("Albanien", da.first())
        assertEquals("Østrig", da.last())
        assertEquals(30, Zones.countriesSorted(Locale("de")).toSet().size)
    }

    @Test fun chip_text_is_key_and_city_or_the_countrys_name() {
        assertEquals("NO1 · Oslo", Zones.chipText(Zones.byKey("no1")!!, Locale.ENGLISH))
        assertEquals("SE4 · Malmö", Zones.chipText(Zones.byKey("se4")!!, Locale.ENGLISH))
        assertEquals("Germany", Zones.chipText(Zones.byKey("de")!!, Locale.ENGLISH))
        assertEquals("Italien", Zones.chipText(Zones.byKey("it-n")!!, Locale("da")))
    }

    @Test fun per_kwh_literals_for_the_non_euro_sub_units() {
        assertEquals("øre/kWh", Zones.byKey("no1")!!.perKwh)
        assertEquals("öre/kWh", Zones.byKey("se3")!!.perKwh)
        assertEquals("gr/kWh", Zones.byKey("pl")!!.perKwh)
    }
}
