package org.elpriser.app

import org.elpriser.app.data.Day
import org.elpriser.app.data.Zones
import org.elpriser.app.ui.PriceUnit
import org.elpriser.app.ui.axisFor
import org.elpriser.app.ui.axisForSubUnit
import org.elpriser.app.ui.cheaperSentence
import org.elpriser.app.ui.priceCaption
import org.elpriser.app.ui.tooltipText
import org.elpriser.app.ui.zoneNote
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/** The unit of a price (kr/kWh in Denmark, the sub-unit per kWh elsewhere) and the axis for sub-unit values. */
class PriceUnitTest {
    @get:Rule val locale = LocaleRule(DANISH)

    private val da = TestStrings.da
    private val en = TestStrings.en
    private val no1 = PriceUnit.of(Zones.byKey("no1")!!)
    private val se3 = PriceUnit.of(Zones.byKey("se3")!!)
    private val pl = PriceUnit.of(Zones.byKey("pl")!!)
    private val de = PriceUnit.of(Zones.byKey("de")!!)

    @Test fun the_danish_zones_keep_the_krone_with_two_decimals() {
        for (key in listOf("dk1", "dk2")) {
            val u = PriceUnit.of(Zones.byKey(key)!!)
            assertEquals(PriceUnit.Kroner, u)
            assertEquals(2, u.decimals)
        }
        assertEquals("3,90 kr/kWh", PriceUnit.Kroner.withUnit(da, 3.9))
        assertEquals("3,90 kr", PriceUnit.Kroner.amount(da, 3.9))
        assertEquals("kr", PriceUnit.Kroner.short(da))
        assertEquals("3.90 DKK/kWh", withLocale(Locale.ENGLISH) { PriceUnit.Kroner.withUnit(en, 3.9) })
    }

    @Test fun other_zones_use_the_sub_unit_with_one_decimal() {
        assertEquals(1, no1.decimals)
        assertEquals("65,0 øre/kWh", no1.withUnit(da, 65.04))
        assertEquals("65,0 øre", no1.amount(da, 65.04))
        assertEquals("112,9 öre/kWh", se3.withUnit(da, 112.9))
        assertEquals("39,5 gr/kWh", pl.withUnit(da, 39.51))
        assertEquals("39.5 gr", withLocale(Locale.ENGLISH) { pl.amount(en, 39.51) })
        assertEquals("12,3", no1.price(12.34))
        assertEquals("-1,3", de.price(-1.25 - 0.01))
    }

    @Test fun euro_zones_write_the_cent_as_the_language_does() {
        assertEquals("ct/kWh", de.perKwh(da)); assertEquals("ct", de.short(da))
        assertEquals("12,3 ct/kWh", de.withUnit(da, 12.34))
        assertEquals("12.3 ct/kWh", withLocale(Locale.ENGLISH) { de.withUnit(en, 12.34) })
        assertEquals("12.3 ct", withLocale(Locale.ENGLISH) { de.amount(en, 12.34) })
    }

    @Test fun sub_units_compare_by_zone() {
        assertEquals(PriceUnit.of(Zones.byKey("de")!!), PriceUnit.of(Zones.byKey("de")!!))
        assertTrue(PriceUnit.of(Zones.byKey("de")!!) != PriceUnit.of(Zones.byKey("fr")!!))
    }

    @Test fun savings_are_money_in_the_zones_currency_but_kroner_in_denmark() {
        assertEquals("1,20 kr", PriceUnit.Kroner.saving(da, 1.2))
        assertEquals("1,20" to "kr", PriceUnit.Kroner.savingParts(da, 1.2))
        // 120 ct = EUR 1.20; 85 gr = PLN 0.85; 250 öre = SEK 2.50
        assertEquals("€1.20" to null, withLocale(Locale.ENGLISH) { de.savingParts(en, 120.0) })
        assertEquals("1,20 €", withLocale(Locale.GERMANY) { de.saving(en, 120.0).replace(' ', ' ') })
        assertEquals("0,85 zł", withLocale(Locale("pl", "PL")) { pl.saving(en, 85.0).replace(' ', ' ') })
        assertEquals("2,50 kr", withLocale(Locale("sv", "SE")) { se3.saving(en, 250.0).replace(' ', ' ') })
        assertEquals("NOK2.50", withLocale(Locale.ENGLISH) { no1.saving(en, 250.0) })
        // a saving that is nothing is "0", not "-0"
        assertEquals("€0.00", withLocale(Locale.ENGLISH) { de.saving(en, -0.04) })
    }

    @Test fun the_cheaper_later_sentence_compares_what_is_shown() {
        // 10.04 and 10.01 both read 10,0 øre: not "cheaper" for a zone with one decimal
        assertEquals("Billigste time de næste 24 timer", cheaperSentence(da, listOf(10.04, 10.01, 20.0), 0, no1))
        // but in kroner (two decimals) 1.004 vs 1.001 both read 1,00 and 1.004 vs 0.99 do not
        assertEquals("Billigste time de næste 24 timer", cheaperSentence(da, listOf(1.004, 1.001, 2.0), 0))
        val dip = List(48) { 20.0 }.toMutableList().also { it[11] = 9.94 }
        assertEquals("Billigere i dag kl. 11 — 9,9 ct", cheaperSentence(da, dip, 10, de))
    }

    @Test fun the_cheaper_later_sentence_names_the_price_in_the_zones_unit() {
        val vals = List(24) { 30.0 } + List(24) { 12.34 }
        assertEquals("Billigere i morgen kl. 00 — 12,3 ct", cheaperSentence(da, vals, 10, de))
        assertEquals("Billigere i morgen kl. 00 — 12,34 kr", cheaperSentence(da, vals, 10))
    }

    @Test fun tooltips_carry_the_zones_unit() {
        val d = Day("2026-10-14", true, List(24) { 12.34 }, null, null)
        assertEquals("I dag kl. 05 · 12,3 ct/kWh", tooltipText(da, listOf(d), d.price, 5, de))
        assertEquals("I dag kl. 05 · 12,3 øre/kWh", tooltipText(da, listOf(d), d.price, 5, no1))
        assertEquals("I dag kl. 05 · 12,34 kr/kWh", tooltipText(da, listOf(d), d.price, 5))
    }

    @Test fun the_zone_caption_and_notes() {
        assertEquals("Børspris (day-ahead) uden afgifter, nettarif og moms", priceCaption(da, "zone"))
        assertEquals("Tyskland og Luxembourg har fælles prisområde (DE-LU).", zoneNote(da, Zones.byKey("de")!!))
        assertEquals("Prisen gælder budzonen Nord Italia (IT-North).", zoneNote(da, Zones.byKey("it-n")!!))
        for (k in listOf("no1", "fr", "pl", "dk1", "at")) assertNull(k, zoneNote(da, Zones.byKey(k)!!))
    }

    // ── axis ──────────────────────────────────────────────────────────────────

    @Test fun the_danish_axis_is_untouched() {
        val vals = listOf(1.32, 3.9, 0.5)
        val a = axisFor(vals, PriceUnit.Kroner)
        val b = axisFor(vals)
        assertEquals(b.max, a.max, 0.0); assertEquals(b.min, a.min, 0.0); assertEquals(b.ticks, a.ticks)
        assertEquals(listOf(0, 1, 2, 3, 4), a.ticks)
    }

    @Test fun sub_unit_axis_uses_nice_steps() {
        // 3..22 ct: 22 x 1.12 = 24.6 -> five intervals of 5
        val ax = axisFor(listOf(3.0, 12.5, 22.0), de)
        assertEquals(0.0, ax.min, 0.0); assertEquals(25.0, ax.max, 0.0)
        assertEquals(listOf(0, 5, 10, 15, 20, 25), ax.ticks)
        // Norwegian winter evening: 180 øre
        val no = axisFor(listOf(40.0, 180.0), no1)
        assertEquals(250.0, no.max, 0.0); assertEquals(listOf(0, 50, 100, 150, 200, 250), no.ticks)
        // thousands
        assertEquals(listOf(0, 500, 1000, 1500, 2000), axisForSubUnit(listOf(100.0, 1500.0)).ticks)
        // tiny values and an empty series still give a sane axis
        assertEquals(listOf(0, 1), axisForSubUnit(listOf(0.2, 0.3)).ticks)
        assertEquals(listOf(0, 1), axisForSubUnit(emptyList()).ticks)
        assertEquals(listOf(0, 1), axisForSubUnit(listOf(0.0, 0.0)).ticks)
        // steps 1, 2 and 10
        assertEquals(listOf(0, 1, 2, 3, 4), axisForSubUnit(listOf(3.0)).ticks)       // 3.36 -> max 4
        assertEquals(listOf(0, 2, 4, 6, 8, 10), axisForSubUnit(listOf(8.0)).ticks)   // 8.96 -> max 10
        assertEquals(listOf(0, 20, 40, 60), axisForSubUnit(listOf(45.0)).ticks)      // 50.4 -> steps of 10 would need six intervals
    }

    @Test fun sub_unit_axis_keeps_zero_in_view_for_negative_prices() {
        val a = axisForSubUnit(listOf(-12.5, 3.0, 8.0))
        assertEquals(-15.0, a.min, 0.0); assertEquals(10.0, a.max, 0.0)
        assertEquals(listOf(-15, -10, -5, 0, 5, 10), a.ticks)
        assertTrue(0 in a.ticks)
        // only negative prices: the top is one step above zero (steps of 2: 4.48 needs three below, one above)
        val neg = axisForSubUnit(listOf(-4.0, -1.0))
        assertEquals(2.0, neg.max, 0.0); assertTrue(neg.min <= -4.48); assertTrue(0 in neg.ticks)
        assertEquals(0.0, axisForSubUnit(listOf(1.0, 2.0)).min, 0.0)
    }

    @Test fun the_highest_bar_never_touches_the_top_and_the_ticks_stay_few() {
        var hi = 0.1
        while (hi < 3000) {
            for (lo in listOf(0.0, -0.5 * hi, -hi)) {
                val a = axisForSubUnit(listOf(lo, hi))
                assertTrue("max ${a.max} under $hi x 1.12", a.max >= hi * 1.12 - 1e-9)
                assertTrue("min ${a.min} over $lo", a.min <= lo * 1.12 + 1e-9)
                assertTrue("ticks ${a.ticks} for $lo..$hi", a.ticks.size in 2..7)
                assertTrue(0 in a.ticks)
                assertTrue(a.ticks.all { it >= a.min - 1e-9 && it <= a.max + 1e-9 })
                assertEquals(a.max, a.ticks.last().toDouble(), 0.0)
                assertEquals(a.min, a.ticks.first().toDouble(), 0.0)
            }
            hi *= 1.37
        }
    }
}
