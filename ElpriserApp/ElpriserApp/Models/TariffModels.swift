import Foundation

struct TariffEntry {
    let name: String
    let gln: String
    let low: Double   // 00-06
    let mid: Double   // 06-17
    let peak: Double  // 17-21
}

struct EnCharges: Codable {
    let sys: Double
    let trans: Double
    let afg: Double
}

// Shelly Tibber-compatible format
struct ShellyTariffResponse: Codable {
    let viewer: ShellyViewer
}

struct ShellyViewer: Codable {
    let home: ShellyHome
}

struct ShellyHome: Codable {
    let currentSubscription: ShellySubscription
}

struct ShellySubscription: Codable {
    let priceInfo: ShellyPriceInfo
}

struct ShellyPriceInfo: Codable {
    let today: [ShellyPriceEntry]
    let tomorrow: [ShellyPriceEntry]?
}

struct ShellyPriceEntry: Identifiable, Codable {
    let total: Double
    let startsAt: String
    let currency: String?
    let level: String?

    var id: String { startsAt }

    var hour: Int {
        // Parse ISO-8601: "2025-01-15T14:00:00.000+01:00"
        let parts = startsAt.split(separator: "T")
        guard parts.count > 1 else { return 0 }
        let timePart = parts[1].prefix(2)
        return Int(timePart) ?? 0
    }
}
