package org.elpriser.app.data

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit

/** Et netselskab, som elpriser.org kender. `match` er de navne, Green Power Denmark svarer med. */
data class Net(val name: String, val gln: String, val area: String, val match: List<String>)

object Nets {
    val all = listOf(
        Net("N1", "5790001089030", "DK1", listOf("N1", "Elnetselskabet N1")),
        Net("Trefor", "5790000392261", "DK1", listOf("TREFOR El-net")),
        Net("Konstant", "5790000704842", "DK1", listOf("KONSTANT", "Konstant Net")),
        Net("Dinel", "5790000610099", "DK1", listOf("Dinel")),
        Net("Vores Elnet", "5790000610976", "DK1", listOf("Vores Elnet")),
        Net("Ravdex", "5790000836727", "DK1", listOf("Ravdex")),
        Net("RAH Net", "5790000681327", "DK1", listOf("RAH Net", "RAH")),
        Net("Elværk", "5790000681358", "DK1", listOf("Netselskabet Elværk", "Elværk")),
        Net("Nord Energi", "5790000610877", "DK1", listOf("Nord Energi")),
        Net("NOE Net", "5790000395620", "DK1", listOf("NOE Net")),
        Net("Elnet Midt", "5790001100520", "DK1", listOf("Elnet Midt")),
        Net("Flow Elnet", "5790000392551", "DK1", listOf("FLOW Elnet", "Flow")),
        Net("LNet", "5790001090111", "DK1", listOf("L-Net", "LNet")),
        Net("Veksel", "5790001088217", "DK1", listOf("Veksel")),
        Net("Ikast El Net", "5790000682102", "DK1", listOf("Ikast El Net")),
        Net("Midtfyns Elforsyning", "5790001089023", "DK1", listOf("Midtfyns Elforsyning")),
        Net("Elinord", "5790001095277", "DK1", listOf("Elinord")),
        Net("Læsø Elnet", "5790001103460", "DK1", listOf("Læsø Elnet")),
        Net("Sunds Net", "5790001095444", "DK1", listOf("Sunds Net")),
        Net("Tarm Elværk", "5790000706419", "DK1", listOf("Tarm Elværk")),
        Net("Hammel Elforsyning", "5790001090166", "DK1", listOf("Hammel Elforsyning")),
        Net("Grindsted Elnet", "5790000681105", "DK1", listOf("Grindsted Elnet")),
        Net("Forsyning Elnet", "5790001088309", "DK1", listOf("Forsyning Elnet")),
        Net("Aal El-Net", "5790001095451", "DK1", listOf("Aal El-Net")),
        Net("Hjerting", "5790001095376", "DK1", listOf("Hjerting")),
        Net("Hurup Elværk", "5790000610839", "DK1", listOf("Hurup Elværk")),
        Net("Cerius", "5790000705184", "DK2", listOf("Cerius")),
        Net("Trefor Øst", "5790000706686", "DK2", listOf("TREFOR El-Net Øst", "TREFOR El-Net Ost")),
        Net("Radius", "5790000705689", "DK2", listOf("Radius")),
        Net("Elektrus", "5790000836239", "DK2", listOf("Elektrus")),
        Net("Zeanet", "5790001089375", "DK2", listOf("Zeanet")),
    )

    fun byGln(gln: String?): Net? = all.firstOrNull { it.gln == gln }

    /** Matcher det navn, GPD svarer med, mod listen. Længste match vinder ("Trefor Øst" før "Trefor"). */
    fun match(name: String?): Net? {
        if (name.isNullOrBlank()) return null
        val lower = name.lowercase()
        return all.flatMap { n -> n.match.map { m -> n to m } }
            .filter { (_, m) -> lower.contains(m.lowercase()) }
            .maxByOrNull { (_, m) -> m.length }?.first
    }
}

/**
 * Ét døgn med 24 timepriser: kr/kWh på de danske zoner, ellers zonens underenhed pr. kWh (øre, öre, gr, ct; one decimal).
 * `lo`/`hi` er P10/P90 på prognosedage. `gridTariff` er nettariffen pr. time (kr/kWh ekskl. moms), kun på net-visninger. */
class Day(
    val date: String,
    val actual: Boolean,
    val price: List<Double>,
    val lo: List<Double>?,
    val hi: List<Double>?,
    val gridTariff: List<Double>? = null,
) {
    val localDate: LocalDate get() = LocalDate.parse(date)
}

/** De faste afgifter bag en pris, kr/kWh ekskl. moms (`vat` er momssatsen, 0,25). */
class Charges(val sys: Double, val trans: Double, val afg: Double, val vat: Double)

class Forecast(
    val area: String, val mode: String, val days: List<Day>, val model: String?, val generated: String?,
    val charges: Charges? = null,
)

class Lookup(val name: String?, val error: String?)

/**
 * "Now" on the wall clock of the price zone on screen: the API's days and hours follow the zone's own time (Oslo, Lisbon, Helsinki …).
 * The view model sets [zone] when the user changes zone; Copenhagen is the default (and every Danish zone). The overloads taking an
 * instant and a zone are pure, so the rules can be tested in any zone.
 */
object Clock {
    val COPENHAGEN: ZoneId = ZoneId.of("Europe/Copenhagen")

    @Volatile var zone: ZoneId = COPENHAGEN

    fun now(): ZonedDateTime = now(Instant.now(), zone)
    fun today(): String = today(Instant.now(), zone)
    fun hour(): Int = hour(Instant.now(), zone)

    fun now(at: Instant, zone: ZoneId): ZonedDateTime = ZonedDateTime.ofInstant(at, zone)
    /** The date on the zone's wall clock, "2026-10-11". */
    fun today(at: Instant, zone: ZoneId): String = now(at, zone).toLocalDate().toString()
    /** The wall-clock hour 0..23 in the zone (index into a day's 24 prices; on a DST day the wall clock skips or repeats an hour). */
    fun hour(at: Instant, zone: ZoneId): Int = now(at, zone).hour
}

/**
 * The days from [today] on, consecutive: the feed opens on yesterday, and a hole must not close up (it would put "tomorrow" on the wrong
 * date). Same rule as `daysFrom` of tests/golden/zones.mjs.
 */
fun daysFrom(days: List<Day>, today: String): List<Day> {
    val t = LocalDate.parse(today)
    val out = ArrayList<Day>()
    for (d in days.filter { it.date >= today }.sortedBy { it.date }) {
        if (ChronoUnit.DAYS.between(t, LocalDate.parse(d.date)) != out.size.toLong()) break
        out.add(d)
    }
    return out
}
