import SwiftUI

struct ForecastView: View {
    @Bindable var settings: SettingsViewModel
    @State private var vm = ForecastViewModel()
    @State private var fcArea: Area = .dk1
    @State private var fcMode: PriceMode = .inklAlt

    var body: some View {
        VStack(spacing: 0) {
            if vm.isLoading {
                Spacer()
                ProgressView("Henter prognose...")
                Spacer()
            } else if let error = vm.error {
                ErrorStateView(message: error, retry: loadData)
            } else {
                Text("Forventede elpriser de n\u{00E6}ste 7 dage")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.top, 12)
                    .padding(.bottom, 4)

                ForecastTable(days: vm.days, priceRange: vm.priceRange)
            }
        }
        .background(Color(.systemGroupedBackground))
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

    private func loadData() {
        Task {
            await vm.load(area: fcArea, mode: fcMode)
        }
    }
}

private struct ForecastTable: View {
    let days: [ForecastDay]
    let priceRange: (min: Double, max: Double)

    @State private var selectedDate: String?

    private var selectedDay: ForecastDay? {
        days.first { $0.date == selectedDate } ?? days.first { $0.isActual } ?? days.first
    }

    var body: some View {
        VStack(spacing: 0) {
            DayStrip(
                days: days,
                selectedID: $selectedDate,
                label: { String($0.shortWeekdayLabel.prefix(3)) },
                number: { "\($0.dayNumber)" },
                isHighlighted: { $0.isActual }
            )

            if let day = selectedDay {
                Text(day.isActual ? "Faktiske priser" : "Prognose baseret p\u{00E5} historiske prism\u{00F8}nstre")
                    .font(.caption)
                    .foregroundStyle(day.isActual ? Color.brandAccent : .secondary)
                    .padding(.bottom, 4)

                List {
                    ForEach(0..<24, id: \.self) { hour in
                        if hour < day.prices.count, let price = day.prices[hour].price {
                            ForecastHourRow(hour: hour, price: price, priceRange: priceRange)
                                .listRowInsets(EdgeInsets())
                                .listRowSeparator(.hidden)
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .onAppear { syncSelection() }
        .onChange(of: days.map(\.date)) { _, _ in syncSelection() }
    }

    private func syncSelection() {
        if selectedDate == nil || !days.contains(where: { $0.date == selectedDate }) {
            selectedDate = days.first(where: { $0.isActual })?.date ?? days.first?.date
        }
    }
}

private struct ForecastHourRow: View {
    let hour: Int
    let price: Double
    let priceRange: (min: Double, max: Double)

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack {
            Text(String(format: "%02d:00\u{2013}%02d:00", hour, (hour + 1) % 24))
                .font(.subheadline)
            Spacer()
            Text(String(format: "%.2f", price).replacingOccurrences(of: ".", with: ","))
                .font(.system(.subheadline, design: .monospaced))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color.forPrice(price, min: priceRange.min, max: priceRange.max, isDark: colorScheme == .dark))
    }
}
