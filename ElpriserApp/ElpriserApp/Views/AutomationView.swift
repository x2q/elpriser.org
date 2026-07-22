import SwiftUI

struct AutomationView: View {
    @State private var vm = AutomationViewModel()
    @State private var showExport = false

    var body: some View {
        Form {
            Section("Indstillinger") {
                Picker("Priszone", selection: $vm.area) {
                    ForEach(Area.allCases) { a in Text(a.displayName).tag(a) }
                }
                .pickerStyle(.segmented)

                Picker("Pristype", selection: $vm.mode) {
                    ForEach(PriceMode.allCases) { m in Text(m.displayName).tag(m) }
                }

                Picker("Enhed", selection: $vm.device) {
                    ForEach(DeviceType.allCases) { d in Text(d.displayName).tag(d) }
                }
                .onChange(of: vm.device) { _, _ in vm.onDeviceChange() }

                if vm.mode.requiresNetwork {
                    Picker("Netselskab", selection: $vm.networkGLN) {
                        Text("V\u{00E6}lg...").tag(nil as String?)
                        ForEach(NetworkOperators.forArea(vm.area)) { net in
                            Text(net.name).tag(net.gln as String?)
                        }
                    }
                }
            }

            Section {
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
            } footer: {
                Text(vm.strategy.helpText)
            }

            Section {
                HStack(spacing: 12) {
                    Label("T\u{00E6}ndt", systemImage: "circle.fill")
                        .font(.caption)
                        .foregroundStyle(.green)
                    Label("Slukket", systemImage: "circle.fill")
                        .font(.caption)
                        .foregroundStyle(Color(.systemGray4))
                    Spacer()
                }

                if vm.isLoading {
                    HStack {
                        Spacer()
                        ProgressView("Henter data...")
                        Spacer()
                    }
                    .padding(.vertical, 12)
                } else if let error = vm.error {
                    ErrorStateView(message: error, retry: loadSchedule)
                } else if !vm.scheduleDays.isEmpty {
                    ScheduleGrid(days: vm.scheduleDays)
                        .padding(.vertical, 4)
                }

                if let savings = vm.savingsEstimate {
                    Text(savings)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text("Ugentlig visualisering")
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
                .contextMenu {
                    Button {
                        UIPasteboard.general.string = vm.apiURL
                    } label: {
                        Label("Kopi\u{00E9}r", systemImage: "doc.on.doc")
                    }
                }
            } header: {
                Text("API-adresse")
            } footer: {
                Text("Returnerer: {\"on\": true/false, \"price\": 1.23, \"hour\": 14}")
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
    }

    private func loadSchedule() {
        Task { await vm.load() }
    }
}

// MARK: - Schedule Grid

private struct ScheduleGrid: View {
    let days: [ScheduleDay]

    @State private var selectedDate: String?

    private var selectedDay: ScheduleDay? {
        days.first { $0.date == selectedDate } ?? days.first { $0.isToday } ?? days.first
    }

    var body: some View {
        VStack(spacing: 8) {
            DayStrip(
                days: days,
                selectedID: $selectedDate,
                label: { String($0.weekday.prefix(2)) },
                number: { "\($0.dayNumber)" },
                isHighlighted: { $0.isToday }
            )

            if let day = selectedDay {
                VStack(spacing: 2) {
                    ForEach(0..<24, id: \.self) { hour in
                        let isOn = hour < day.schedule.count && day.schedule[hour].on
                        HStack {
                            Text(String(format: "%02d:00", hour))
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text(isOn ? "T\u{00E6}ndt" : "Slukket")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(isOn ? .green : Color(.systemGray))
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(isOn ? Color.green.opacity(0.12) : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                    }
                }
            }
        }
        .onAppear { syncSelection() }
        .onChange(of: days.map(\.date)) { _, _ in syncSelection() }
    }

    private func syncSelection() {
        if selectedDate == nil || !days.contains(where: { $0.date == selectedDate }) {
            selectedDate = days.first(where: { $0.isToday })?.date ?? days.first?.date
        }
    }
}
