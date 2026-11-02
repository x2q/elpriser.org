package org.elpriser.app

import org.elpriser.app.data.ZoneChoice
import org.elpriser.app.data.Zones
import org.elpriser.app.ui.fold
import org.elpriser.app.ui.matchCountries
import org.elpriser.app.ui.matchNets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/** Which zone and which series the app starts with (the pure part of Settings), and the search of the place sheet. */
class ZoneChoiceTest {
    private fun resolve(stored: String? = null, onboarded: Boolean = false, area: String? = null, netArea: String? = null, device: String = "de") =
        ZoneChoice.resolve(stored, onboarded, area, netArea, device)

    // ── start zone ────────────────────────────────────────────────────────────

    @Test fun a_stored_zone_wins_over_everything() {
        assertEquals("no3", resolve(stored = "no3", onboarded = true, area = "DK2", netArea = "DK1"))
        assertEquals("se4", resolve(stored = "se4", device = "dk1"))
        assertEquals("dk2", resolve(stored = "dk2", onboarded = true, area = "DK1"))
    }

    @Test fun an_install_from_before_the_europe_release_keeps_its_danish_area() {
        // onboarded, no zone stored: it was Danish-only. The stored grid company's area, else the stored area, else DK1.
        assertEquals("dk1", resolve(onboarded = true))
        assertEquals("dk1", resolve(onboarded = true, area = "DK1"))
        assertEquals("dk2", resolve(onboarded = true, area = "DK2"))
        assertEquals("dk2", resolve(onboarded = true, area = "DK1", netArea = "DK2"))
        assertEquals("dk1", resolve(onboarded = true, area = "DK2", netArea = "DK1"))
        // whatever the phone's language is: a German-language phone with an old Danish install stays Danish
        assertEquals("dk1", resolve(onboarded = true, area = "DK1", device = "de"))
        assertEquals("dk2", resolve(onboarded = true, area = "dk2", device = "fr"))
    }

    @Test fun an_old_install_that_chose_an_area_but_never_finished_onboarding_keeps_it_too() {
        assertEquals("dk2", resolve(onboarded = false, area = "DK2", device = "de"))
        assertEquals("dk1", resolve(onboarded = false, netArea = "DK1", device = "de"))
    }

    @Test fun a_fresh_install_gets_the_devices_default() {
        assertEquals("de", resolve())
        assertEquals("no1", resolve(device = "no1"))
        assertEquals("dk1", resolve(device = "dk1"))
        assertEquals("it-n", resolve(device = "it-n"))
    }

    @Test fun an_unknown_stored_or_device_zone_falls_back_safely() {
        assertEquals("dk1", resolve(stored = "xx", onboarded = true))
        assertEquals("dk2", resolve(stored = "", onboarded = true, area = "DK2"))
        assertEquals("dk1", resolve(device = "zz"))
        assertEquals("de", resolve(stored = "nope", device = "de"))
    }

    @Test fun the_default_for_a_locale_resolves_to_a_zone_of_the_table() {
        for (l in listOf("da", "de", "fr", "pl", "xx", "en", "ja", "sr")) {
            val key = resolve(device = Zones.deviceDefault(Locale.forLanguageTag(l)).key)
            assertTrue(l, Zones.byKey(key) != null)
        }
    }

    // ── series ────────────────────────────────────────────────────────────────

    @Test fun the_danish_views_are_unchanged() {
        val dk1 = Zones.byKey("dk1")!!
        assertEquals("net_inkl_alt", ZoneChoice.mode(dk1, 0, true))
        assertEquals("inkl_alt", ZoneChoice.mode(dk1, 0, false))   // view "with grid company" falls back without one
        assertEquals("inkl_alt", ZoneChoice.mode(dk1, 1, true))
        assertEquals("spot_inkl", ZoneChoice.mode(dk1, 2, false))
        assertEquals("spot_ex", ZoneChoice.mode(dk1, 3, true))
        assertEquals("net_inkl_alt", ZoneChoice.mode(Zones.byKey("dk2")!!, 0, true))
    }

    @Test fun outside_denmark_the_view_is_ignored() {
        for (key in listOf("no1", "se3", "fi", "nl", "de", "pl", "it-n", "al")) {
            for (view in -1..4) for (net in listOf(false, true)) assertEquals("$key view $view", "zone", ZoneChoice.mode(Zones.byKey(key)!!, view, net))
        }
    }

    // ── search ────────────────────────────────────────────────────────────────

    @Test fun fold_lowercases_and_removes_accents() {
        assertEquals("osterreich", fold("Österreich"))
        assertEquals("tromso", fold(" Tromsø "))
        assertEquals("lodz", fold("Łódź"))
        assertEquals("elvaerk", fold("Elvær" + "k"))
        assertEquals("cesko", fold("Česko"))
        assertEquals("strasse", fold("Straße"))
        assertEquals("", fold("   "))
    }

    @Test fun country_search_is_case_and_accent_insensitive_in_the_users_language() {
        assertEquals(listOf("AT"), matchCountries("osterreich", Locale.GERMAN))
        assertEquals(listOf("AT"), matchCountries("ÖSTERR", Locale.GERMAN))
        assertEquals(listOf("DE"), matchCountries("tyskl", Locale("da")))
        assertEquals(listOf("DE"), matchCountries("  germany", Locale.ENGLISH))
        assertTrue(matchCountries("an", Locale.ENGLISH).containsAll(listOf("DE", "FR", "AL")))
        assertEquals(emptyList<String>(), matchCountries("", Locale.ENGLISH))
        assertEquals(emptyList<String>(), matchCountries("zzzz", Locale.ENGLISH))
        // matches come in the language's order
        val m = matchCountries("land", Locale.ENGLISH)
        assertEquals(m, Zones.countriesSorted(Locale.ENGLISH).filter { it in m })
    }

    @Test fun net_search_ignores_case_and_accents_too() {
        assertEquals(listOf("Radius"), matchNets("radius").map { it.name })
        assertEquals(listOf("Radius"), matchNets("  RADIUS ").map { it.name })
        assertTrue(matchNets("trefor").map { it.name }.containsAll(listOf("Trefor", "Trefor Øst")))
        assertTrue(matchNets("elvaerk").any { it.name == "Elværk" })
        assertTrue(matchNets("laeso").any { it.name == "Læsø Elnet" })
        assertEquals(emptyList<String>(), matchNets("").map { it.name })
        assertEquals(emptyList<String>(), matchNets("xyzzy").map { it.name })
    }
}
