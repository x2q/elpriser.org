import SwiftUI

/// Prognose — Weather-app style: one row per day with its min price, a
/// range bar on a shared scale, and its max price. The whole week reads
/// at a glance; no grid, no sideways scrolling.
struct ForecastView: View {
    @Bindable var settings: SettingsViewModel
    @State private var vm = ForecastViewModel()
    @State private var fcArea: Area = .dk1
    @State private var fcMode: PriceMode = .inklAlt

    var body: some View {
        Group {
            if vm.isLoading {
                ProgressView("Henter prognose...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = vm.error {
                ErrorStateView(message: error, retry: loadData)
            } else {
                List {
                    Section {
                        ForEach(vm.days) { day in
                            ForecastRangeRow(day: day, range: vm.priceRange, isCheapest: cheapestDayDate == day.date)
                        }
                    } footer: {
                        Text("Bjælken viser døgnets spænd fra billigste til dyreste time på fælles skala. \u{201C}Børspris\u{201D} er faktiske priser fra Nord Pool; \u{201C}prognose\u{201D} er modelberegnet ud fra historiske prismønstre.")
                    }
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Menu {
                    Section("Priszone") {
                        ForEach(Area.allCases) { a in
                            Button {
                                fcArea = a
                            } label: {
                                Label(a.displayName, systemImage: fcArea == a ? "checkmark" : "")
                            }
                        }
                    }
                    Section("Pristype") {
                        Button { fcMode = .spotInkl } label: {
                            Label("Elspot inkl moms", systemImage: fcMode == .spotInkl ? "checkmark" : "")
                        }
                        Button { fcMode = .inklAlt } label: {
                            Label("Inkl alt", systemImage: fcMode == .inklAlt ? "checkmark" : "")
                        }
                        Button { fcMode = .inklAltMinus } label: {
                            Label("Inkl alt minus afgift", systemImage: fcMode == .inklAltMinus ? "checkmark" : "")
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text("\(fcArea.shortName) \(fcMode.shortDisplayName)")
                            .font(.headline)
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.caption2.weight(.bold))
                    }
                    .foregroundStyle(.primary)
                }
            }
        }
        .onAppear { loadData() }
        .onChange(of: fcArea) { _, _ in loadData() }
        .onChange(of: fcMode) { _, _ in loadData() }
    }

    /// Date of the forecast day with the lowest daily max — "ugens billigste".
    private var cheapestDayDate: String? {
        vm.days
            .compactMap { d -> (String, Double)? in
                let ps = d.prices.compactMap(\.price)
                return ps.isEmpty ? nil : (d.date, ps.max()!)
            }
            .min { $0.1 < $1.1 }?.0
    }

    private func loadData() {
        Task { await vm.load(area: fcArea, mode: fcMode) }
    }
}

private struct ForecastRangeRow: View {
    let day: ForecastDay
    let range: (min: Double, max: Double)
    let isCheapest: Bool

    private var lo: Double? { day.prices.compactMap(\.price).min() }
    private var hi: Double? { day.prices.compactMap(\.price).max() }

    private func fmt(_ v: Double) -> String {
        String(format: "%.2f", v).replacingOccurrences(of: ".", with: ",")
    }

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 0) {
                Text(day.isToday ? "I dag" : day.shortWeekdayLabel.capitalized)
                    .font(.subheadline.weight(.semibold))
                Text(day.isActual ? "Børspris" : "Prognose")
                    .font(.system(size: 9.5, weight: .medium))
                    .foregroundStyle(day.isActual ? Color.brand : .secondary)
            }
            .frame(width: 68, alignment: .leading)

            if let lo, let hi {
                Text(fmt(lo))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .frame(width: 38, alignment: .trailing)

                GeometryReader { geo in
                    let span = max(range.max - range.min, 0.01)
                    let x0 = (lo - range.min) / span * geo.size.width
                    let x1 = (hi - range.min) / span * geo.size.width
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(Color(.systemGray5))
                            .frame(height: 5)
                        Capsule()
                            .fill(LinearGradient(
                                colors: [Color(red: 0.20, green: 0.78, blue: 0.35),
                                         Color(red: 1.00, green: 0.80, blue: 0.00),
                                         Color(red: 1.00, green: 0.58, blue: 0.00)],
                                startPoint: .leading, endPoint: .trailing))
                            .frame(width: max(x1 - x0, 5), height: 5)
                            .offset(x: x0)
                    }
                    .frame(maxHeight: .infinity)
                }
                .frame(height: 20)

                Text(fmt(hi))
                    .font(.system(.caption, design: .monospaced).weight(.semibold))
                    .frame(width: 38, alignment: .trailing)
            } else {
                Spacer()
                Text("—").foregroundStyle(.secondary)
            }

            if isCheapest {
                Text("BILLIGST")
                    .font(.system(size: 8.5, weight: .bold))
                    .foregroundStyle(Color(red: 0.12, green: 0.62, blue: 0.29))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(Color.green.opacity(0.14), in: RoundedRectangle(cornerRadius: 6))
            }
        }
        .padding(.vertical, 2)
    }
}
