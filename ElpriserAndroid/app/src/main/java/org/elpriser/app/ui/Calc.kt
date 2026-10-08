package org.elpriser.app.ui

import org.elpriser.app.data.Clock
import org.elpriser.app.data.Day
import java.time.LocalDate

class Win(val s: Int, val e: Int, val avg: Double) {
    val label: String get() = "${pad(s)}–${pad(e % 24)}"
}

fun cheapestWindow(vals: List<Double>, n: Int, highest: Boolean = false): Win {
    var best: Win? = null
    for (s in 0..vals.size - n) {
        val a = vals.subList(s, s + n).average()
        val b = best
        if (b == null || (if (highest) a > b.avg else a < b.avg)) best = Win(s, s + n, a)
    }
    return best!!
}

/** 0 billig, 1 middel, 2 dyr — efter hvor mange af døgnets timer der er billigere. */
class Verdict(val kind: Int, val label: String)

fun verdict(price: Double, vals: List<Double>): Verdict {
    val pct = Math.round(vals.count { it < price }.toDouble() / vals.size * 100).toInt()
    return when {
        pct <= 33 -> Verdict(0, "Billig lige nu")
        pct <= 66 -> Verdict(1, "Middel lige nu")
        else -> Verdict(2, "Dyr lige nu")
    }
}

private val WD = listOf("søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag")
private val WS = listOf("søn", "man", "tir", "ons", "tor", "fre", "lør")
private val MON = listOf("jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec")

private fun LocalDate.dow() = dayOfWeek.value % 7

fun dayLabel(d: Day): String {
    val today = LocalDate.parse(Clock.today())
    val ld = d.localDate
    return when (ld) {
        today -> "I dag"
        today.plusDays(1) -> "I morgen"
        else -> WD[ld.dow()].replaceFirstChar { it.uppercase() }
    }
}

fun dayShort(d: Day) = WS[d.localDate.dow()]
fun dayMonth(d: Day) = "${d.localDate.dayOfMonth}. ${MON[d.localDate.monthValue - 1]}"
fun dayLong(d: Day) = "${WD[d.localDate.dow()].replaceFirstChar { it.uppercase() }} ${d.localDate.dayOfMonth}. ${MON[d.localDate.monthValue - 1]}"
fun todayLong(): String {
    val ld = LocalDate.parse(Clock.today())
    return "${WD[ld.dow()].replaceFirstChar { it.uppercase() }} ${ld.dayOfMonth}. ${MON[ld.monthValue - 1]}"
}
