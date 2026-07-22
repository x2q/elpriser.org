import SwiftUI

struct ForecastView: View {
    @Bindable var settings: SettingsViewModel
    @State private var vm = ForecastViewModel()
    @State private var fcArea: Area = .dk1
    @State private var fcMode: PriceMode = .inklAlt

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Elprisprognose")
                        .font(.headline)
                    Text("Forventede elpriser de n\u{00E6}ste 7 dage")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(.horizontal)
            .padding(.vertical, 8)

            // Pickers
            HStack(spacing: 8) {
                Picker("Zone", selection: $fcArea) {
                    ForEach(Area.allCases) { a in
                        Text(a.displayName).tag(a)
                    }
                }
                .pickerStyle(.menu)

                Picker("Mode", selection: $fcMode) {
                    Text("Elspot inkl moms").tag(PriceMode.spotInkl)
                    Text("Inkl alt").tag(PriceMode.inklAlt)
                    Text("Inkl alt minus afgift").tag(PriceMode.inklAltMinus)
                }
                .pickerStyle(.menu)

                Spacer()
            }
            .padding(.horizontal)
            .padding(.bottom, 8)

            // Content
            if vm.isLoading {
                Spacer()
                ProgressView("Henter prognose...")
                Spacer()
            } else if let error = vm.error {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                        .foregroundStyle(.red)
                    Text(error)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button("Pr\u{00F8}v igen") { loadData() }
                        .buttonStyle(.bordered)
                }
                Spacer()
            } else {
                ForecastTable(days: vm.days, priceRange: vm.priceRange)
            }
        }
        .background(Color(.systemGroupedBackground))
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
                            Text(day.weekday.prefix(3))
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
