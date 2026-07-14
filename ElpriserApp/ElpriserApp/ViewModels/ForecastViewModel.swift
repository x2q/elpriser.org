import Foundation

@Observable
class ForecastViewModel {
    var days: [ForecastDay] = []
    var isLoading = false
    var error: String?
    var generated: String?

    var allPrices: [Double] {
        days.flatMap { $0.prices.compactMap { $0.price } }
    }

    var priceRange: (min: Double, max: Double) {
        let valid = allPrices
        guard !valid.isEmpty else { return (0, 1) }
        let mn = valid.min()!
        let mx = valid.max()!
        return (mn, mx == mn ? mn + 0.01 : mx)
    }

    func load(area: Area, mode: PriceMode) async {
        isLoading = true
        error = nil
        do {
            let resp = try await ElpriserAPI.shared.fetchForecast(area: area, mode: mode)
            await MainActor.run {
                self.days = resp.days
                self.generated = resp.generated
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
