import Foundation

/// Et netselskab, som elpriser.org kender. `match` er de navne, Green Power Denmark svarer med.
struct Net: Identifiable, Hashable {
    let name: String
    let gln: String
    let area: String
    let match: [String]
    var id: String { gln }
    var areaLabel: String { L10n.string(area == "DK1" ? "area_label_dk1" : "area_label_dk2") }
}

enum Nets {
    static let all: [Net] = [
        Net(name: "N1", gln: "5790001089030", area: "DK1", match: ["N1", "Elnetselskabet N1"]),
        Net(name: "Trefor", gln: "5790000392261", area: "DK1", match: ["TREFOR El-net"]),
        Net(name: "Konstant", gln: "5790000704842", area: "DK1", match: ["KONSTANT", "Konstant Net"]),
        Net(name: "Dinel", gln: "5790000610099", area: "DK1", match: ["Dinel"]),
        Net(name: "Vores Elnet", gln: "5790000610976", area: "DK1", match: ["Vores Elnet"]),
        Net(name: "Ravdex", gln: "5790000836727", area: "DK1", match: ["Ravdex"]),
        Net(name: "RAH Net", gln: "5790000681327", area: "DK1", match: ["RAH Net", "RAH"]),
        Net(name: "Elværk", gln: "5790000681358", area: "DK1", match: ["Netselskabet Elværk", "Elværk"]),
        Net(name: "Nord Energi", gln: "5790000610877", area: "DK1", match: ["Nord Energi"]),
        Net(name: "NOE Net", gln: "5790000395620", area: "DK1", match: ["NOE Net"]),
        Net(name: "Elnet Midt", gln: "5790001100520", area: "DK1", match: ["Elnet Midt"]),
        Net(name: "Flow Elnet", gln: "5790000392551", area: "DK1", match: ["FLOW Elnet", "Flow"]),
        Net(name: "LNet", gln: "5790001090111", area: "DK1", match: ["L-Net", "LNet"]),
        Net(name: "Veksel", gln: "5790001088217", area: "DK1", match: ["Veksel"]),
        Net(name: "Ikast El Net", gln: "5790000682102", area: "DK1", match: ["Ikast El Net"]),
        Net(name: "Midtfyns Elforsyning", gln: "5790001089023", area: "DK1", match: ["Midtfyns Elforsyning"]),
        Net(name: "Elinord", gln: "5790001095277", area: "DK1", match: ["Elinord"]),
        Net(name: "Læsø Elnet", gln: "5790001103460", area: "DK1", match: ["Læsø Elnet"]),
        Net(name: "Sunds Net", gln: "5790001095444", area: "DK1", match: ["Sunds Net"]),
        Net(name: "Tarm Elværk", gln: "5790000706419", area: "DK1", match: ["Tarm Elværk"]),
        Net(name: "Hammel Elforsyning", gln: "5790001090166", area: "DK1", match: ["Hammel Elforsyning"]),
        Net(name: "Grindsted Elnet", gln: "5790000681105", area: "DK1", match: ["Grindsted Elnet"]),
        Net(name: "Forsyning Elnet", gln: "5790001088309", area: "DK1", match: ["Forsyning Elnet"]),
        Net(name: "Aal El-Net", gln: "5790001095451", area: "DK1", match: ["Aal El-Net"]),
        Net(name: "Hjerting", gln: "5790001095376", area: "DK1", match: ["Hjerting"]),
        Net(name: "Hurup Elværk", gln: "5790000610839", area: "DK1", match: ["Hurup Elværk"]),
        Net(name: "Cerius", gln: "5790000705184", area: "DK2", match: ["Cerius"]),
        Net(name: "Trefor Øst", gln: "5790000706686", area: "DK2", match: ["TREFOR El-Net Øst", "TREFOR El-Net Ost"]),
        Net(name: "Radius", gln: "5790000705689", area: "DK2", match: ["Radius"]),
        Net(name: "Elektrus", gln: "5790000836239", area: "DK2", match: ["Elektrus"]),
        Net(name: "Zeanet", gln: "5790001089375", area: "DK2", match: ["Zeanet"]),
    ]

    static func byGln(_ gln: String?) -> Net? { all.first { $0.gln == gln } }

    /// Matcher det navn, GPD svarer med, mod listen. Længste match vinder ("Trefor Øst" før "Trefor").
    static func match(_ name: String?) -> Net? {
        guard let name, !name.isEmpty else { return nil }
        let lower = name.lowercased()
        var best: (Net, Int)?
        for n in all {
            for m in n.match where lower.contains(m.lowercased()) {
                if best == nil || m.count > best!.1 { best = (n, m.count) }
            }
        }
        return best?.0
    }
}

/// Ét døgn med 24 timepriser i kr/kWh. `lo`/`hi` er P10/P90 på prognosedage.
struct Day: Identifiable {
    let date: String
    let actual: Bool
    let price: [Double]
    let lo: [Double]?
    let hi: [Double]?
    /// Nettariffen pr. time, kr/kWh ekskl. moms (kun på net-visninger; nil ellers, og når API'et ikke sender den).
    var gridTariff: [Double]? = nil
    var id: String { date }

    var localDate: Date { Clock.parse(date) }
}

struct Forecast {
    let area: String
    let mode: String
    let days: [Day]
    let model: String?
    /// Afgifterne, priserne er bygget med (nil hvis API'et ikke sender dem, fx i et ældre svar).
    var charges: Charges? = nil
}

/// Systemtarif, transmissionstarif og elafgift i kr/kWh ekskl. moms, samt momssatsen (0,25).
struct Charges: Equatable {
    let sys: Double
    let trans: Double
    let afg: Double
    let vat: Double
}

struct LookupResult {
    let name: String?
    let error: String?
}

/// The wall clock of the zone the app shows. The API's days and hours follow the zone's own clock (Copenhagen for DK1/DK2,
/// Helsinki for FI, Lisbon for PT ...), so "today", "this hour" and the parsing of a day's date must too. The pure helpers take
/// the zone and the instant explicitly (tests); the short forms use `zone` and now.
enum Clock {
    static let copenhagen = TimeZone(identifier: "Europe/Copenhagen")!
    /// The time zone of the price zone on screen. AppModel sets it whenever the zone changes; Denmark until then.
    static var zone: TimeZone = copenhagen

    static var calendar: Calendar { calendar(in: zone) }

    /// Gregorian calendar on the zone's clock, in the locale of the numbers and dates (weekday numbers do not depend on it).
    static func calendar(in tz: TimeZone) -> Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = tz
        c.locale = L10n.locale
        return c
    }

    static func today(_ now: Date = Date(), in tz: TimeZone? = nil) -> String { format(now, in: tz) }
    static func hour(_ now: Date = Date(), in tz: TimeZone? = nil) -> Int { calendar(in: tz ?? zone).component(.hour, from: now) }

    static func format(_ d: Date, in tz: TimeZone? = nil) -> String {
        let c = calendar(in: tz ?? zone).dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// A day's date ("2026-10-25") as noon on that day in the zone: noon is never a missing or doubled hour on a clock-change day.
    static func parse(_ s: String, in tz: TimeZone? = nil) -> Date {
        let p = s.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return Date() }
        return calendar(in: tz ?? zone).date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12)) ?? Date()
    }
}
