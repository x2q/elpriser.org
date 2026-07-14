import Foundation

struct HourlyPrice: Identifiable, Codable {
    let hour: Int
    let price: Double?

    var id: Int { hour }
}

struct PriceResponse: Codable {
    let area: String
    let mode: String
    let date: String
    let unit: String?
    let prices: [HourlyPrice]
    let current_hour: Int?
    let current_price: Double?
}

struct PriceDay: Identifiable {
    let date: String
    let prices: [Double?] // 24 entries, one per hour

    var id: String { date }

    var weekday: String {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        df.locale = Locale(identifier: "da_DK")
        guard let d = df.date(from: date) else { return "" }
        let wdf = DateFormatter()
        wdf.locale = Locale(identifier: "da_DK")
        wdf.dateFormat = "EEE"
        return wdf.string(from: d).lowercased()
    }

    var dayNumber: Int {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        guard let d = df.date(from: date) else { return 0 }
        return Calendar.current.component(.day, from: d)
    }

    var isToday: Bool {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        return date == df.string(from: Date())
    }
}

// Raw record from Energi Data Service
struct EnergyRecord: Codable {
    let HourDK: String
    let SpotPriceDKK: Double?
    let SpotPriceEUR: Double?
    let PriceArea: String?
}

struct EnergyDataResponse: Codable {
    let records: [EnergyRecord]
}
