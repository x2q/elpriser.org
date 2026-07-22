import Foundation

struct ForecastDay: Identifiable, Codable {
    let date: String
    let type: String // "actual" or "forecast"
    let weekday: Int // 0 = Sunday ... 6 = Saturday (JS Date#getUTCDay convention)
    let prices: [ForecastPrice]

    var id: String { date }

    var isActual: Bool { type == "actual" }

    /// Short localized weekday label, e.g. "ons" — derived from `date` rather
    /// than the raw `weekday` index so it stays in sync with the same
    /// Danish-locale formatting used everywhere else in the app.
    var shortWeekdayLabel: String {
        date.asDate?.shortWeekday ?? ""
    }

    var dayNumber: Int {
        date.asDate?.dayOfMonth ?? 0
    }

    var isToday: Bool {
        date == Date().dateString
    }
}

struct ForecastPrice: Codable {
    let hour: Int
    let price: Double?
    let min: Double?
    let max: Double?
}

struct ForecastResponse: Codable {
    let area: String
    let mode: String
    let generated: String?
    let days: [ForecastDay]
}
