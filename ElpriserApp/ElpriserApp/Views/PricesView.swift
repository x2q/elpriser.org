import SwiftUI

/// The "Nu" home screen — answers "er strømmen billig lige nu?" with the
/// current price as the headline, verdict pills, today's curve + CO₂ strip,
/// best/worst/greenest windows, and one combined advice sentence.
struct PricesView: View {
    @Bindable var settings: SettingsViewModel
    @State private var vm = PriceViewModel()

    var body: some View {
        Group {
            if vm.isLoading {
                ProgressView("Henter priser...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = vm.error {
                ErrorStateView(message: error, retry: loadData)
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                        header
                        chartSection
                        statsSection
                        if let advice = vm.advice {
                            adviceCard(advice)
                        }
                    }
                    .padding(.bottom, 24)
                }
            }
        }
        .background(Color(.systemGroupedBackground))
        .toolbar { selectorToolbar }
        .onAppear { loadData() }
        .onChange(of: settings.area) { _, _ in loadData() }
        .onChange(of: settings.mode) { _, _ in loadData() }
        .onChange(of: settings.networkGLN) { _, _ in loadData() }
    }

    // MARK: - Sections

    private var header: some View {
        VStack(spacing: 4) {
            Text("\(settings.area == .dk1 ? "Vestdanmark" : "Østdanmark")\(settings.selectedNetwork.map { " · \($0.name)" } ?? "") · lige nu".uppercased())
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(.secondary)
                .padding(.top, 10)

            Text(vm.currentPrice.map { String(format: "%.2f", $0).replacingOccurrences(of: ".", with: ",") } ?? "—")
                .font(.system(size: 68, weight: .light))
                .monospacedDigit()
                .kerning(-1)

            Text(unitLabel)
                .font(.system(size: 12.5))
                .foregroundStyle(.secondary)

            HStack(spacing: 6) {
                if let v = vm.verdict {
                    switch v {
                    case .billig: VerdictPill(text: "Billig lige nu", fg: Color(red: 0.12, green: 0.62, blue: 0.29), bg: Color.green.opacity(0.14))
                    case .middel: VerdictPill(text: "Middel lige nu", fg: Color(red: 0.70, green: 0.42, blue: 0.00), bg: Color.orange.opacity(0.14))
                    case .dyr:    VerdictPill(text: "Dyr lige nu", fg: Color(red: 0.82, green: 0.17, blue: 0.13), bg: Color.red.opacity(0.12))
                    }
                }
                if let c = vm.currentCo2 {
                    VerdictPill(text: "\(vm.isGreenestNow ? "Grønnest i dag · " : "")\(c) g CO₂/kWh",
                                fg: Color.co2, bg: Color.co2.opacity(0.12))
                }
            }
            .padding(.top, 8)

            if let pct = vm.cheaperThanPct {
                Text("Billigere end \(pct) % af dagens timer\(vm.isGreenestNow ? " · dagens laveste CO₂" : "")")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .padding(.top, 5)
            }
        }
    }

    private var chartSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("I DAG, TIME FOR TIME")
                Spacer()
                Text("DKK/KWH")
            }
            .font(.system(size: 10, weight: .semibold))
            .tracking(0.5)
            .foregroundStyle(.secondary)
            .padding(.bottom, 6)

            DayCurveChart(prices: vm.prices, currentHour: vm.currentHour)
                .frame(height: 150)

            if !vm.validCo2.isEmpty {
                HStack {
                    Text("CO₂-UDLEDNING")
                    Spacer()
                    Text("G/KWH")
                }
                .font(.system(size: 10, weight: .semibold))
                .tracking(0.5)
                .foregroundStyle(Color.co2)
                .padding(.top, 10)
                .padding(.bottom, 4)

                Co2StripChart(co2: vm.co2, currentHour: vm.currentHour)
                    .frame(height: 36)
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .padding(.horizontal, 16)
        .padding(.top, 14)
    }

    private var statsSection: some View {
        HStack(spacing: 8) {
            if let b = vm.best {
                StatCard(label: "Billigst",
                         value: String(format: "%.2f", b.p).replacingOccurrences(of: ".", with: ","),
                         sub: "kl. \(String(format: "%02d", b.h))–\(String(format: "%02d", (b.h + 1) % 24))",
                         tint: Color(red: 0.12, green: 0.62, blue: 0.29))
            }
            if let w = vm.worst {
                StatCard(label: "Dyrest",
                         value: String(format: "%.2f", w.p).replacingOccurrences(of: ".", with: ","),
                         sub: "kl. \(String(format: "%02d", w.h))–\(String(format: "%02d", (w.h + 1) % 24))",
                         tint: Color(red: 0.82, green: 0.17, blue: 0.13))
            }
            if let g = vm.greenest {
                StatCard(label: "Grønnest",
                         value: "\(g.v) g",
                         sub: "kl. \(String(format: "%02d", g.h))\(g.h == vm.currentHour ? " · nu" : "")",
                         tint: Color.co2)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
    }

    private func adviceCard(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 13.5, weight: .medium))
            .foregroundStyle(.white)
            .lineSpacing(2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(
                LinearGradient(colors: [Color.brand, Color.brandDark],
                               startPoint: .topLeading, endPoint: .bottomTrailing),
                in: RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal, 16)
            .padding(.top, 12)
    }

    // MARK: - Toolbar selector (unchanged pattern)

    private var selectorToolbar: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            Menu {
                Section("Priszone") {
                    ForEach(Area.allCases) { a in
                        Button {
                            settings.area = a
                        } label: {
                            Label(a.displayName, systemImage: settings.area == a ? "checkmark" : "")
                        }
                    }
                }
                Section("Pristype") {
                    ForEach(PriceMode.allCases) { m in
                        Button {
                            settings.mode = m
                        } label: {
                            Label(m.displayName, systemImage: settings.mode == m ? "checkmark" : "")
                        }
                    }
                }
                if settings.mode.requiresNetwork {
                    Section("Netselskab") {
                        ForEach(NetworkOperators.forArea(settings.area)) { net in
                            Button {
                                settings.networkGLN = net.gln
                            } label: {
                                Label(net.name, systemImage: settings.networkGLN == net.gln ? "checkmark" : "")
                            }
                        }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(selectorLabel)
                        .font(.headline)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption2.weight(.bold))
                }
                .foregroundStyle(.primary)
            }
        }
    }

    private var unitLabel: String {
        switch settings.mode {
        case .spotEx: return "kr/kWh spot ekskl. moms"
        case .spotInkl: return "kr/kWh spot inkl. moms"
        case .inklAltMinus, .netInklTarif: return "kr/kWh inkl. tarif og moms"
        default: return "kr/kWh inkl. tarif, afgift og moms"
        }
    }

    private var selectorLabel: String {
        var label = "\(settings.area.shortName) \(settings.mode.shortDisplayName)"
        if settings.mode.requiresNetwork, let net = settings.selectedNetwork {
            label = "\(settings.area.shortName) \(net.name)"
        }
        return label
    }

    private func loadData() {
        Task {
            await vm.load(
                area: settings.area,
                mode: settings.mode,
                gln: settings.mode.requiresNetwork ? settings.networkGLN : nil
            )
        }
    }
}
