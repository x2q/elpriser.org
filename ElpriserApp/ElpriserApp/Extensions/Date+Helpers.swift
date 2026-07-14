import Foundation

extension Date {
    static let danishDateFormatter: DateFormatter = {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        df.locale = Locale(identifier: "da_DK")
        return df
    }()

    static let danishWeekdayFormatter: DateFormatter = {
        let df = DateFormatter()
        df.locale = Locale(identifier: "da_DK")
        df.dateFormat = "EEE"
        return df
    }()

    static let danishMonthFormatter: DateFormatter = {
        let df = DateFormatter()
        df.locale = Locale(identifier: "da_DK")
        df.dateFormat = "MMMM yyyy"
        return df
    }()

    var dateString: String {
        Self.danishDateFormatter.string(from: self)
    }

    var shortWeekday: String {
        Self.danishWeekdayFormatter.string(from: self).lowercased()
    }

    var monthYear: String {
        Self.danishMonthFormatter.string(from: self).capitalized
    }

    var dayOfMonth: Int {
        Calendar.current.component(.day, from: self)
    }

    var hour: Int {
        Calendar.current.component(.hour, from: self)
    }

    var isToday: Bool {
        Calendar.current.isDateInToday(self)
    }
}

extension String {
    /// Parse "yyyy-MM-dd" to Date
    var asDate: Date? {
        Date.danishDateFormatter.date(from: self)
    }
}
