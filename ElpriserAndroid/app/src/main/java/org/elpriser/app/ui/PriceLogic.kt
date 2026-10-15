package org.elpriser.app.ui

import org.elpriser.app.data.Day
import kotlin.math.ceil
import kotlin.math.floor

/*
 * Ren logik til Pris-skærmen (ingen Android-afhængigheder, så den kan enhedstestes).
 * Indeks 0 i en serie er kl. 00 i dag; indeks 24 er kl. 00 i morgen.
 */

/** Pris afrundet til øre, som den vises. Bruges, så vi aldrig skriver "billigere" om to ens viste priser. */
private fun cents(v: Double) = Math.round(v * 100)

/* ── Periode ─────────────────────────────────────────────────────────────────────────────
 * To valg: 0 = "2 døgn" (i dag + i morgen), 1 = "5 døgn" (i dag fra kl. 00 + de næste fire døgn = 120 timer).
 * Heltallet er det, der gemmes (rememberSaveable); en ældre gemt værdi for den tidligere senere-døgn-visning var også 1 og vises nu som 5 døgn.
 */
const val PERIOD_TWO = 0
const val PERIOD_FIVE = 1
const val DAYS_TWO = 2
const val DAYS_FIVE = 5

/** Etiketterne i periode-pillen, i samme rækkefølge som PERIOD_TWO / PERIOD_FIVE. */
val PERIOD_LABELS = listOf("2 døgn", "5 døgn")

/** Gemt heltal -> gyldig periode. Ukendte værdier falder tilbage til 2 døgn og må aldrig kaste. */
fun coercePeriod(raw: Int): Int = if (raw == PERIOD_FIVE) PERIOD_FIVE else PERIOD_TWO

/**
 * Tekstværdi (gemt indstilling, startargument) -> periode. De gamle værdier for senere-døgn-visningen (og deres varianter) er nu 5 døgn;
 * alt ukendt eller tomt bliver 2 døgn.
 */
fun parsePeriod(raw: String?): Int {
    val v = raw?.trim()?.lowercase()?.replace('–', '-')?.replace('—', '-') ?: return PERIOD_TWO
    return when {
        v.isEmpty() -> PERIOD_TWO
        v.startsWith("5") || v.startsWith("3-10") -> PERIOD_FIVE
        v == "1" || v == "week" || v == "later" || v == "10" -> PERIOD_FIVE
        else -> PERIOD_TWO
    }
}

/** Den periode, der faktisk kan vises: 5 døgn kræver mere end de to første døgn, ellers vises 2 døgn. */
fun effectivePeriod(availableDays: Int, period: Int): Int =
    if (coercePeriod(period) == PERIOD_FIVE && availableDays > DAYS_TWO) PERIOD_FIVE else PERIOD_TWO

/** Det synlige vindue: i dag fra kl. 00 og frem (2 eller 5 døgn). Mangler døgn, vises dem, der er. */
fun visibleDays(all: List<Day>, period: Int): List<Day> =
    all.take(if (effectivePeriod(all.size, period) == PERIOD_FIVE) DAYS_FIVE else DAYS_TWO)

/** Indeks (i timeserien) for første prognosedøgn, eller null hvis alle viste døgn er offentliggjorte børspriser. */
fun forecastStart(days: List<Day>): Int? = days.indexOfFirst { !it.actual }.takeIf { it >= 0 }?.times(24)

/** Tier (0 billig, 1 middel, 2 dyr) for hver time, målt mod hele det viste vindue (terciler). */
fun tiersFor(vals: List<Double>): IntArray = IntArray(vals.size) { verdict(vals[it], vals).kind }

/** "i dag" / "i morgen" / "søn 17." for timen med det givne indeks. Uden dage at slå op i: "senere". */
fun dayWord(index: Int, days: List<Day>? = null): String {
    val d = index / 24
    return when {
        d == 0 -> "i dag"
        d == 1 -> "i morgen"
        days != null && d in days.indices -> "${dayShort(days[d])} ${days[d].localDate.dayOfMonth}."
        else -> "senere"
    }
}

/** Sætningen under prisen: den billigste time de næste 24 timer, hvis den er billigere end nu. */
fun cheaperSentence(vals: List<Double>, now: Int): String {
    if (now !in vals.indices) return ""
    val end = minOf(vals.size, now + 24)
    var best = now
    for (i in now + 1 until end) if (vals[i] < vals[best]) best = i
    return if (best == now || cents(vals[best]) >= cents(vals[now])) "Billigste time de næste 24 timer"
    else "Billigere ${dayWord(best)} kl. ${pad(best % 24)} — ${fmt(vals[best])} kr"
}

/** En af de to nøgletal-felter: etiket, pris og klokkeslæt. */
class Extreme(val label: String, val price: Double, val hour: Int)

/** Billigste time fra nu og frem i det viste vindue. Etiketten er "Billigst i dag", "Billigst i morgen" eller "Billigst søn 17.". */
fun cheapestTile(vals: List<Double>, now: Int, days: List<Day>? = null): Extreme? {
    if (now !in vals.indices) return null
    var best = now
    for (i in now + 1 until vals.size) if (vals[i] < vals[best]) best = i
    return Extreme("Billigst ${dayWord(best, days)}", vals[best], best % 24)
}

/** Dyreste time fra nu og frem. "i aften" bruges kun for i dag fra kl. 17. */
fun priciestTile(vals: List<Double>, now: Int, days: List<Day>? = null): Extreme? {
    if (now !in vals.indices) return null
    var worst = now
    for (i in now + 1 until vals.size) if (vals[i] > vals[worst]) worst = i
    val word = if (worst / 24 == 0 && worst % 24 >= 17) "i aften" else dayWord(worst, days)
    return Extreme("Dyrest $word", vals[worst], worst % 24)
}

/** Lodret akse, nulbaseret. Maks = højeste pris × 1,12 rundet op til næste 0,5, så den højeste søjle aldrig rører toppen. */
class Axis(val min: Double, val max: Double, val ticks: List<Int>) {
    val span: Double get() = max - min
}

fun axisFor(vals: List<Double>): Axis {
    val hi = vals.maxOrNull() ?: 0.0
    val lo = vals.minOrNull() ?: 0.0
    val max = maxOf(1.0, ceil(hi * 1.12 * 2 - 1e-9) / 2)
    val min = if (lo < 0) -ceil(-lo * 1.12 * 2 - 1e-9) / 2 else 0.0
    val step = if (max - min > 6) 2 else 1
    val ticks = ArrayList<Int>()
    var v = ceil(min / step).toInt() * step
    while (v <= floor(max + 1e-9)) { ticks.add(v); v += step }
    return Axis(min, max, ticks)
}

/** Teksten i boblen: "I dag kl. 19 · 3,90 kr/kWh", "I morgen kl. 13 · …", og fra døgn 3 "søn 17. okt kl. 13 · 0,51 kr/kWh". */
fun tooltipText(days: List<Day>, vals: List<Double>, i: Int): String {
    val d = days[i / 24]
    val whenText = when (i / 24) { 0 -> "I dag"; 1 -> "I morgen"; else -> "${dayShort(d)} ${dayMonth(d)}" }
    return "$whenText kl. ${pad(i % 24)} · ${fmt(vals[i])} kr/kWh"
}

/** Placering (0..1 langs aksen) og tekst for vandrette akseetiketter. */
class XLabel(val frac: Float, val text: String)

/** 2 døgn: hvert [step]. time; kl. 00 hedder "I dag 00" / "I morgen 00". */
fun hourLabels(n: Int, step: Int): List<XLabel> =
    (0 until n step step).map { h ->
        XLabel(h.toFloat() / n, if (h % 24 == 0) (if (h == 0) "I dag 00" else "I morgen 00") else pad(h % 24))
    }

/** 5 døgn: ét navn pr. døgn, midt under døgnets 24 søjler ("fre 15"). */
fun dayLabels(days: List<Day>): List<XLabel> =
    days.mapIndexed { k, d -> XLabel((k + 0.5f) / days.size, "${dayShort(d)} ${d.localDate.dayOfMonth}") }

fun periodTitle(period: Int) = if (period == PERIOD_FIVE) "Næste 5 døgn" else "Næste 2 døgn"

fun priceCaption(mode: String) = when (mode) {
    "net_inkl_alt" -> "Inkl. nettarif, afgifter og moms"
    "inkl_alt" -> "Inkl. Energinets tariffer, afgifter og moms"
    "spot_inkl" -> "Spotpris inkl. moms"
    else -> "Spotpris ekskl. moms"
}

fun areaShort(area: String) = if (area == "DK1") "Vest" else "Øst"

/** Hero-etiketten: "Elpris lige nu · kl. 21" (telefon) eller "Elpris lige nu · onsdag kl. 21" (bred). */
fun heroLabel(hour: Int, weekday: String?) =
    "Elpris lige nu · " + (if (weekday != null) "$weekday " else "") + "kl. ${pad(hour)}"
