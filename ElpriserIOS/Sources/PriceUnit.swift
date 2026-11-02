import Foundation

/// How a price is written in a zone. Denmark keeps kroner per kWh with two decimals (3,90 kr/kWh), exactly as before; every
/// other zone shows its sub-unit per kWh with one decimal (12,3 ct/kWh, 85,3 øre/kWh): wholesale prices are small numbers, and
/// the whole euro or krone would hide everything that moves.
///
/// The texts come from the catalogue when they are language-dependent (kr, ct), and are the literal sub-unit otherwise (øre,
/// öre, gr). A value is read at the time it is made, so a change of language shows in the next one.
struct PriceUnit: Equatable {
    /// 2 for Danish kroner, 1 for a sub-unit.
    let decimals: Int
    /// Next to a number: "kr", "øre", "ct".
    let short: String
    /// "kr/kWh", "øre/kWh", "ct/kWh" (the euro cent as the language writes it).
    let perKwh: String
    /// How many of the unit make one currency unit: 1 for kroner, 100 for a sub-unit.
    let perMajor: Double
    /// ISO currency of the zone, for amounts in the Smart home screen.
    let currency: String

    var isSubUnit: Bool { perMajor != 1 }

    /// Danish kroner: the unit of /api/forecast.
    static var kroner: PriceUnit {
        PriceUnit(decimals: 2, short: L10n.string("unit_kr"), perKwh: L10n.string("unit_price"), perMajor: 1, currency: "DKK")
    }

    static func of(_ zone: Zone) -> PriceUnit {
        if zone.isDanish { return .kroner }
        if zone.sub == "ct" {
            return PriceUnit(decimals: 1, short: L10n.string("unit_ct"), perKwh: L10n.string("unit_ct_kwh"), perMajor: 100, currency: zone.currency)
        }
        return PriceUnit(decimals: 1, short: zone.sub, perKwh: "\(zone.sub)/kWh", perMajor: 100, currency: zone.currency)
    }

    /// The number alone, in the locale's way: "3,90", "12,3".
    func number(_ v: Double?) -> String { fmt(v, decimals) }

    /// "3,90 kr/kWh": the tooltip, the hero line and the chart summary.
    func withUnit(_ v: Double) -> String { "\(number(v)) \(perKwh)" }

    /// "1,38 kr": a price without the "/kWh", for sentences.
    func amount(_ v: Double) -> String { "\(number(v)) \(short)" }

    /// An amount of money from a value in this unit (a saving, an average over a day), in the zone's currency:
    /// "4,56 kr" in Denmark, "1,23 €" or "€1.23" elsewhere, as the locale writes it.
    func money(_ v: Double) -> String {
        if !isSubUnit { return "\(fmt(v)) \(L10n.string("unit_kr"))" }
        let f = NumberFormatter()
        f.locale = L10n.locale
        f.numberStyle = .currency
        f.currencyCode = currency
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: v / perMajor)) ?? "\(fmt(v / perMajor)) \(currency)"
    }
}
