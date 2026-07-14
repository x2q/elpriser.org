import SwiftUI

struct PricesView: View {
    @Bindable var settings: SettingsViewModel
    @State private var vm = PriceViewModel()
    @State private var selectedDetail: PriceDetail?

    var body: some View {
        VStack(spacing: 0) {
            // Selector bar
            HStack(spacing: 8) {
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
                            .font(.subheadline.weight(.medium))
                            .lineLimit(1)
                        Image(systemName: "chevron.down")
                            .font(.caption2)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color(.systemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .shadow(color: .black.opacity(0.05), radius: 2)
                }
                .foregroundStyle(.primary)

                Spacer()
            }
            .padding(.horizontal)
            .padding(.vertical, 8)

            // Content
            if vm.isLoading {
                Spacer()
                ProgressView("Henter priser...")
                    .font(.subheadline)
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
                    Button("Prøv igen") { loadData() }
                        .buttonStyle(.bordered)
                }
                Spacer()
            } else {
                PriceTable(
                    days: vm.days,
                    priceRange: vm.priceRange,
                    currentHour: Date().hour,
                    onCellTap: { date, hour, price in
                        selectedDetail = PriceDetail(date: date, hour: hour, price: price)
                    }
                )
                .padding(.top, 4)

                // Week navigation
                HStack(spacing: 12) {
                    Button {
                        vm.changeWeek(-1)
                        loadData()
                    } label: {
                        Text("\u{2190} Forrige")
                            .font(.caption)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)

                    Text(vm.weekLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(width: 90)

                    Button {
                        vm.changeWeek(1)
                        loadData()
                    } label: {
                        Text("N\u{00E6}ste \u{2192}")
                            .font(.caption)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(!vm.canGoForward)
                }
                .padding(.vertical, 12)
            }
        }
        .background(Color(.systemGroupedBackground))
        .sheet(item: $selectedDetail) { detail in
            PriceDetailSheet(detail: detail, mode: settings.mode)
                .presentationDetents([.height(280)])
        }
        .onAppear { loadData() }
        .onChange(of: settings.area) { _, _ in loadData() }
        .onChange(of: settings.mode) { _, _ in loadData() }
        .onChange(of: settings.networkGLN) { _, _ in loadData() }
    }

    private var selectorLabel: String {
        var label = "\(settings.area.shortName) \(settings.mode.displayName)"
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

struct PriceDetail: Identifiable {
    let id = UUID()
    let date: String
    let hour: Int
    let price: Double
}
