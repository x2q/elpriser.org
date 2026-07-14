import Foundation

struct ForecastDay: Identifiable, Codable {
    let date: String
    let type: String // "actual" or "forecast"
    let weekday: String
    let prices: [ForecastPrice]

    var id: String { date }

    var isActual: Bool { type == "actual" }
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
