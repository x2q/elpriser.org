import SwiftUI

struct AutomationView: View {
    @State private var vm = AutomationViewModel()
    @State private var showExport = false

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                // Header
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Automation")
                            .font(.headline)
                        Text("Styr dit elforbrug efter spotpriserne")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                }
                .padding(.horizontal)

                // Config card
                VStack(spacing: 12) {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Priszone").font(.caption).foregroundStyle(.secondary)
                            Picker("Zone", selection: $vm.area) {
                                ForEach(Area.allCases) { a in Text(a.displayName).tag(a) }
                            }
                            .pickerStyle(.menu)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Pristype").font(.caption).foregroundStyle(.secondary)
                            Picker("Mode", selection: $vm.mode) {
                                ForEach(PriceMode.allCases) { m in Text(m.displayName).tag(m) }
                            }
                            .pickerStyle(.menu)
                        }
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Enhed").font(.caption).foregroundStyle(.secondary)
                        Picker("Device", selection: $vm.device) {
                            ForEach(DeviceType.allCases) { d in Text(d.displayName).tag(d) }
                        }
                        .pickerStyle(.menu)
                        .onChange(of: vm.device) { _, _ in vm.onDeviceChange() }
                    }

                    if vm.mode.requiresNetwork {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Netselskab").font(.caption).foregroundStyle(.secondary)
                            Picker("Net", selection: $vm.networkGLN) {
                                Text("V\u{00E6}lg...").tag(nil as String?)
                                ForEach(NetworkOperators.forArea(vm.area)) { net in
                                    Text(net.name).tag(net.gln as String?)
                                }
                            }
                            .pickerStyle(.menu)
                        }
                    }

                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Strategi").font(.caption).foregroundStyle(.secondary)
                            Picker("Strategy", selection: $vm.strategy) {
                                ForEach(Strategy.allCases) { s in Text(s.displayName).tag(s) }
                            }
                            .pickerStyle(.menu)
                        }

                        if vm.strategy.requiresParam {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(vm.strategy.paramLabel).font(.caption).foregroundStyle(.secondary)
                                HStack {
                                    TextField("", value: $vm.param, format: .number)
                                        .textFieldStyle(.roundedBorder)
                                        .frame(width: 60)
                                        .keyboardType(.numberPad)
                                    Stepper("", value: $vm.param, in: 1...23)
                                        .labelsHidden()
                                }
                            }
                        }
                    }

                    Text(vm.strategy.helpText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding()
                .background(Color(.systemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal)

                // Schedule visualization
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Ugentlig visualisering")
                            .font(.subheadline.weight(.semibold))
                        Spacer()
                        HStack(spacing: 12) {
                            Label("T\u{00E6}ndt", systemImage: "circle.fill")
                                .font(.caption2)
                                .foregroundStyle(.green)
                            Label("Slukket", systemImage: "circle.fill")
                                .font(.caption2)
                                .foregroundStyle(Color(.systemGray4))
                        }
                    }

                    if vm.isLoading {
                        HStack {
                            Spacer()
                            ProgressView("Henter data...")
                            Spacer()
                        }
                        .padding(.vertical, 24)
                    } else if !vm.scheduleDays.isEmpty {
                        ScheduleGrid(days: vm.scheduleDays)
                    }

                    if let savings = vm.savingsEstimate {
                        Text(savings)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                    }
                }
                .padding()
                .background(Color(.systemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal)

                // API URL
                VStack(alignment: .leading, spacing: 8) {
                    Text("API-adresse")
                        .font(.subheadline.weight(.semibold))

                    Text("Brug denne URL direkte i Shelly-scripts eller Home Assistant.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    HStack {
                        Text(vm.apiURL)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(Color.brand)
                            .lineLimit(3)
                        Spacer()
                        Button {
                            UIPasteboard.general.string = vm.apiURL
                        } label: {
                            Image(systemName: "doc.on.doc")
                                .font(.caption)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                    .padding(12)
                    .background(Color(.systemGray6))
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                    Text("Returnerer: {\"on\": true/false, \"price\": 1.23, \"hour\": 14}")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                .padding()
                .background(Color(.systemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal)

                // Export button
                Button {
                    showExport = true
                } label: {
                    Label("Eksport kode", systemImage: "chevron.left.forwardslash.chevron.right")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .padding(.horizontal)
            }
            .padding(.vertical)
        }
        .background(Color(.systemGroupedBackground))
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
