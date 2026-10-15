package org.elpriser.app

import org.elpriser.app.data.Day
import org.elpriser.app.ui.DAYS_FIVE
import org.elpriser.app.ui.PERIOD_FIVE
import org.elpriser.app.ui.PERIOD_LABELS
import org.elpriser.app.ui.PERIOD_TWO
import org.elpriser.app.ui.axisFor
import org.elpriser.app.ui.cheaperSentence
import org.elpriser.app.ui.cheapestTile
import org.elpriser.app.ui.coercePeriod
import org.elpriser.app.ui.dayLabels
import org.elpriser.app.ui.effectivePeriod
import org.elpriser.app.ui.forecastStart
import org.elpriser.app.ui.heroLabel
import org.elpriser.app.ui.hourLabels
import org.elpriser.app.ui.parsePeriod
import org.elpriser.app.ui.periodTitle
import org.elpriser.app.ui.priceCaption
import org.elpriser.app.ui.priciestTile
import org.elpriser.app.ui.tiersFor
import org.elpriser.app.ui.tooltipText
import org.elpriser.app.ui.verdict
import org.elpriser.app.ui.visibleDays
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

    @Test fun tooltip_wording_for_today_tomorrow_and_later_days() {
        val d1 = Day("2026-10-14", true, today, null, null)
        val d2 = Day("2026-10-15", true, tomorrow, null, null)
        assertEquals("I dag kl. 19 · 3,90 kr/kWh", tooltipText(listOf(d1, d2), vals, 19))
        assertEquals("I morgen kl. 13 · 1,38 kr/kWh", tooltipText(listOf(d1, d2), vals, 24 + 13))
        // 5 døgn: fra døgn 3 med ugedag og dato (2027-10-17 er en søndag).
        assertEquals("I dag kl. 19 · 2,35 kr/kWh", tooltipText(fiveDays, fiveVals, 19))
        assertEquals("I morgen kl. 18 · 2,29 kr/kWh", tooltipText(fiveDays, fiveVals, 24 + 18))
        assertEquals("søn 17. okt kl. 13 · 0,51 kr/kWh", tooltipText(fiveDays, fiveVals, 48 + 13))
        assertEquals("tir 19. okt kl. 19 · 2,49 kr/kWh", tooltipText(fiveDays, fiveVals, 96 + 19))
    }

    @Test fun x_labels() {
        assertEquals(listOf("I dag 00", "12", "I morgen 00", "12"), hourLabels(48, 12).map { it.text })
        assertEquals(listOf("I dag 00", "06", "12", "18", "I morgen 00", "06", "12", "18"), hourLabels(48, 6).map { it.text })
        assertEquals(0.5f, hourLabels(48, 12)[2].frac, 0f)
        val days = listOf(Day("2026-10-16", false, List(24) { 1.0 }, null, null), Day("2026-10-17", false, List(24) { 1.0 }, null, null))
        assertEquals(listOf("fre 16", "lør 17"), dayLabels(days).map { it.text })
        assertEquals(0.25f, dayLabels(days)[0].frac, 0f)
    }

    // ── 5 døgn: i dag fra kl. 00 + de næste fire døgn. Fre 15. – tir 19. okt, tallene fra designets skitse (DK1). ──
    private val fiveRaw = listOf(
        listOf(1.62, 1.58, 1.58, 1.58, 1.53, 1.52, 1.62, 1.90, 2.12, 1.85, 1.74, 1.51, 1.20, 1.05, 1.09, 1.30, 1.67, 2.04, 2.34, 2.35, 2.00, 1.82, 1.77, 1.76),
        listOf(1.55, 1.49, 1.55, 1.55, 1.57, 1.72, 1.91, 2.17, 2.23, 1.98, 1.77, 1.59, 1.44, 1.30, 1.24, 1.27, 1.66, 1.95, 2.29, 2.30, 2.11, 1.91, 1.81, 1.68),
        listOf(1.49, 1.29, 1.32, 1.30, 1.27, 1.28, 1.34, 1.38, 1.36, 1.24, 1.02, 0.83, 0.62, 0.51, 0.52, 0.69, 1.06, 1.46, 1.62, 1.67, 1.62, 1.54, 1.55, 1.44),
        listOf(1.42, 1.49, 1.53, 1.52, 1.50, 1.52, 1.55, 1.58, 1.55, 1.35, 1.14, 0.96, 0.85, 0.77, 0.81, 1.01, 1.38, 1.80, 1.96, 1.97, 1.92, 1.81, 1.75, 1.64),
        listOf(1.53, 1.49, 1.48, 1.45, 1.45, 1.56, 1.87, 2.15, 2.17, 1.90, 1.72, 1.42, 1.29, 1.21, 1.29, 1.42, 1.66, 2.07, 2.41, 2.49, 2.31, 2.16, 2.05, 1.90),
    )
    // I dag er en børspris-dag; i morgen og frem er prognose (som før kl. 13 om dagen).
    private val allDays = (0 until 10).map { k ->
        val p = fiveRaw[k % 5]
        Day("2027-10-%02d".format(15 + k), k == 0, p, null, null)
    }
    private val fiveDays = visibleDays(allDays, PERIOD_FIVE)
    private val fiveVals = fiveDays.flatMap { it.price }

    @Test fun five_day_window_is_today_plus_four_days_of_120_hours() {
        assertEquals(5, fiveDays.size)
        assertEquals(DAYS_FIVE * 24, fiveVals.size)
        assertEquals(120, fiveVals.size)
        assertEquals("2027-10-15", fiveDays.first().date)   // i dag fra kl. 00, ikke "senere døgn"
        assertEquals("2027-10-19", fiveDays.last().date)
        assertEquals(48, visibleDays(allDays, PERIOD_TWO).flatMap { it.price }.size)
    }

    @Test fun five_day_window_uses_what_exists_when_the_forecast_is_short() {
        assertEquals(3, visibleDays(allDays.take(3), PERIOD_FIVE).size)
        // Kun i dag og i morgen: 5 døgn har intet mere at vise, så vises 2 døgn.
        assertEquals(PERIOD_TWO, effectivePeriod(2, PERIOD_FIVE))
        assertEquals(PERIOD_FIVE, effectivePeriod(3, PERIOD_FIVE))
        assertEquals(PERIOD_FIVE, effectivePeriod(10, PERIOD_FIVE))
        assertEquals(2, visibleDays(allDays.take(2), PERIOD_FIVE).size)
    }

    @Test fun five_day_x_labels_are_one_per_day_centred_under_24_bars() {
        val l = dayLabels(fiveDays)
        assertEquals(listOf("fre 15", "lør 16", "søn 17", "man 18", "tir 19"), l.map { it.text })
        assertEquals(listOf(0.1f, 0.3f, 0.5f, 0.7f, 0.9f), l.map { it.frac })
    }

    @Test fun prognose_marker_sits_at_the_first_forecast_day() {
        // Børspris i dag, prognose fra i morgen: markøren står ved døgn 2 = time 24 (20 % af de 120 søjler).
        assertEquals(24, forecastStart(fiveDays))
        // Efter kl. 13 er i morgen også offentliggjort: prognosen starter i overmorgen.
        val afterNoon = fiveDays.mapIndexed { i, d -> Day(d.date, i <= 1, d.price, null, null) }
        assertEquals(48, forecastStart(afterNoon))
        // Ingen prognosedøgn i vinduet: ingen markør.
        assertNull(forecastStart(fiveDays.map { Day(it.date, true, it.price, null, null) }))
    }

    @Test fun five_day_tiles_use_the_whole_window_and_name_the_day() {
        val c = cheapestTile(fiveVals, 9, fiveDays)!!
        assertEquals("Billigst søn 17.", c.label); assertEquals(0.51, c.price, 0.0); assertEquals(13, c.hour)
        val p = priciestTile(fiveVals, 9, fiveDays)!!
        assertEquals("Dyrest tir 19.", p.label); assertEquals(2.49, p.price, 0.0); assertEquals(19, p.hour)
        // "i aften" bruges kun for i dag fra kl. 17, også i 5-døgnsvinduet.
        val tonight = List(120) { 1.0 }.toMutableList().also { it[19] = 9.0 }
        assertEquals("Dyrest i aften", priciestTile(tonight, 9, fiveDays)!!.label)
        val tomorrow = List(120) { 1.0 }.toMutableList().also { it[24 + 8] = 9.0 }
        assertEquals("Dyrest i morgen", priciestTile(tomorrow, 9, fiveDays)!!.label)
        // Kun timer fra nu og frem tæller: den billigste time i går/tidligere i dag er ikke med.
        val early = List(120) { 2.0 }.toMutableList().also { it[3] = 0.1; it[72 + 5] = 0.4 }
        assertEquals("Billigst man 18.", cheapestTile(early, 9, fiveDays)!!.label)
    }

    @Test fun five_day_tiers_are_terciles_of_the_visible_window() {
        val tiers = tiersFor(fiveVals)
        assertEquals(120, tiers.size)
        val low = tiers.count { it == 0 }; val high = tiers.count { it == 2 }
        // Terciler: ca. en tredjedel billig, en tredjedel dyr (afrunding og lige priser giver lidt slingring).
        assertEquals(true, low in 35..45)
        assertEquals(true, high in 35..45)
        // Den billigste time er billig og den dyreste dyr, og nøgletallene i vinduet hænger sammen med farverne.
        assertEquals(0, tiers[48 + 13]); assertEquals(2, tiers[96 + 19])
        // Farverne måles mod det viste vindue: kl. 10 i dag (1,74 kr) er middel blandt 48 timer, men dyr blandt 120.
        assertEquals(1, tiersFor(fiveVals.take(48))[10])
        assertEquals(2, tiers[10])
    }

    @Test fun scrubbing_indices_cover_all_120_bars() {
        // Tooltip kan bygges for første og sidste søjle og aldrig uden for serien.
        assertEquals("I dag kl. 00 · 1,62 kr/kWh", tooltipText(fiveDays, fiveVals, 0))
        assertEquals("tir 19. okt kl. 23 · 1,90 kr/kWh", tooltipText(fiveDays, fiveVals, 119))
    }

    @Test fun period_titles_and_labels_say_5_dogn() {
        assertEquals(listOf("2 døgn", "5 døgn"), PERIOD_LABELS)
        assertEquals("Næste 2 døgn", periodTitle(PERIOD_TWO))
        assertEquals("Næste 5 døgn", periodTitle(PERIOD_FIVE))
    }

    @Test fun legacy_period_values_map_to_5_dogn_and_never_crash() {
        // Gemt heltal: 1 var den gamle senere-døgn-visning og er nu 5 døgn; alt ukendt bliver 2 døgn.
        assertEquals(PERIOD_FIVE, coercePeriod(1))
        assertEquals(PERIOD_TWO, coercePeriod(0))
        assertEquals(PERIOD_TWO, coercePeriod(7))
        assertEquals(PERIOD_TWO, coercePeriod(-1))
        // Tekstværdier, inkl. de gamle med tankestreg og bindestreg.
        for (v in listOf("3–10", "3-10", "3–10 døgn", "3-10 døgn", " 3–10 ", "5", "5 døgn", "week", "later", "1")) {
            assertEquals("'$v'", PERIOD_FIVE, parsePeriod(v))
        }
        for (v in listOf(null, "", "2", "2 døgn", "0", "xyz", "42")) {
            assertEquals("'$v'", PERIOD_TWO, parsePeriod(v))
        }
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
