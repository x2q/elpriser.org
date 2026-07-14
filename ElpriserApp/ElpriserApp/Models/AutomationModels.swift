import Foundation

struct ScheduleHour: Identifiable, Codable {
    let hour: Int
    let price: Double?
    let on: Bool

    var id: Int { hour }
}

struct ScheduleResponse: Codable {
    let area: String
    let mode: String
    let strategy: String
    let param: Int?
    let date: String
    let on_now: Bool?
    let schedule: [ScheduleHour]
}

struct NowResponse: Codable {
    let on: Bool
    let price: Double?
    let hour: Int
    let area: String
    let strategy: String?
}

struct ScheduleDay: Identifiable {
    let date: String
    let schedule: [ScheduleHour]

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
