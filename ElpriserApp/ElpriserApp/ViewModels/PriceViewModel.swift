import Foundation

/// Backs the "Nu" home screen: today's hourly prices + CO₂, the verdict
/// pills, best/worst/greenest windows, and the combined advice sentence.
@Observable
class PriceViewModel {
    var prices: [Double?] = []          // 24 entries for today
    var co2: [Int?] = []                // 24 entries for today, g/kWh
    var currentHour: Int = 0
    var currentPrice: Double?
    var isLoading = false
    var error: String?

    enum Verdict { case billig, middel, dyr }

    struct Window {
        let hour: Int
        let price: Double
    }

    var validPrices: [(h: Int, p: Double)] {
        prices.enumerated().compactMap { h, p in p.map { (h, $0) } }
    }
    var validCo2: [(h: Int, v: Int)] {
        co2.enumerated().compactMap { h, v in v.map { (h, $0) } }
    }

    /// Fraction of today's hours that are more expensive than now (0-100).
    var cheaperThanPct: Int? {
        guard let now = currentPrice, !validPrices.isEmpty else { return nil }
        let cheaper = validPrices.filter { $0.p < now }.count
        return 100 - Int(Double(cheaper) / Double(validPrices.count) * 100)
    }

    var verdict: Verdict? {
        guard let now = currentPrice, !validPrices.isEmpty else { return nil }
        let cheaper = validPrices.filter { $0.p < now }.count
        let pct = Double(cheaper) / Double(validPrices.count) * 100
        return pct <= 33 ? .billig : pct <= 66 ? .middel : .dyr
    }

    var best: (h: Int, p: Double)? { validPrices.min { $0.p < $1.p } }
    var worst: (h: Int, p: Double)? { validPrices.max { $0.p < $1.p } }
    var greenest: (h: Int, v: Int)? { validCo2.min { $0.v < $1.v } }
    var currentCo2: Int? { currentHour < co2.count ? co2[currentHour] : nil }
    var isGreenestNow: Bool { greenest?.h == currentHour }

    /// One truthful, actionable sentence combining price and CO₂ — only makes
    /// a CO₂ claim when the CO₂ numbers actually support it (cheap hours are
    /// not always green).
    var advice: String? {
        guard let now = currentPrice else { return nil }
        let later = validPrices.filter { $0.h > currentHour }
        guard !later.isEmpty else { return nil }
        let lBest = later.min { $0.p < $1.p }!
        let lWorst = later.max { $0.p < $1.p }!
        let nowC = currentCo2

        let saveWait = Int((1 - lBest.p / now) * 100)
        let savePeak = Int((1 - now / lWorst.p) * 100)

        if saveWait >= 25 {
            var s = "Vent til kl. \(String(format: "%02d", lBest.h)) — så betaler du \(saveWait) % mindre"
            if let c = nowC, let cAtBest = co2[lBest.h] {
                if Double(cAtBest) <= Double(c) * 0.9 {
                    s += " og udleder \(Int((1 - Double(cAtBest) / Double(c)) * 100)) % mindre CO₂"
                } else if Double(cAtBest) > Double(c) * 1.2 {
                    s += ". Strømmen er dog grønnere nu (\(c) g CO₂) end til den tid (\(cAtBest) g)"
                }
            }
            return s + "."
        }
        if savePeak >= 40 {
            var s = "Kør strømtunge apparater nu i stedet for kl. \(String(format: "%02d", lWorst.h)) — betal \(savePeak) % mindre"
            if let c = nowC, let cAtPeak = co2[lWorst.h], Double(c) <= Double(cAtPeak) * 0.9 {
                s += " og udled \(Int((1 - Double(c) / Double(cAtPeak)) * 100)) % mindre CO₂"
            }
            return s + "."
        }
        return nil
    }

    func load(area: Area, mode: PriceMode, gln: String?) async {
        isLoading = prices.isEmpty
        error = nil
        do {
            async let priceResp = ElpriserAPI.shared.fetchPrices(area: area, mode: mode, gln: gln)
            let co2Resp = try? await ElpriserAPI.shared.fetchCo2(area: area)
            let p = try await priceResp

            var hourly: [Double?] = Array(repeating: nil, count: 24)
            for e in p.prices where e.hour < 24 { hourly[e.hour] = e.price }
            var co2Hourly: [Int?] = Array(repeating: nil, count: 24)
            if let c = co2Resp {
                for r in c.records where r.date == p.date && r.hour < 24 { co2Hourly[r.hour] = r.co2 }
            }
            let curHour = p.current_hour ?? Calendar.current.component(.hour, from: Date())
            let curPrice = p.current_price ?? hourly[min(curHour, 23)]
            let finalHourly = hourly, finalCo2 = co2Hourly

            await MainActor.run {
                self.prices = finalHourly
                self.co2 = finalCo2
                self.currentHour = curHour
                self.currentPrice = curPrice
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                self.error = error.localizedDescription
                self.isLoading = false
            }
        }
    }
}
