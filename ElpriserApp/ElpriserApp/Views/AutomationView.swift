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

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyVStack(spacing: 1) {
                // Header
                HStack(spacing: 1) {
                    Text("")
                        .frame(width: 30)
                    ForEach(days) { day in
                        VStack(spacing: 1) {
                            Text("\(day.dayNumber)")
                                .font(.caption2.weight(.medium))
                            Text(day.weekday.prefix(2))
                                .font(.system(size: 8))
                                .foregroundStyle(.secondary)
                        }
                        .frame(width: 28)
                    }
                }

                // Rows
                ForEach(0..<24, id: \.self) { hour in
                    HStack(spacing: 1) {
                        Text(String(format: "%02d", hour))
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .frame(width: 30)

                        ForEach(days) { day in
                            let isOn = hour < day.schedule.count && day.schedule[hour].on
                            Rectangle()
                                .fill(isOn ? Color.green.opacity(0.6) : Color(.systemGray5))
                                .frame(width: 28, height: 14)
                                .clipShape(RoundedRectangle(cornerRadius: 2))
                        }
                    }
                }
            }
        }
    }
}
