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

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyVStack(spacing: 0) {
                // Header
                HStack(spacing: 2) {
                    Text("Time")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .frame(width: 36, alignment: .trailing)

                    ForEach(days) { day in
                        VStack(spacing: 1) {
                            Text(day.shortWeekdayLabel.prefix(3))
                                .font(.caption)
                                .fontWeight(.medium)
                            Text(day.isActual ? "Faktisk" : "Prognose")
                                .font(.system(size: 8))
                                .foregroundStyle(day.isActual ? Color.brandAccent : .secondary)
                        }
                        .frame(minWidth: 44)
                    }
                }
                .padding(.bottom, 4)

                Divider()

                ForEach(0..<24, id: \.self) { hour in
                    HStack(spacing: 2) {
                        Text(String(format: "%02d", hour))
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .frame(width: 36, alignment: .trailing)

                        ForEach(days) { day in
                            if hour < day.prices.count, let price = day.prices[hour].price {
                                let isDark = colorScheme == .dark
                                let bg = Color.forPrice(price, min: priceRange.min, max: priceRange.max, isDark: isDark)
                                let formatted = String(format: "%.2f", price).replacingOccurrences(of: ".", with: ",")

                                Text(formatted)
                                    .font(.system(.caption2, design: .monospaced))
                                    .frame(minWidth: 44)
                                    .padding(.vertical, 3)
                                    .background(bg)
                                    .foregroundStyle(isDark ? .white.opacity(0.85) : .black)
                                    .clipShape(RoundedRectangle(cornerRadius: 3))
                            } else {
                                Rectangle()
                                    .fill(Color(.systemGray5))
                                    .frame(minWidth: 44, minHeight: 22)
                                    .clipShape(RoundedRectangle(cornerRadius: 3))
                            }
                        }
                    }
                    .padding(.vertical, 0.5)
                }
            }
            .padding(.horizontal, 4)
        }
    }
}
