import Foundation

struct TariffEntry {
    let name: String
    let gln: String
    let low: Double   // 00-06
    let mid: Double   // 06-17
    let peak: Double  // 17-21
}

/// Raw Nettarif C record from /api/raw/tariffs (EDS DatahubPricelist, Note =
/// "Nettarif C"). Price1...Price24 are dynamic keys (Price1 = hour 00-01,
/// ... Price24 = hour 23-00), so they're decoded into a plain [Double] rather
/// than 24 hand-written properties.
struct TariffRawRecord: Codable {
    let glnNumber: String
    let validFrom: String
    let validTo: String?
    let resolutionDuration: String
    let hourly: [Double] // 24 entries

    private enum CodingKeys: String, CodingKey {
        case glnNumber = "GLN_Number"
        case validFrom = "ValidFrom"
        case validTo = "ValidTo"
        case resolutionDuration = "ResolutionDuration"
    }

    private struct PriceKey: CodingKey {
        var stringValue: String
        init?(stringValue: String) { self.stringValue = stringValue }
        var intValue: Int? { nil }
        init?(intValue: Int) { nil }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        glnNumber = try c.decode(String.self, forKey: .glnNumber)
        validFrom = try c.decode(String.self, forKey: .validFrom)
        validTo = try c.decodeIfPresent(String.self, forKey: .validTo)
        resolutionDuration = try c.decode(String.self, forKey: .resolutionDuration)

        let priceContainer = try decoder.container(keyedBy: PriceKey.self)
        hourly = try (1...24).map { i in
            try priceContainer.decodeIfPresent(Double.self, forKey: PriceKey(stringValue: "Price\(i)")!) ?? 0
        }
    }
}

struct TariffRawResponse: Codable {
    let records: [TariffRawRecord]
}

struct EnCharges: Codable {
    let sys: Double
    let trans: Double
    let afg: Double

    static let defaults = EnCharges(sys: 0.072, trans: 0.043, afg: 0.008)
}

struct EnChargeRecord: Codable {
    let ChargeTypeCode: String
    let ValidFrom: String
    let ValidTo: String?
    let Price1: Double?
}

struct EnChargesResponse: Codable {
    let records: [EnChargeRecord]

    /// Reduces the raw Energinet charge-type list down to the 3 rates the
    /// app cares about, keeping only whichever revision is active right now.
    func resolved() -> EnCharges {
        var c = EnCharges.defaults
        let now = Date()
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let isoNoFraction = ISO8601DateFormatter()
        func parse(_ s: String) -> Date? { iso.date(from: s) ?? isoNoFraction.date(from: s) }

        for rec in records {
            if let from = parse(rec.ValidFrom + "Z"), from > now { continue }
            if let toStr = rec.ValidTo, let to = parse(toStr + "Z"), to < now { continue }
            switch rec.ChargeTypeCode {
            case "41000": c = EnCharges(sys: rec.Price1 ?? c.sys, trans: c.trans, afg: c.afg)
            case "40000": c = EnCharges(sys: c.sys, trans: rec.Price1 ?? c.trans, afg: c.afg)
            case "EA-001": c = EnCharges(sys: c.sys, trans: c.trans, afg: rec.Price1 ?? c.afg)
            default: break
            }
        }
        return c
    }
}

// Shelly Tibber-compatible format
struct ShellyTariffResponse: Codable {
    let data: ShellyTariffData
}

struct ShellyTariffData: Codable {
    let viewer: ShellyViewer
}

struct ShellyViewer: Codable {
    let homes: [ShellyHome]
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
