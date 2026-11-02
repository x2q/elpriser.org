package org.elpriser.app

import org.elpriser.app.data.Clock
import org.elpriser.app.data.Day
import org.elpriser.app.data.Zones
import org.elpriser.app.data.daysFrom
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

/** "Now" on the wall clock of the zone on screen: the date and the hour index into a day's 24 prices. */
class ClockTest {
    private val copenhagen = ZoneId.of("Europe/Copenhagen")
    private val helsinki = ZoneId.of("Europe/Helsinki")
    private val lisbon = ZoneId.of("Europe/Lisbon")
    private val oslo = ZoneId.of("Europe/Oslo")

    @After fun resetClock() { Clock.zone = Clock.COPENHAGEN }

    @Test fun the_default_zone_is_copenhagen() {
        assertEquals(copenhagen, Clock.zone)
        assertEquals(copenhagen, Zones.byKey("dk1")!!.zoneId)
        assertEquals(copenhagen, Zones.byKey("dk2")!!.zoneId)
    }

    @Test fun the_same_instant_is_a_different_date_and_hour_in_different_zones() {
        val at = Instant.parse("2026-10-10T22:30:00Z")
        // Copenhagen and Helsinki are already on the 11th (summer time, UTC+2 and +3); Lisbon (UTC+1) is at 23:30 on the 10th.
        assertEquals("2026-10-11" to 0, Clock.today(at, copenhagen) to Clock.hour(at, copenhagen))
        assertEquals("2026-10-11" to 1, Clock.today(at, helsinki) to Clock.hour(at, helsinki))
        assertEquals("2026-10-10" to 23, Clock.today(at, lisbon) to Clock.hour(at, lisbon))
        assertEquals("2026-10-11" to 0, Clock.today(at, oslo) to Clock.hour(at, oslo))
    }

    @Test fun winter_time_offsets() {
        val at = Instant.parse("2026-12-31T22:59:00Z")
        assertEquals("2026-12-31" to 22, Clock.today(at, lisbon) to Clock.hour(at, lisbon))        // UTC+0
        assertEquals("2026-12-31" to 23, Clock.today(at, copenhagen) to Clock.hour(at, copenhagen)) // UTC+1
        assertEquals("2027-01-01" to 0, Clock.today(at, helsinki) to Clock.hour(at, helsinki))      // UTC+2
    }

    @Test fun the_zone_is_settable_and_the_no_argument_functions_follow_it() {
        Clock.zone = lisbon
        assertEquals(lisbon, Clock.zone)
        assertEquals(lisbon, Clock.now().zone)
        Clock.zone = helsinki
        assertEquals(helsinki, Clock.now().zone)
        val h = Clock.hour()
        assertEquals(true, h in 0..23)
    }

    @Test fun spring_forward_day_in_lisbon_skips_hour_one() {
        // Lisbon moves from 01:00 to 02:00 at 01:00 UTC on 2026-03-29 (Copenhagen moves at the same instant, from 02:00 to 03:00).
        val before = Instant.parse("2026-03-29T00:59:00Z")
        val after = Instant.parse("2026-03-29T01:00:00Z")
        assertEquals(0, Clock.hour(before, lisbon)); assertEquals(2, Clock.hour(after, lisbon))
        assertEquals(1, Clock.hour(before, copenhagen)); assertEquals(3, Clock.hour(after, copenhagen))
        assertEquals("2026-03-29", Clock.today(after, lisbon))
    }

    @Test fun fall_back_day_in_lisbon_repeats_hour_one_on_the_same_date() {
        val first = Instant.parse("2026-10-25T00:30:00Z")   // 01:30 WEST
        val second = Instant.parse("2026-10-25T01:30:00Z")  // 01:30 WET, one real hour later
        assertEquals(1, Clock.hour(first, lisbon)); assertEquals(1, Clock.hour(second, lisbon))
        assertEquals("2026-10-25", Clock.today(first, lisbon)); assertEquals("2026-10-25", Clock.today(second, lisbon))
        // the index stays inside the day's 24 prices on every wall-clock hour of the day
        var t = Instant.parse("2026-10-24T22:00:00Z")
        while (t < Instant.parse("2026-10-26T02:00:00Z")) {
            assertEquals(true, Clock.hour(t, lisbon) in 0..23)
            t = t.plusSeconds(900)
        }
    }

    @Test fun the_day_cut_uses_the_zones_own_date() {
        fun d(date: String) = Day(date, true, List(24) { 1.0 }, null, null)
        val feed = listOf(d("2026-10-09"), d("2026-10-10"), d("2026-10-11"))
        val at = Instant.parse("2026-10-10T22:30:00Z")
        // In Copenhagen it is already the 11th: only the 11th is left. In Lisbon it is the 10th: the 10th and the 11th.
        assertEquals(listOf("2026-10-11"), daysFrom(feed, Clock.today(at, copenhagen)).map { it.date })
        assertEquals(listOf("2026-10-10", "2026-10-11"), daysFrom(feed, Clock.today(at, lisbon)).map { it.date })
    }
}
