package org.elpriser.app

import org.elpriser.app.data.Day
import org.elpriser.app.ui.axisFor
import org.elpriser.app.ui.cheaperSentence
import org.elpriser.app.ui.cheapestTile
import org.elpriser.app.ui.dayLabels
import org.elpriser.app.ui.heroLabel
import org.elpriser.app.ui.hourLabels
import org.elpriser.app.ui.priceCaption
import org.elpriser.app.ui.priciestTile
import org.elpriser.app.ui.tooltipText
import org.elpriser.app.ui.verdict
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Logikken bag den nye Pris-skærm (Design A): sætning, nøgletal, akse, etiketter og bobler. */
class PriceLogicTest {
    // Prisserien fra designets skitse: i dag og i morgen, kl. 21 nu.
    private val today = listOf(1.32, 1.37, 1.35, 1.31, 1.30, 1.43, 1.78, 1.92, 2.11, 1.97, 1.86, 1.74, 1.52, 1.39, 1.44, 1.63, 1.98, 3.21, 3.68, 3.90, 3.67, 2.67, 2.43, 2.20)
    private val tomorrow = listOf(1.73, 1.69, 1.69, 1.69, 1.64, 1.63, 1.95, 2.23, 2.45, 2.18, 2.07, 1.84, 1.53, 1.38, 1.42, 1.63, 2.00, 3.03, 3.33, 3.34, 2.98, 2.15, 2.10, 2.09)
    private val vals = today + tomorrow
    private val now = 21

    @Test fun sentence_names_the_cheapest_hour_in_the_next_24h() {
        assertEquals("Billigere i morgen kl. 13 — 1,38 kr", cheaperSentence(vals, now))
    }

    @Test fun sentence_says_i_dag_when_the_cheapest_hour_is_still_today() {
        assertEquals("Billigere i dag kl. 13 — 1,39 kr", cheaperSentence(vals, 9))
    }

    @Test fun sentence_when_now_is_the_cheapest() {
        // Nu er billigst: ingen af de næste 24 timer er billigere.
        val flatThenUp = listOf(1.0) + List(30) { 2.0 }
        assertEquals("Billigste time de næste 24 timer", cheaperSentence(flatThenUp, 0))
    }

    @Test fun sentence_ignores_hours_that_round_to_the_same_price() {
        assertEquals("Billigste time de næste 24 timer", cheaperSentence(listOf(1.384, 1.381, 2.0), 0))
    }

    @Test fun sentence_only_looks_24h_ahead() {
        // Billigste time ligger 30 timer ude i fremtiden: ikke med.
        val v = List(40) { 2.0 }.toMutableList().also { it[30] = 0.5 }
        assertEquals("Billigste time de næste 24 timer", cheaperSentence(v, 0))
    }

    @Test fun stat_tiles_for_the_sketch_data() {
        val c = cheapestTile(vals, now)!!
        assertEquals("Billigst i morgen", c.label); assertEquals(1.38, c.price, 0.0); assertEquals(13, c.hour)
        val p = priciestTile(vals, now)!!
        // Dyreste time fra nu er kl. 19 i morgen (3,34) — men i dag kl. 19 er allerede gået.
        assertEquals("Dyrest i morgen", p.label); assertEquals(3.34, p.price, 0.0); assertEquals(19, p.hour)
    }

    @Test fun priciest_is_i_aften_only_for_today_from_17() {
        val evening = priciestTile(vals, 10)!!
        assertEquals("Dyrest i aften", evening.label); assertEquals(3.90, evening.price, 0.0); assertEquals(19, evening.hour)
        val afternoon = List(48) { 1.0 }.toMutableList().also { it[15] = 5.0 }
        assertEquals("Dyrest i dag", priciestTile(afternoon, 10)!!.label)
        val tomorrowPeak = List(48) { 1.0 }.toMutableList().also { it[24 + 19] = 5.0 }
        assertEquals("Dyrest i morgen", priciestTile(tomorrowPeak, 10)!!.label)
    }

    @Test fun cheapest_today_when_it_is_still_ahead() {
        val c = cheapestTile(vals, 3)!!
        assertEquals("Billigst i dag", c.label); assertEquals(4, c.hour)
    }

    @Test fun tiles_are_null_without_a_valid_hour() {
        assertNull(cheapestTile(vals, 99)); assertNull(priciestTile(emptyList(), 0))
    }

    @Test fun axis_is_zero_based_with_headroom_in_half_krone_steps() {
        val a = axisFor(vals) // 3,90 × 1,12 = 4,37 → 4,5
        assertEquals(0.0, a.min, 0.0); assertEquals(4.5, a.max, 0.0)
        assertEquals(listOf(0, 1, 2, 3, 4), a.ticks)
        assertEquals(1.0, axisFor(listOf(0.2, 0.3)).max, 0.0)           // aldrig lavere end 1
        assertEquals(3.0, axisFor(listOf(2.6)).max, 0.0)                 // 2,6 × 1,12 = 2,91 → 3,0
        assertEquals(3.5, axisFor(listOf(3.0)).max, 0.0)                 // 3,36 → 3,5
    }

    @Test fun axis_thins_ticks_when_prices_get_big() {
        assertEquals(listOf(0, 2, 4, 6, 8), axisFor(listOf(7.0)).ticks)
    }

    @Test fun axis_keeps_zero_in_view_for_negative_prices() {
        val a = axisFor(listOf(-0.4, 1.0, 2.0))
        assertEquals(-0.5, a.min, 0.0)
        assertEquals(true, 0 in a.ticks)
    }

    @Test fun tooltip_wording_for_two_days_and_for_the_week() {
        val d1 = Day("2026-10-14", true, today, null, null)
        val d2 = Day("2026-10-15", true, tomorrow, null, null)
        assertEquals("I dag kl. 19 · 3,90 kr/kWh", tooltipText(0, listOf(d1, d2), vals, 19))
        assertEquals("I morgen kl. 13 · 1,38 kr/kWh", tooltipText(0, listOf(d1, d2), vals, 24 + 13))
        val sat = Day("2026-10-17", false, List(24) { 1.57 }, null, null)
        assertEquals("lør 17. okt kl. 13 · 1,57 kr/kWh", tooltipText(1, listOf(sat), sat.price, 13))
    }

    @Test fun x_labels() {
        assertEquals(listOf("I dag 00", "12", "I morgen 00", "12"), hourLabels(48, 12).map { it.text })
        assertEquals(listOf("I dag 00", "06", "12", "18", "I morgen 00", "06", "12", "18"), hourLabels(48, 6).map { it.text })
        assertEquals(0.5f, hourLabels(48, 12)[2].frac, 0f)
        val days = listOf(Day("2026-10-16", false, List(24) { 1.0 }, null, null), Day("2026-10-17", false, List(24) { 1.0 }, null, null))
        assertEquals(listOf("fre 16", "lør 17"), dayLabels(days).map { it.text })
        assertEquals(0.25f, dayLabels(days)[0].frac, 0f)
    }

    @Test fun captions_and_hero_label() {
        assertEquals("Inkl. nettarif, afgifter og moms", priceCaption("net_inkl_alt"))
        assertEquals("Inkl. Energinets tariffer, afgifter og moms", priceCaption("inkl_alt"))
        assertEquals("Spotpris inkl. moms", priceCaption("spot_inkl"))
        assertEquals("Elpris lige nu · kl. 21", heroLabel(21, null))
        assertEquals("Elpris lige nu · onsdag kl. 09", heroLabel(9, "onsdag"))
    }

    @Test fun verdict_pill_for_the_sketch_hour_is_expensive() {
        // 39 af 48 timer er billigere end 2,67 (81 %), så designets skitse viser "Dyr lige nu".
        val v = verdict(vals[now], vals)
        assertEquals(2, v.kind)
        assertEquals("Dyr lige nu", v.label)
    }
}
