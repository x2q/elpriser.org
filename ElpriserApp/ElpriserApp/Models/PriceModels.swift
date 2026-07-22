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

// CO₂ emission per kWh — /api/raw/co2 (Energinet CO2EmisProg, hourly averages)
struct Co2Record: Codable {
    let date: String
    let hour: Int
    let co2: Int // g/kWh
}

struct Co2Response: Codable {
    let area: String
    let unit: String
    let records: [Co2Record]
}

// Raw record from Energi Data Service (proxied through elpriser.org/api/raw/prices)
struct EnergyRecord: Codable {
    let TimeDK: String
    let DayAheadPriceDKK: Double?
    let DayAheadPriceEUR: Double?
    let PriceArea: String?
}

struct EnergyDataResponse: Codable {
    let records: [EnergyRecord]
}
