import SwiftUI

struct PricesView: View {
    @Bindable var settings: SettingsViewModel
    @State private var vm = PriceViewModel()
    @State private var selectedDetail: PriceDetail?

    var body: some View {
        VStack(spacing: 0) {
            // Content
            if vm.isLoading {
                Spacer()
                ProgressView("Henter priser...")
                    .font(.subheadline)
                Spacer()
            } else if let error = vm.error {
                ErrorStateView(message: error, retry: loadData)
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
                HStack {
                    Button { vm.changeWeek(-1); loadData() } label: {
                        Image(systemName: "chevron.left")
                    }

                    Spacer()

                    Text(vm.weekLabel)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)

                    Spacer()

                    Button { vm.changeWeek(1); loadData() } label: {
                        Image(systemName: "chevron.right")
                    }
                    .disabled(!vm.canGoForward)
                }
                .padding(.horizontal, 40)
                .padding(.vertical, 12)
            }
        }
        .background(Color(.systemGroupedBackground))
        .toolbar {
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

struct PriceDetail: Identifiable {
    let id = UUID()
    let date: String
    let hour: Int
    let price: Double
}
