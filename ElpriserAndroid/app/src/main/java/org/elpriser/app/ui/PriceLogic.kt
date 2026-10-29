package org.elpriser.app.ui

import org.elpriser.app.R
import org.elpriser.app.data.Charges
import org.elpriser.app.data.Day
import kotlin.math.abs
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
fun periodLabels(tx: Strings): List<String> = listOf(tx.get(R.string.period_two), tx.get(R.string.period_five))

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

/**
 * Grafens vindue (samme regel som webbens): det starter seks timer før nu (kl. 00 om natten) og løber [DAYS_TWO] eller [DAYS_FIVE] døgn frem
 * fra dér, så langt dataene rækker. [st] er første time talt fra kl. 00 i dag, [n] antal søjler. Søjlernes indeks er altid absolutte
 * (0 = kl. 00 i dag); kun tegningen trækker [st] fra. Vinduet kan nå ind i døgn nr. 3 (2 døgn) eller nr. 6 (5 døgn).
 */
class ChartWindow(val st: Int, val n: Int) {
    val end: Int get() = st + n
}

fun chartWindow(availableDays: Int, period: Int, now: Int): ChartWindow {
    val back = minOf(6, now)
    val st = now - back
    val span = back + (if (period == PERIOD_FIVE) DAYS_FIVE else DAYS_TWO) * 24
    return ChartWindow(st, maxOf(minOf(span, availableDays * 24 - st), 0))
}

/** De døgn, vinduet berører (det sidste ofte kun delvist). */
fun windowDays(all: List<Day>, w: ChartWindow): List<Day> = all.take((w.end + 23) / 24)

/** Indeks (i timeserien) for første prognosedøgn, eller null hvis alle viste døgn er offentliggjorte børspriser. */
fun forecastStart(days: List<Day>): Int? = days.indexOfFirst { !it.actual }.takeIf { it >= 0 }?.times(24)

/** Tier (0 billig, 1 middel, 2 dyr) for hver time, målt mod hele det viste vindue (terciler). */
fun tiersFor(vals: List<Double>, ref: List<Double> = vals): IntArray = IntArray(vals.size) { verdict(vals[it], ref).kind }

/** "i dag" / "i morgen" / "søn 17." for timen med det givne indeks. Uden dage at slå op i: "senere". */
fun dayWord(tx: Strings, index: Int, days: List<Day>? = null): String {
    val d = index / 24
    return when {
        d == 0 -> tx.get(R.string.day_today)
        d == 1 -> tx.get(R.string.day_tomorrow)
        days != null && d in days.indices -> tx.get(R.string.day_short_date, dayShort(tx, days[d]), days[d].localDate.dayOfMonth)
        else -> tx.get(R.string.day_later)
    }
}

/** Sætningen under prisen: den billigste time de næste 24 timer, hvis den er billigere end nu. */
fun cheaperSentence(tx: Strings, vals: List<Double>, now: Int): String {
    if (now !in vals.indices) return ""
    val end = minOf(vals.size, now + 24)
    var best = now
    for (i in now + 1 until end) if (vals[i] < vals[best]) best = i
    return if (best == now || cents(vals[best]) >= cents(vals[now])) tx.get(R.string.cheaper_none)
    else tx.get(R.string.cheaper_later, dayWord(tx, best), pad(best % 24), fmt(vals[best]))
}

/** En af de to nøgletal-felter: etiket, pris og klokkeslæt. */
class Extreme(val label: String, val price: Double, val hour: Int)

/** Billigste time fra nu og frem i det viste vindue. Etiketten er "Billigst i dag", "Billigst i morgen" eller "Billigst søn 17.". */
fun cheapestTile(tx: Strings, vals: List<Double>, now: Int, days: List<Day>? = null): Extreme? {
    if (now !in vals.indices) return null
    var best = now
    for (i in now + 1 until vals.size) if (vals[i] < vals[best]) best = i
    return Extreme(tx.get(R.string.tile_cheapest, dayWord(tx, best, days)), vals[best], best % 24)
}

/** Dyreste time fra nu og frem. "i aften" bruges kun for i dag fra kl. 17. */
fun priciestTile(tx: Strings, vals: List<Double>, now: Int, days: List<Day>? = null): Extreme? {
    if (now !in vals.indices) return null
    var worst = now
    for (i in now + 1 until vals.size) if (vals[i] > vals[worst]) worst = i
    val word = if (worst / 24 == 0 && worst % 24 >= 17) tx.get(R.string.day_tonight) else dayWord(tx, worst, days)
    return Extreme(tx.get(R.string.tile_priciest, word), vals[worst], worst % 24)
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
fun tooltipText(tx: Strings, days: List<Day>, vals: List<Double>, i: Int): String {
    val d = days[i / 24]
    val whenText = when (i / 24) {
        0 -> tx.get(R.string.day_today_cap)
        1 -> tx.get(R.string.day_tomorrow_cap)
        else -> "${dayShort(tx, d)} ${dayMonth(tx, d)}"
    }
    return tx.get(R.string.tooltip, whenText, pad(i % 24), fmt(vals[i]))
}

/** Placering (0..1 langs aksen) og tekst for vandrette akseetiketter. */
class XLabel(val frac: Float, val text: String)

/**
 * 2 døgn: en etiket ved hver [step]. klokketime i vinduet, så en graf der starter ved nu læses efter uret. Midnat hedder "I dag 00" /
 * "I morgen 00" og senere "fre 00".
 */
fun hourLabels(tx: Strings, days: List<Day>, w: ChartWindow, step: Int): List<XLabel> =
    (0 until w.n - 1).map { w.st + it }.filter { it % step == 0 }.map { ab ->
        XLabel(
            (ab - w.st).toFloat() / w.n,
            when {
                ab % 24 != 0 -> pad(ab % 24)
                ab == 0 -> tx.get(R.string.axis_today_midnight)
                ab == 24 -> tx.get(R.string.axis_tomorrow_midnight)
                else -> "${dayShort(tx, days[ab / 24])} 00"
            },
        )
    }

/** 5 døgn: ét navn pr. døgn ("fre 15"), midt under den del af døgnet der er med; et døgn med under seks timer i vinduet har intet. */
fun dayLabels(tx: Strings, days: List<Day>, w: ChartWindow): List<XLabel> =
    days.indices.mapNotNull { k ->
        val vs = maxOf(k * 24, w.st)
        val ve = minOf(k * 24 + 24, w.end)
        if (ve - vs < 6) null
        else XLabel(((vs + ve) / 2f - w.st) / w.n, tx.get(R.string.day_short_num, dayShort(tx, days[k]), days[k].localDate.dayOfMonth))
    }

/** Midnatterne inde i vinduet (indeks), hvor 5 døgn tegner en døgnskel. */
fun midnights(w: ChartWindow): List<Int> = (1..w.end / 24).map { it * 24 }.filter { it > w.st && it < w.end }

fun periodTitle(tx: Strings, period: Int) = tx.get(if (period == PERIOD_FIVE) R.string.period_title_five else R.string.period_title_two)

fun priceCaption(tx: Strings, mode: String) = tx.get(
    when (mode) {
        "net_inkl_alt" -> R.string.caption_net
        "inkl_alt" -> R.string.caption_system
        "spot_inkl" -> R.string.caption_spot_incl
        else -> R.string.caption_spot_excl
    },
)

fun areaShort(tx: Strings, area: String) = tx.get(if (area == "DK1") R.string.area_west else R.string.area_east)

/** "DK1 Vest" / "DK2 Øst" — prisområdets kode og dets navn. */
fun areaLabel(tx: Strings, area: String) = tx.get(if (area == "DK1") R.string.area_label_dk1 else R.string.area_label_dk2)

/** Hero-etiketten: "Elpris lige nu · kl. 21" (telefon) eller "Elpris lige nu · onsdag kl. 21" (bred). */
fun heroLabel(tx: Strings, hour: Int, weekday: String?) =
    if (weekday != null) tx.get(R.string.hero_label_weekday, weekday, pad(hour)) else tx.get(R.string.hero_label, pad(hour))

/* ── Prisopbygning ───────────────────────────────────────────────────────────────────────
 * Opdelingen af en times pris i dens dele (spot, tariffer, afgift, moms), i øre/kWh med én decimal.
 * Alle regnestykker laves i hele tiendedele øre (Long), så delene summer PRÆCIS til totalen uden flydende-tal-støj.
 */

/** Rollen styrer farven på søjlestykket og prikken; selve betydningen bæres altid af etiketten. */
enum class PartRole { Spot, Energinet, Grid, Duty, Vat }

/** En række i opdelingen. `tenths` er øre/kWh × 10 (afrundet), `text` er f.eks. "85,3 øre" (uden enhed: bare "85,3"). */
class BreakdownRow(val role: PartRole, val label: String, val tenths: Long, val text: String = tenthsText(tenths))

/** Hele opdelingen: rækker, total og overskrift. Rækkerne summer præcis til totalen (`totalTenths`). */
class Breakdown(val rows: List<BreakdownRow>, val totalTenths: Long, val totalText: String, val heading: String) {
    /** Søjlens bredder: positive dele i forhold til deres sum (en negativ spotpris giver ikke et stykke). */
    fun barWeights(): List<Float> = barWeights(rows)
}

/** 853 -> "85,3", -3 -> "-0,3", 0 -> "0,0". Aldrig "-0,0". */
fun tenthsText(t: Long): String {
    val sign = if (t < 0) "-" else ""
    val a = abs(t)
    return "$sign${a / 10},${a % 10}"
}

fun barWeights(rows: List<BreakdownRow>): List<Float> {
    val pos = rows.map { maxOf(it.tenths, 0L) }
    val sum = pos.sum()
    return if (sum <= 0L) rows.map { 0f } else pos.map { it.toFloat() / sum }
}

private fun tenthsOf(kr: Double): Long = Math.round(kr * 1000.0)

/**
 * Prisen for én time delt op, ud fra den pris, der vises (kr/kWh inkl. moms, i den aktive visning) og samme svars `charges`.
 *  - net_inkl_alt: spot, system, transmission, nettarif (time `hour`), elafgift, moms
 *  - inkl_alt:     som ovenfor uden nettarif
 *  - spot_inkl:    spot og moms
 * Hver række afrundes til 0,1 øre, og Spotpris-rækken tager afrundingsforskellen, så rækkerne summer præcis til totalen
 * (prisen × 100 afrundet til 0,1 øre). Returnerer null, når opdelingen ikke kan vises: `charges` mangler (ældre svar), timen har ingen pris,
 * en net-visning mangler nettariffen for timen, eller visningen er en anden (fx spot ekskl. moms).
 * [headingWhen] er "" for denne time og ellers dagsordene fra [breakdownWhen] ("i morgen", "søn 18. okt").
 */
fun breakdownOf(
    tx: Strings, mode: String, price: Double, hour: Int, forecastDay: Boolean, charges: Charges?, gridTariff: Double?,
    netName: String?, headingWhen: String = "",
): Breakdown? {
    if (charges == null || !price.isFinite() || hour !in 0..23) return null
    val net = mode == "net_inkl_alt"
    val sys: Long; val trans: Long; val afg: Long
    when (mode) {
        "net_inkl_alt", "inkl_alt" -> { sys = tenthsOf(charges.sys); trans = tenthsOf(charges.trans); afg = tenthsOf(charges.afg) }
        "spot_inkl" -> { sys = 0; trans = 0; afg = 0 }
        else -> return null
    }
    var grid = 0L
    if (net) {
        if (gridTariff == null || !gridTariff.isFinite()) return null
        grid = tenthsOf(gridTariff)
    }
    val total = tenthsOf(price)
    // Moms = pris − pris/(1+sats); rundet for sig. Spotprisen er resten, så summen går op.
    val vat = tenthsOf(price - price / (1 + charges.vat))
    val spot = total - sys - trans - grid - afg - vat
    val spotLabel = tx.get(if (forecastDay) R.string.part_spot_forecast else R.string.part_spot_actual)
    val vatLabel = tx.get(R.string.part_vat, Math.round(charges.vat * 100))
    fun row(role: PartRole, label: String, tenths: Long) = BreakdownRow(role, label, tenths, tx.get(R.string.value_ore, tenthsText(tenths)))
    val rows = ArrayList<BreakdownRow>()
    rows.add(row(PartRole.Spot, spotLabel, spot))
    if (mode != "spot_inkl") {
        rows.add(row(PartRole.Energinet, tx.get(R.string.part_system), sys))
        rows.add(row(PartRole.Energinet, tx.get(R.string.part_transmission), trans))
        if (net) {
            val gridLabel = if (netName.isNullOrBlank()) tx.get(R.string.part_grid, pad(hour)) else tx.get(R.string.part_grid_named, netName, pad(hour))
            rows.add(row(PartRole.Grid, gridLabel, grid))
        }
        rows.add(row(PartRole.Duty, tx.get(R.string.part_duty), afg))
    }
    rows.add(row(PartRole.Vat, vatLabel, vat))
    val heading =
        if (headingWhen.isEmpty()) tx.get(R.string.breakdown_heading_now, pad(hour))
        else tx.get(R.string.breakdown_heading_when, headingWhen, pad(hour))
    return Breakdown(rows, total, tx.get(R.string.price_kwh, fmt(price)), heading)
}

/** Dagsordene i overskriften for en valgt time: samme ord som boblen, men med småt ("i dag", "i morgen", "søn 18. okt"). */
fun breakdownWhen(tx: Strings, days: List<Day>, index: Int): String {
    val d = days.getOrNull(index / 24) ?: return ""
    return when (index / 24) {
        0 -> tx.get(R.string.day_today)
        1 -> tx.get(R.string.day_tomorrow)
        else -> "${dayShort(tx, d)} ${dayMonth(tx, d)}"
    }
}

/**
 * Opdelingen for timen med indeks [index] i [vals] (priserne i den aktive visning, døgn efter døgn fra i dag kl. 00).
 * [selected] er true, når timen er valgt på grafen (overskriften nævner så dagen); false for "lige nu".
 */
fun breakdownAt(
    tx: Strings, mode: String, days: List<Day>, vals: List<Double>, index: Int, selected: Boolean, charges: Charges?, netName: String?,
): Breakdown? {
    if (index !in vals.indices) return null
    val day = days.getOrNull(index / 24) ?: return null
    val hour = index % 24
    return breakdownOf(
        tx, mode, vals[index], hour, !day.actual, charges, day.gridTariff?.getOrNull(hour), netName,
        if (selected) breakdownWhen(tx, days, index) else "",
    )
}
