import Foundation

enum Area: String, CaseIterable, Identifiable, Codable {
    case dk1 = "DK1"
    case dk2 = "DK2"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .dk1: return "DK1 Vest"
        case .dk2: return "DK2 Øst"
        }
    }

    var shortName: String {
        switch self {
        case .dk1: return "DK1"
        case .dk2: return "DK2"
        }
    }
}

enum PriceMode: String, CaseIterable, Identifiable, Codable {
    case spotEx = "spot_ex"
    case spotInkl = "spot_inkl"
    case inklAlt = "inkl_alt"
    case inklAltMinus = "inkl_alt_minus"
    case netInklAlt = "net_inkl_alt"
    case netInklTarif = "net_inkl_tarif"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .spotEx: return "Elspot ex moms"
        case .spotInkl: return "Elspot inkl moms"
        case .inklAlt: return "Inkl alt (spot+tarif+afgift)"
        case .inklAltMinus: return "Inkl alt minus afgift"
        case .netInklAlt: return "Netselskab inkl alt"
        case .netInklTarif: return "Netselskab inkl tarif"
        }
    }

    var requiresNetwork: Bool {
        switch self {
        case .netInklAlt, .netInklTarif: return true
        default: return false
        }
    }
}

enum Strategy: String, CaseIterable, Identifiable, Codable {
    case cheapestN = "cheapest_n"
    case cheapestPct = "cheapest_pct"
    case avoidExpensiveN = "avoid_expensive_n"
    case avoidExpensivePct = "avoid_expensive_pct"
    case avoidPeak = "avoid_peak"
    case nightCheap = "night_cheap"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .cheapestN: return "Billigste N timer/dag"
        case .cheapestPct: return "Billigste X% af timer"
        case .avoidExpensiveN: return "Undgå dyreste N timer/dag"
        case .avoidExpensivePct: return "Undgå dyreste X% af timer"
        case .avoidPeak: return "Undgå spidstimer 17-21"
        case .nightCheap: return "Kun nattetimer 23-06"
        }
    }

    var requiresParam: Bool {
        switch self {
        case .avoidPeak, .nightCheap: return false
        default: return true
        }
    }

    var paramLabel: String {
        switch self {
        case .cheapestN, .avoidExpensiveN: return "Timer/dag"
        case .cheapestPct, .avoidExpensivePct: return "Procent"
        default: return ""
        }
    }

    var helpText: String {
        switch self {
        case .cheapestN: return "Tænder i de N billigste timer hver dag"
        case .cheapestPct: return "Tænder i de billigste X% af timerne"
        case .avoidExpensiveN: return "Tænder i alle timer undtagen de N dyreste"
        case .avoidExpensivePct: return "Tænder i alle timer undtagen de dyreste X%"
        case .avoidPeak: return "Slukker kl. 17-21, tændt resten af døgnet"
        case .nightCheap: return "Kun tændt kl. 23-06"
        }
    }

    var paramKey: String {
        switch self {
        case .cheapestN, .avoidExpensiveN: return "hours"
        case .cheapestPct, .avoidExpensivePct: return "pct"
        default: return ""
        }
    }
}

enum DeviceType: String, CaseIterable, Identifiable {
    case heatPump = "Varmepumpe"
    case electricCar = "Elbil"
    case dishwasher = "Opvaskemaskine"
    case washingMachine = "Vaskemaskine"
    case dehumidifier = "Affugter"
    case waterHeater = "Varmtvandsbeholder"

    var id: String { rawValue }
    var displayName: String { rawValue }

    var defaultStrategy: Strategy {
        switch self {
        case .heatPump: return .cheapestN
        case .electricCar: return .nightCheap
        case .dishwasher: return .cheapestN
        case .washingMachine: return .cheapestN
        case .dehumidifier: return .cheapestPct
        case .waterHeater: return .cheapestN
        }
    }

    var defaultHours: Int {
        switch self {
        case .heatPump: return 12
        case .electricCar: return 6
        case .dishwasher: return 3
        case .washingMachine: return 3
        case .dehumidifier: return 50
        case .waterHeater: return 6
        }
    }
}

struct NetworkOperator: Identifiable, Codable, Hashable {
    let name: String
    let slug: String
    let gln: String

    var id: String { gln }
}

struct NetworkOperators {
    static let dk1: [NetworkOperator] = [
        NetworkOperator(name: "N1", slug: "n1", gln: "5790001089030"),
        NetworkOperator(name: "Trefor", slug: "trefor", gln: "5790000392261"),
        NetworkOperator(name: "Konstant", slug: "konstant", gln: "5790000704842"),
        NetworkOperator(name: "Vores Elnet", slug: "vores-elnet", gln: "5790000610976"),
        NetworkOperator(name: "RAH Net", slug: "rah-net", gln: "5790000681327"),
        NetworkOperator(name: "Elværk", slug: "elvaerk", gln: "5790000681358"),
        NetworkOperator(name: "Nord Energi", slug: "nord-energi", gln: "5790000610877"),
        NetworkOperator(name: "NOE Net", slug: "noe-net", gln: "5790000395620"),
        NetworkOperator(name: "Elnet Midt", slug: "elnet-midt", gln: "5790001100520"),
        NetworkOperator(name: "Flow Elnet", slug: "flow-elnet", gln: "5790000392551"),
        NetworkOperator(name: "LNet", slug: "lnet", gln: "5790001090111"),
    ]

    static let dk2: [NetworkOperator] = [
        NetworkOperator(name: "Cerius", slug: "cerius", gln: "5790000705184"),
        NetworkOperator(name: "Trefor Øst", slug: "trefor-ost", gln: "5790000706686"),
        NetworkOperator(name: "Radius", slug: "radius", gln: "5790000705689"),
    ]

    static func forArea(_ area: Area) -> [NetworkOperator] {
        switch area {
        case .dk1: return dk1
        case .dk2: return dk2
        }
    }

    static func find(gln: String) -> (area: Area, net: NetworkOperator)? {
        if let n = dk1.first(where: { $0.gln == gln }) { return (.dk1, n) }
        if let n = dk2.first(where: { $0.gln == gln }) { return (.dk2, n) }
        return nil
    }
}
