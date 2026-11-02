package org.elpriser.app.data

import java.text.Collator
import java.time.ZoneId
import java.util.Locale

/**
 * A price zone the app can show. The table below is the shared contract (tests/golden/app-contract.json, key "zones"): the same rows, in the same
 * order, as the web, the API and the iOS app. test-golden.mjs parses the one-line `Zone(...)` rows with a regex — keep that format.
 *
 * [key] is the `zone` of /api/nordic (lower case); dk1 and dk2 are served by /api/forecast (grid companies, Danish taxes) instead.
 * [tz] is the zone's own wall clock (the API's days and hours follow it). [sub] is the sub-unit shown per kWh ("ct" is written by the language's
 * own text, the others are literal). [city] names the place only where a country has several zones.
 */
data class Zone(val key: String, val country: String, val tz: String, val currency: String, val sub: String, val city: String?) {
    val zoneId: ZoneId by lazy(LazyThreadSafetyMode.PUBLICATION) { ZoneId.of(tz) }
    val isDanish: Boolean get() = country == "DK"
    /** "NO1", "DE", "IT-N". */
    val code: String get() = key.uppercase(Locale.ROOT)
    /** The sub-unit per kWh as a literal ("øre/kWh"); for "ct" the app uses the language's own text instead. */
    val perKwh: String get() = "$sub/kWh"
}

object Zones {
    val all = listOf(
        Zone("dk1", "DK", "Europe/Copenhagen", "DKK", "øre", null),
        Zone("dk2", "DK", "Europe/Copenhagen", "DKK", "øre", null),
        Zone("no1", "NO", "Europe/Oslo", "NOK", "øre", "Oslo"),
        Zone("no2", "NO", "Europe/Oslo", "NOK", "øre", "Kristiansand"),
        Zone("no3", "NO", "Europe/Oslo", "NOK", "øre", "Trondheim"),
        Zone("no4", "NO", "Europe/Oslo", "NOK", "øre", "Tromsø"),
        Zone("no5", "NO", "Europe/Oslo", "NOK", "øre", "Bergen"),
        Zone("se1", "SE", "Europe/Stockholm", "SEK", "öre", "Luleå"),
        Zone("se2", "SE", "Europe/Stockholm", "SEK", "öre", "Sundsvall"),
        Zone("se3", "SE", "Europe/Stockholm", "SEK", "öre", "Stockholm"),
        Zone("se4", "SE", "Europe/Stockholm", "SEK", "öre", "Malmö"),
        Zone("fi", "FI", "Europe/Helsinki", "EUR", "ct", null),
        Zone("nl", "NL", "Europe/Amsterdam", "EUR", "ct", null),
        Zone("de", "DE", "Europe/Berlin", "EUR", "ct", null),
        Zone("fr", "FR", "Europe/Paris", "EUR", "ct", null),
        Zone("pl", "PL", "Europe/Warsaw", "PLN", "gr", null),
        Zone("it-n", "IT", "Europe/Rome", "EUR", "ct", null),
        Zone("at", "AT", "Europe/Vienna", "EUR", "ct", null),
        Zone("be", "BE", "Europe/Brussels", "EUR", "ct", null),
        Zone("ch", "CH", "Europe/Zurich", "EUR", "ct", null),
        Zone("cz", "CZ", "Europe/Prague", "EUR", "ct", null),
        Zone("hu", "HU", "Europe/Budapest", "EUR", "ct", null),
        Zone("si", "SI", "Europe/Ljubljana", "EUR", "ct", null),
        Zone("es", "ES", "Europe/Madrid", "EUR", "ct", null),
        Zone("pt", "PT", "Europe/Lisbon", "EUR", "ct", null),
        Zone("sk", "SK", "Europe/Bratislava", "EUR", "ct", null),
        Zone("gr", "GR", "Europe/Athens", "EUR", "ct", null),
        Zone("ro", "RO", "Europe/Bucharest", "EUR", "ct", null),
        Zone("bg", "BG", "Europe/Sofia", "EUR", "ct", null),
        Zone("hr", "HR", "Europe/Zagreb", "EUR", "ct", null),
        Zone("rs", "RS", "Europe/Belgrade", "EUR", "ct", null),
        Zone("ee", "EE", "Europe/Tallinn", "EUR", "ct", null),
        Zone("lv", "LV", "Europe/Riga", "EUR", "ct", null),
        Zone("lt", "LT", "Europe/Vilnius", "EUR", "ct", null),
        Zone("ie", "IE", "Europe/Dublin", "EUR", "ct", null),
        Zone("me", "ME", "Europe/Podgorica", "EUR", "ct", null),
        Zone("mk", "MK", "Europe/Skopje", "EUR", "ct", null),
        Zone("al", "AL", "Europe/Tirane", "EUR", "ct", null),
    )

    private val byKey = all.associateBy { it.key }

    fun byKey(key: String?): Zone? = if (key == null) null else byKey[key.lowercase(Locale.ROOT)]

    /** The countries in table order (30). */
    val countries: List<String> = all.map { it.country }.distinct()

    /** The zones of one country, in table order. */
    fun zonesOf(country: String): List<Zone> = all.filter { it.country == country }

    fun isDanish(key: String?): Boolean = byKey(key)?.isDanish == true

    /** The ECB reference rates to fall back to when a response carries no rate (the API's own FX_FALLBACK). Contract key "fxFallback". */
    val FX_FALLBACK: Map<String, Double> = mapOf("EUR" to 1.0, "DKK" to 7.4755, "NOK" to 10.84, "SEK" to 11.29, "PLN" to 4.39)

    /** The zone a device gets before the user chooses: by region, else by language. Luxembourg shares DE-LU; Italy is offered as IT-North. */
    private val REGION_ZONE = mapOf(
        "DK" to "dk1", "NO" to "no1", "SE" to "se3", "FI" to "fi", "NL" to "nl", "DE" to "de", "LU" to "de", "FR" to "fr", "PL" to "pl", "IT" to "it-n",
        "AT" to "at", "BE" to "be", "CH" to "ch", "CZ" to "cz", "HU" to "hu", "SI" to "si", "ES" to "es", "PT" to "pt", "SK" to "sk", "GR" to "gr",
        "RO" to "ro", "BG" to "bg", "HR" to "hr", "RS" to "rs", "EE" to "ee", "LV" to "lv", "LT" to "lt", "IE" to "ie", "ME" to "me", "MK" to "mk", "AL" to "al",
    )
    private val LANGUAGE_ZONE = mapOf(
        "da" to "dk1", "nb" to "no1", "nn" to "no1", "no" to "no1", "sv" to "se3", "fi" to "fi", "nl" to "nl", "de" to "de", "fr" to "fr", "pl" to "pl",
        "it" to "it-n", "cs" to "cz", "hu" to "hu", "sl" to "si", "es" to "es", "pt" to "pt", "sk" to "sk", "el" to "gr", "ro" to "ro", "bg" to "bg",
        "hr" to "hr", "sr" to "rs", "et" to "ee", "lv" to "lv", "lt" to "lt", "mk" to "mk", "sq" to "al",
    )
    /** No region, no known language (English in the UK or the US, Japanese …): Germany, the largest market in the list. Owner decision. */
    private const val FALLBACK_ZONE = "de"

    /** Region (ISO code, any case, may be empty) and language (BCP 47 primary subtag, any case) -> zone. Same rule as the contract's defaultZone. */
    fun defaultFor(region: String?, language: String?): Zone {
        val r = (region ?: "").uppercase(Locale.ROOT)
        val l = (language ?: "").lowercase(Locale.ROOT).split('-', '_')[0]
        return byKey[REGION_ZONE[r] ?: LANGUAGE_ZONE[l] ?: FALLBACK_ZONE]!!
    }

    /** The default zone for this device's current locale (the app's own language on Android 13+). */
    fun deviceDefault(locale: Locale = Locale.getDefault()): Zone = defaultFor(locale.country, locale.language)

    /** The country the device is in, when the app covers it (Luxembourg and the rest are not countries of the list). */
    fun deviceCountry(locale: Locale = Locale.getDefault()): String? = locale.country.uppercase(Locale.ROOT).takeIf { it in countries }

    /** The country's name in the given language ("Germany", "Tyskland"). */
    fun countryName(country: String, locale: Locale = Locale.getDefault()): String = Locale("", country).getDisplayCountry(locale)

    /** All countries sorted by their name in the given language (the language's own collation: å after z in Danish, ö after z in Swedish …). */
    fun countriesSorted(locale: Locale = Locale.getDefault()): List<String> {
        val collator = Collator.getInstance(locale)
        return countries.sortedWith { a, b -> collator.compare(countryName(a, locale), countryName(b, locale)) }
    }

    /** What the chip on the price screen says: "NO1 · Oslo" where a city names the zone, otherwise the country's name. */
    fun chipText(zone: Zone, locale: Locale = Locale.getDefault()): String =
        if (zone.city != null) "${zone.code} · ${zone.city}" else countryName(zone.country, locale)
}
