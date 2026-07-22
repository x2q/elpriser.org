import SwiftUI

/// Automation — device-first: the configured device is a card with its own
/// daily rhythm (24h on/off band), state, and savings. Configuration lives
/// below as ordinary settings instead of dominating the screen.
struct AutomationView: View {
    @State private var vm = AutomationViewModel()
    @State private var showExport = false

    private var today: ScheduleDay? { vm.scheduleDays.first }
    private var currentHour: Int { Calendar.current.component(.hour, from: Date()) }

    private var onHoursToday: Set<Int> {
        Set(today?.schedule.filter(\.on).map(\.hour) ?? [])
    }
    private var isOnNow: Bool { onHoursToday.contains(currentHour) }
    private var nextOnHour: Int? {
        onHoursToday.filter { $0 > currentHour }.min()
    }
    /// Today's saving: average price of on-hours vs. average of all hours.
    private var savingsTodayPct: Int? {
        guard let day = today else { return nil }
        let all = day.schedule.compactMap(\.price)
        let on = day.schedule.filter(\.on).compactMap(\.price)
        guard !all.isEmpty, !on.isEmpty else { return nil }
        let avgAll = all.reduce(0, +) / Double(all.count)
        let avgOn = on.reduce(0, +) / Double(on.count)
        guard avgAll > 0 else { return nil }
        return Int((1 - avgOn / avgAll) * 100)
    }

    var body: some View {
        Form {
            Section {
                deviceCard
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }

            Section {
                Picker("Priszone", selection: $vm.area) {
                    ForEach(Area.allCases) { a in Text(a.displayName).tag(a) }
                }
                .pickerStyle(.segmented)

                Picker("Enhed", selection: $vm.device) {
                    ForEach(DeviceType.allCases) { d in Text(d.displayName).tag(d) }
                }
                .onChange(of: vm.device) { _, _ in vm.onDeviceChange() }

                Picker("Pristype", selection: $vm.mode) {
                    ForEach(PriceMode.allCases) { m in Text(m.displayName).tag(m) }
                }

                if vm.mode.requiresNetwork {
                    Picker("Netselskab", selection: $vm.networkGLN) {
                        Text("V\u{00E6}lg...").tag(nil as String?)
                        ForEach(NetworkOperators.forArea(vm.area)) { net in
                            Text(net.name).tag(net.gln as String?)
                        }
                    }
                }

                Picker("Strategi", selection: $vm.strategy) {
                    ForEach(Strategy.allCases) { s in Text(s.displayName).tag(s) }
                }

                if vm.strategy.requiresParam {
                    Stepper(value: $vm.param, in: 1...23) {
                        HStack {
                            Text(vm.strategy.paramLabel)
                            Spacer()
                            Text("\(vm.param)")
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                    }
                }
            } header: {
                Text("Indstillinger")
            } footer: {
                Text(vm.strategy.helpText)
            }

            Section {
                HStack {
                    Text(vm.apiURL)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Color.brand)
                        .lineLimit(3)
                    Spacer()
                    Button {
                        UIPasteboard.general.string = vm.apiURL
                    } label: {
                        Image(systemName: "doc.on.doc")
                    }
                    .buttonStyle(.borderless)
                }
            } header: {
                Text("API-adresse")
            } footer: {
                Text("Returnerer: {\"on\": true/false, \"price\": 1.23, \"hour\": 14} — brug den direkte i Shelly-scripts eller Home Assistant.")
            }

            Section {
                Button {
                    showExport = true
                } label: {
                    Label("Eksport kode", systemImage: "chevron.left.forwardslash.chevron.right")
                }
            }
        }
        .sheet(isPresented: $showExport) {
            AutomationExportView(vm: vm)
        }
        .onAppear { loadSchedule() }
        .onChange(of: vm.area) { _, _ in loadSchedule() }
        .onChange(of: vm.mode) { _, _ in loadSchedule() }
        .onChange(of: vm.strategy) { _, _ in loadSchedule() }
        .onChange(of: vm.param) { _, _ in loadSchedule() }
        .onChange(of: vm.networkGLN) { _, _ in loadSchedule() }
    }

    // MARK: - Device card

    private var deviceCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: deviceIcon)
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(Color.brand)
                    .frame(width: 38, height: 38)
                    .background(Color.brand.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))

                VStack(alignment: .leading, spacing: 1) {
                    Text(vm.device.displayName)
                        .font(.system(size: 16, weight: .bold))
                    Text(strategySubtitle)
                        .font(.system(size: 11.5))
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Text(isOnNow ? "Tændt" : "Slukket")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(isOnNow ? Color(red: 0.12, green: 0.62, blue: 0.29) : .secondary)
            }

            if vm.isLoading {
                HStack { Spacer(); ProgressView(); Spacer() }
                    .padding(.vertical, 8)
            } else if let error = vm.error {
                ErrorStateView(message: error, retry: loadSchedule)
            } else if today != nil {
                HourBand(onHours: onHoursToday, currentHour: currentHour)
                footerLine
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private var footerLine: some View {
        HStack(spacing: 4) {
            if isOnNow {
                Text("Kører nu")
                    .fontWeight(.semibold)
            } else if let next = nextOnHour {
                Text("Tænder ")
                + Text("kl. \(String(format: "%02d", next))").bold()
            } else {
                Text("Færdig for i dag")
            }
            if let s = savingsTodayPct, s > 0 {
                Text("· sparer ")
                + Text("≈ \(s) %").bold()
                + Text(" i dag")
            }
            Spacer()
        }
        .font(.system(size: 12.5))
        .foregroundStyle(.secondary)
    }

    private var strategySubtitle: String {
        if vm.strategy.requiresParam {
            return vm.strategy.displayName
                .replacingOccurrences(of: "N timer", with: "\(vm.param) timer")
                .replacingOccurrences(of: "X%", with: "\(vm.param)%")
        }
        return vm.strategy.displayName
    }

    private var deviceIcon: String {
        switch vm.device {
        case .heatPump: return "fan"
        case .electricCar: return "car"
        case .dishwasher: return "dishwasher"
        case .washingMachine: return "washer"
        case .dehumidifier: return "humidity"
        case .waterHeater: return "drop"
        }
    }

    private func loadSchedule() {
        Task { await vm.load() }
    }
}
