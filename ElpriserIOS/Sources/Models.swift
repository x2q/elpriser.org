import Foundation

/// Et netselskab, som elpriser.org kender. `match` er de navne, Green Power Denmark svarer med.
struct Net: Identifiable, Hashable {
    let name: String
    let gln: String
    let area: String
    let match: [String]
    var id: String { gln }
    var areaLabel: String { area == "DK1" ? "DK1 Vest" : "DK2 Øst" }
}

enum Nets {
    static let all: [Net] = [
        Net(name: "N1", gln: "5790001089030", area: "DK1", match: ["N1", "Elnetselskabet N1"]),
        Net(name: "Trefor", gln: "5790000392261", area: "DK1", match: ["TREFOR El-net"]),
        Net(name: "Konstant", gln: "5790000704842", area: "DK1", match: ["KONSTANT", "Konstant Net"]),
        Net(name: "Vores Elnet", gln: "5790000610976", area: "DK1", match: ["Vores Elnet"]),
        Net(name: "RAH Net", gln: "5790000681327", area: "DK1", match: ["RAH Net", "RAH"]),
        Net(name: "Elværk", gln: "5790000681358", area: "DK1", match: ["Netselskabet Elværk", "Elværk"]),
        Net(name: "Nord Energi", gln: "5790000610877", area: "DK1", match: ["Nord Energi"]),
        Net(name: "NOE Net", gln: "5790000395620", area: "DK1", match: ["NOE Net"]),
        Net(name: "Elnet Midt", gln: "5790001100520", area: "DK1", match: ["Elnet Midt"]),
        Net(name: "Flow Elnet", gln: "5790000392551", area: "DK1", match: ["FLOW Elnet", "Flow"]),
        Net(name: "LNet", gln: "5790001090111", area: "DK1", match: ["L-Net", "LNet"]),
        Net(name: "Cerius", gln: "5790000705184", area: "DK2", match: ["Cerius"]),
        Net(name: "Trefor Øst", gln: "5790000706686", area: "DK2", match: ["TREFOR El-Net Øst", "TREFOR El-Net Ost"]),
        Net(name: "Radius", gln: "5790000705689", area: "DK2", match: ["Radius"]),
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
    var id: String { date }

    var localDate: Date { Clock.parse(date) }
}

struct Forecast {
    let area: String
    let mode: String
    let days: [Day]
    let model: String?
}

struct LookupResult {
    let name: String?
    let error: String?
}

enum Clock {
    static let zone = TimeZone(identifier: "Europe/Copenhagen")!
    static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = zone
        c.locale = Locale(identifier: "da_DK")
        return c
    }
    static func today() -> String { format(Date()) }
    static func hour() -> Int { calendar.component(.hour, from: Date()) }
    static func format(_ d: Date) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }
    static func parse(_ s: String) -> Date {
        let p = s.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return Date() }
        return calendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12)) ?? Date()
    }
}
