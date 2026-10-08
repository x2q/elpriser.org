package org.elpriser.app.data

import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

/** Et netselskab, som elpriser.org kender. `match` er de navne, Green Power Denmark svarer med. */
data class Net(val name: String, val gln: String, val area: String, val match: List<String>) {
    val areaLabel: String get() = if (area == "DK1") "DK1 Vest" else "DK2 Øst"
}

object Nets {
    val all = listOf(
        Net("N1", "5790001089030", "DK1", listOf("N1", "Elnetselskabet N1")),
        Net("Trefor", "5790000392261", "DK1", listOf("TREFOR El-net")),
        Net("Konstant", "5790000704842", "DK1", listOf("KONSTANT", "Konstant Net")),
        Net("Vores Elnet", "5790000610976", "DK1", listOf("Vores Elnet")),
        Net("RAH Net", "5790000681327", "DK1", listOf("RAH Net", "RAH")),
        Net("Elværk", "5790000681358", "DK1", listOf("Netselskabet Elværk", "Elværk")),
        Net("Nord Energi", "5790000610877", "DK1", listOf("Nord Energi")),
        Net("NOE Net", "5790000395620", "DK1", listOf("NOE Net")),
        Net("Elnet Midt", "5790001100520", "DK1", listOf("Elnet Midt")),
        Net("Flow Elnet", "5790000392551", "DK1", listOf("FLOW Elnet", "Flow")),
        Net("LNet", "5790001090111", "DK1", listOf("L-Net", "LNet")),
        Net("Cerius", "5790000705184", "DK2", listOf("Cerius")),
        Net("Trefor Øst", "5790000706686", "DK2", listOf("TREFOR El-Net Øst", "TREFOR El-Net Ost")),
        Net("Radius", "5790000705689", "DK2", listOf("Radius")),
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

/** Ét døgn med 24 timepriser i kr/kWh. `lo`/`hi` er P10/P90 på prognosedage. */
class Day(
    val date: String,
    val actual: Boolean,
    val price: List<Double>,
    val lo: List<Double>?,
    val hi: List<Double>?,
) {
    val localDate: LocalDate get() = LocalDate.parse(date)
}

class Forecast(val area: String, val mode: String, val days: List<Day>, val model: String?, val generated: String?)

class Lookup(val name: String?, val error: String?)

object Clock {
    val zone: ZoneId = ZoneId.of("Europe/Copenhagen")
    fun now(): ZonedDateTime = ZonedDateTime.now(zone)
    fun today(): String = now().toLocalDate().toString()
    fun hour(): Int = now().hour
}
