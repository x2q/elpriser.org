package org.elpriser.app.ui

import org.elpriser.app.R
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

/** 0 billig, 1 middel, 2 dyr — efter hvor mange af døgnets timer der er billigere. Teksten hentes med [label]. */
class Verdict(val kind: Int)

fun verdict(price: Double, vals: List<Double>): Verdict {
    val pct = Math.round(vals.count { it < price }.toDouble() / vals.size * 100).toInt()
    return when {
        pct <= 33 -> Verdict(0)
        pct <= 66 -> Verdict(1)
        else -> Verdict(2)
    }
}

/** "Billig lige nu" / "Middel lige nu" / "Dyr lige nu" i det valgte sprog. */
fun Verdict.label(tx: Strings): String =
    tx.get(when (kind) { 0 -> R.string.verdict_cheap; 1 -> R.string.verdict_mid; else -> R.string.verdict_high })

private fun LocalDate.dow() = dayOfWeek.value % 7

private fun weekdayLong(tx: Strings, ld: LocalDate) = tx.array(R.array.weekdays_long)[ld.dow()]
private fun monthShort(tx: Strings, ld: LocalDate) = tx.array(R.array.months_short)[ld.monthValue - 1]

fun dayShort(tx: Strings, d: Day) = tx.array(R.array.weekdays_short)[d.localDate.dow()]
fun dayMonth(tx: Strings, d: Day) = tx.get(R.string.date_day_month, d.localDate.dayOfMonth, monthShort(tx, d.localDate))
fun dayLong(tx: Strings, d: Day) = longDate(tx, d.localDate)
fun todayLong(tx: Strings): String = longDate(tx, LocalDate.parse(Clock.today()))

private fun longDate(tx: Strings, ld: LocalDate) =
    tx.get(R.string.date_long, weekdayLong(tx, ld).replaceFirstChar { it.uppercase() }, ld.dayOfMonth, monthShort(tx, ld))

/** Ugedagens navn med småt ("onsdag") til sætninger som "Elpris lige nu · onsdag kl. 21". */
fun todayWeekday(tx: Strings): String = weekdayLong(tx, LocalDate.parse(Clock.today()))
