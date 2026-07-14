import Foundation

@Observable
class PriceViewModel {
    var days: [PriceDay] = []
    var isLoading = false
    var error: String?
    var weekOffset = 0

    var weekLabel: String {
        if weekOffset == 0 { return "Denne uge" }
        if weekOffset == -1 { return "Forrige uge" }
        return "\(abs(weekOffset)) uger siden"
    }

    var canGoForward: Bool { weekOffset < 0 }

    var allPrices: [Double] {
        days.flatMap { $0.prices.compactMap { $0 } }
    }

    var priceRange: (min: Double, max: Double) {
        let valid = allPrices
        guard !valid.isEmpty else { return (0, 1) }
        let mn = valid.min()!
        let mx = valid.max()!
        return (mn, mx == mn ? mn + 0.01 : mx)
    }

    func load(area: Area, mode: PriceMode, gln: String?) async {
        isLoading = true
        error = nil

        let now = Date()
        let cal = Calendar.current
        let center = cal.date(byAdding: .day, value: weekOffset * 7, to: now)!
        let start = cal.date(byAdding: .day, value: -7, to: center)!
        let end = cal.date(byAdding: .day, value: 2, to: center)!

        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        let startStr = df.string(from: start)
        let endStr = df.string(from: end)

        do {
            let resp = try await ElpriserAPI.shared.fetchEnergyPrices(area: area, start: startStr, end: endStr)
            let grouped = processRecords(resp.records, mode: mode, gln: gln)
            await MainActor.run {
                self.days = grouped.suffix(8)
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                self.error = error.localizedDescription
                self.isLoading = false
            }
        }
    }

    func changeWeek(_ delta: Int) {
        let next = weekOffset + delta
        if next > 0 { return }
        weekOffset = next
    }

    private func processRecords(_ records: [EnergyRecord], mode: PriceMode, gln: String?) -> [PriceDay] {
        // Group by date
        var byDate: [String: [Double?]] = [:]
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"

        for rec in records {
            let timeParts = rec.HourDK.prefix(19)
            if let date = df.date(from: String(timeParts)) {
                let dateDf = DateFormatter()
                dateDf.dateFormat = "yyyy-MM-dd"
                let dateStr = dateDf.string(from: date)
                let hour = Calendar.current.component(.hour, from: date)

                if byDate[dateStr] == nil {
                    byDate[dateStr] = Array(repeating: nil, count: 24)
                }
                if let spot = rec.SpotPriceDKK {
                    let converted = convertPrice(spotDKKMWh: spot, hour: hour, mode: mode)
                    byDate[dateStr]?[hour] = converted
                }
            }
        }

        return byDate.keys.sorted().map { date in
            PriceDay(date: date, prices: byDate[date] ?? Array(repeating: nil, count: 24))
        }
    }

    private func convertPrice(spotDKKMWh: Double, hour: Int, mode: PriceMode) -> Double {
        let spot = spotDKKMWh / 1000.0
        let sys = 0.072, trans = 0.043, afg = 0.008

        switch mode {
        case .spotEx:
            return spot
        case .spotInkl:
            return spot * 1.25
        case .inklAlt:
            return (spot + sys + trans + afg) * 1.25
        case .inklAltMinus:
            return (spot + sys + trans) * 1.25
        case .netInklAlt:
            return (spot + sys + trans + afg) * 1.25 // TODO: add network tariff
        case .netInklTarif:
            return (spot + sys + trans) * 1.25 // TODO: add network tariff
        }
    }
}
