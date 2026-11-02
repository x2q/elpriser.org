import Foundation

/// A price zone of /api/nordic. The table below is the one in tests/golden/app-contract.json (zones): test-golden.mjs parses
/// this file and compares it row by row, so the one-line format of the rows is part of the contract.
///
/// `key` is the `zone` parameter of /api/nordic (lower case); dk1 and dk2 are served by /api/forecast (net companies, Danish
/// taxes). `tz` is the zone's own wall clock: the API's days and hours follow it. `sub` is the sub-unit shown per kWh.
/// `city` names the zone where a country has several (NO, SE).
struct Zone: Equatable, Hashable, Identifiable {
    let key: String
    let country: String
    let tz: String
    let currency: String
    let sub: String
    let city: String?

    var id: String { key }
    var isDanish: Bool { country == "DK" }
    var timeZone: TimeZone { TimeZone(identifier: tz) ?? Clock.copenhagen }
    var unit: PriceUnit { PriceUnit.of(self) }

    /// The chip on the price screen: "NO1 · Oslo" where the zone has a city, else the country's name in the app's language.
    var chipLabel: String {
        if let city { return "\(key.uppercased()) \u{00B7} \(city)" }
        return Zones.countryName(country)
    }

    /// The one-line note under the caption for the two zones that are not what their country name suggests.
    var noteKey: String? {
        switch key {
        case "de": return "note_zone_de_lu"
        case "it-n": return "note_zone_it_n"
        default: return nil
        }
    }
}

enum Zones {
    static let all: [Zone] = [
        Zone(key: "dk1", country: "DK", tz: "Europe/Copenhagen", currency: "DKK", sub: "øre", city: nil),
        Zone(key: "dk2", country: "DK", tz: "Europe/Copenhagen", currency: "DKK", sub: "øre", city: nil),
        Zone(key: "no1", country: "NO", tz: "Europe/Oslo", currency: "NOK", sub: "øre", city: "Oslo"),
        Zone(key: "no2", country: "NO", tz: "Europe/Oslo", currency: "NOK", sub: "øre", city: "Kristiansand"),
        Zone(key: "no3", country: "NO", tz: "Europe/Oslo", currency: "NOK", sub: "øre", city: "Trondheim"),
        Zone(key: "no4", country: "NO", tz: "Europe/Oslo", currency: "NOK", sub: "øre", city: "Tromsø"),
        Zone(key: "no5", country: "NO", tz: "Europe/Oslo", currency: "NOK", sub: "øre", city: "Bergen"),
        Zone(key: "se1", country: "SE", tz: "Europe/Stockholm", currency: "SEK", sub: "öre", city: "Luleå"),
        Zone(key: "se2", country: "SE", tz: "Europe/Stockholm", currency: "SEK", sub: "öre", city: "Sundsvall"),
        Zone(key: "se3", country: "SE", tz: "Europe/Stockholm", currency: "SEK", sub: "öre", city: "Stockholm"),
        Zone(key: "se4", country: "SE", tz: "Europe/Stockholm", currency: "SEK", sub: "öre", city: "Malmö"),
        Zone(key: "fi", country: "FI", tz: "Europe/Helsinki", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "nl", country: "NL", tz: "Europe/Amsterdam", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "de", country: "DE", tz: "Europe/Berlin", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "fr", country: "FR", tz: "Europe/Paris", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "pl", country: "PL", tz: "Europe/Warsaw", currency: "PLN", sub: "gr", city: nil),
        Zone(key: "it-n", country: "IT", tz: "Europe/Rome", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "at", country: "AT", tz: "Europe/Vienna", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "be", country: "BE", tz: "Europe/Brussels", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "ch", country: "CH", tz: "Europe/Zurich", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "cz", country: "CZ", tz: "Europe/Prague", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "hu", country: "HU", tz: "Europe/Budapest", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "si", country: "SI", tz: "Europe/Ljubljana", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "es", country: "ES", tz: "Europe/Madrid", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "pt", country: "PT", tz: "Europe/Lisbon", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "sk", country: "SK", tz: "Europe/Bratislava", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "gr", country: "GR", tz: "Europe/Athens", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "ro", country: "RO", tz: "Europe/Bucharest", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "bg", country: "BG", tz: "Europe/Sofia", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "hr", country: "HR", tz: "Europe/Zagreb", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "rs", country: "RS", tz: "Europe/Belgrade", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "ee", country: "EE", tz: "Europe/Tallinn", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "lv", country: "LV", tz: "Europe/Riga", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "lt", country: "LT", tz: "Europe/Vilnius", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "ie", country: "IE", tz: "Europe/Dublin", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "me", country: "ME", tz: "Europe/Podgorica", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "mk", country: "MK", tz: "Europe/Skopje", currency: "EUR", sub: "ct", city: nil),
        Zone(key: "al", country: "AL", tz: "Europe/Tirane", currency: "EUR", sub: "ct", city: nil),
    ]

    /// The zone a device gets before the user chooses: by the device's region, else by its language.
    /// Luxembourg shares DE-LU; Italy is offered as IT-North only.
    private static let regionZone: [String: String] = [
        "DK": "dk1", "NO": "no1", "SE": "se3", "FI": "fi", "NL": "nl", "DE": "de", "LU": "de", "FR": "fr", "PL": "pl", "IT": "it-n",
        "AT": "at", "BE": "be", "CH": "ch", "CZ": "cz", "HU": "hu", "SI": "si", "ES": "es", "PT": "pt", "SK": "sk", "GR": "gr",
        "RO": "ro", "BG": "bg", "HR": "hr", "RS": "rs", "EE": "ee", "LV": "lv", "LT": "lt", "IE": "ie", "ME": "me", "MK": "mk", "AL": "al",
    ]
    private static let languageZone: [String: String] = [
        "da": "dk1", "nb": "no1", "nn": "no1", "no": "no1", "sv": "se3", "fi": "fi", "nl": "nl", "de": "de", "fr": "fr", "pl": "pl",
        "it": "it-n", "cs": "cz", "hu": "hu", "sl": "si", "es": "es", "pt": "pt", "sk": "sk", "el": "gr", "ro": "ro", "bg": "bg",
        "hr": "hr", "sr": "rs", "et": "ee", "lv": "lv", "lt": "lt", "mk": "mk", "sq": "al",
    ]
    /// No region, no known language (English in the UK or the US, Japanese ...): Germany, the largest market in the list. Owner decision.
    static let fallbackKey = "de"

    /// The ECB reference rates the app falls back to when a response carries no rate (the API's own FX_FALLBACK).
    static let fxFallback: [String: Double] = ["EUR": 1, "DKK": 7.4755, "NOK": 10.84, "SEK": 11.29, "PLN": 4.39]

    static func byKey(_ key: String?) -> Zone? {
        guard let key = key?.lowercased() else { return nil }
        return all.first { $0.key == key }
    }

    /// The countries in table order (30).
    static var countries: [String] {
        var seen = Set<String>(), out: [String] = []
        for z in all where seen.insert(z.country).inserted { out.append(z.country) }
        return out
    }

    static func zones(of country: String) -> [Zone] { all.filter { $0.country == country.uppercased() } }

    static func isDanish(_ key: String?) -> Bool { byKey(key)?.isDanish ?? false }

    /// Region (ISO code, any case, may be empty) and language (BCP 47, primary subtag counts) -> the zone to start on.
    static func defaultFor(region: String?, language: String?) -> Zone {
        let r = (region ?? "").uppercased()
        let l = String((language ?? "").lowercased().split(whereSeparator: { $0 == "-" || $0 == "_" }).first ?? "")
        return byKey(regionZone[r] ?? languageZone[l] ?? fallbackKey)!
    }

    /// Same, from the device's locale.
    static func defaultFor(locale: Locale = .current) -> Zone {
        defaultFor(region: locale.region?.identifier, language: locale.language.languageCode?.identifier)
    }

    /// The country's name in the app's language ("Tyskland", "Deutschland", "Germany"); the code if the system has none.
    static func countryName(_ code: String, locale: Locale = L10n.textLocale) -> String {
        locale.localizedString(forRegionCode: code) ?? code
    }

    /// The device's own country when the app has a zone for it (Luxembourg counts: it shares DE-LU, but has no row of its own).
    static func deviceCountry(locale: Locale = .current) -> String? {
        guard let r = locale.region?.identifier.uppercased(), countries.contains(r) else { return nil }
        return r
    }
}
