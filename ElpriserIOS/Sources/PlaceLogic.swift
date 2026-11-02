import Foundation

// The place list ("Where are you?"): the two Danish price areas, the countries and zones, and the pure rules for detail texts,
// search and which country a tap leads to. Nothing here touches the view or the network.

/// The two Danish price areas, named in the app's language.
var placeAreas: [(area: String, name: String)] {
    [("DK1", L10n.string("place_west")), ("DK2", L10n.string("place_east"))]
}

func placeAreaName(_ area: String) -> String {
    placeAreas.first { $0.area == area }?.name ?? area
}

/// The detail at the right of an area row: the saved grid company's name, "Without grid company", or nothing.
/// A saved grid company decides the area; without one it is the chosen area (`chosenArea`) that counts.
func placeAreaDetail(area: String, net: Net?, chosenArea: String) -> String {
    if let net { return net.area == area ? net.name : "" }
    return chosenArea == area ? L10n.string("view_nonet_title") : ""
}

/// Whether the "Without grid company" row of an area is the current one.
func placeIsWithoutNet(area: String, net: Net?, chosenArea: String) -> Bool {
    net == nil && chosenArea == area
}

/// Search across both areas: grid companies whose name contains the query (case and accents ignored).
func placeSearch(_ query: String, in nets: [Net] = Nets.all) -> [Net] {
    let q = query.trimmingCharacters(in: .whitespaces)
    guard !q.isEmpty else { return [] }
    return nets.filter { $0.name.range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
}

func placeNoMatch(_ query: String) -> String {
    L10n.string("place_no_match", query.trimmingCharacters(in: .whitespaces))
}

// MARK: countries

/// The 30 countries sorted by their name in the app's language. This is `localizedStandardCompare` (case and width ignored,
/// numbers by value) with the collation of the language of the texts instead of the device's: "Österreich" sorts with the O's in
/// German, after the Z's in Swedish and Danish ("Østrig").
func placeCountries(locale: Locale = L10n.textLocale) -> [String] {
    func name(_ c: String) -> String { Zones.countryName(c, locale: locale) }
    return Zones.countries.sorted {
        let a = name($0), b = name($1)
        return a.compare(b, options: [.caseInsensitive, .widthInsensitive, .numeric], range: nil, locale: locale) == .orderedAscending
    }
}

/// Search across the countries by their localized name (case and accents ignored), in the sorted order of the list.
func placeSearchCountries(_ query: String, locale: Locale = L10n.textLocale) -> [String] {
    let q = query.trimmingCharacters(in: .whitespaces)
    guard !q.isEmpty else { return [] }
    return placeCountries(locale: locale).filter {
        Zones.countryName($0, locale: locale).range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil
    }
}

/// The detail of a country row: for the current country its zone (NO, SE) or its grid company / "Without grid company" (DK);
/// empty for other countries and for single-zone countries, whose name already says it.
func placeCountryDetail(country: String, zone: Zone, net: Net?) -> String {
    guard zone.country == country else { return "" }
    if zone.isDanish { return net?.name ?? L10n.string("view_nonet_title") }
    return Zones.zones(of: country).count > 1 ? zone.chipLabel : ""
}

/// What a tap on a country leads to.
enum PlaceCountryTarget: Equatable {
    /// One zone, outside Denmark: choose it.
    case choose(Zone)
    /// Several zones (NO, SE): the zone list.
    case zones(String)
    /// Denmark: the Danish screen (position, Vestdanmark/Østdanmark).
    case denmark
}

func placeCountryTarget(_ country: String) -> PlaceCountryTarget {
    if country == "DK" { return .denmark }
    let zs = Zones.zones(of: country)
    if zs.count == 1 { return .choose(zs[0]) }
    return .zones(country)
}

/// Whether the sheet shows the Danish list (position, Vestdanmark/Østdanmark, grid companies) or the list of countries.
/// Decided by the zone on screen; before the user has chosen it is the zone the device's locale gives (Denmark for Danish
/// phones), so a first launch in Germany starts on the country list.
func placeIsDanishContext(zone: Zone) -> Bool { zone.isDanish }

/// Notes at the top of the sheet when the position did not give a grid company.
enum PlaceNote: Equatable {
    case noPosition, denied, outside, noNet, failed

    var text: String {
        switch self {
        case .noPosition: L10n.string("note_no_position")
        case .denied: L10n.string("note_denied")
        case .outside: L10n.string("note_outside_denmark")
        case .noNet: L10n.string("note_no_net")
        case .failed: L10n.string("note_lookup_failed")
        }
    }
}
