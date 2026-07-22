import SwiftUI

@main
struct ElpriserApp: App {
    @State private var settings = SettingsViewModel()
    @State private var selectedTab = 0

    var body: some Scene {
        WindowGroup {
            TabView(selection: $selectedTab) {
                NavigationStack {
                    PricesView(settings: settings)
                        .navigationBarTitleDisplayMode(.inline)
                }
                .tag(0)
                .tabItem {
                    Label("Nu", systemImage: "bolt.fill")
                }

                NavigationStack {
                    ForecastView(settings: settings)
                        .navigationBarTitleDisplayMode(.inline)
                }
                .tag(1)
                .tabItem {
                    Label("Prognose", systemImage: "chart.line.uptrend.xyaxis")
                }

                NavigationStack {
                    AutomationView()
                        .navigationTitle("Automation")
                        .navigationBarTitleDisplayMode(.inline)
                }
                .tag(2)
                .tabItem {
                    Label("Automation", systemImage: "clock.arrow.2.circlepath")
                }

                NavigationStack {
                    MoreView(settings: settings)
                        .navigationTitle("Mere")
                        .navigationBarTitleDisplayMode(.inline)
                }
                .tag(3)
                .tabItem {
                    Label("Mere", systemImage: "ellipsis")
                }
            }
            .tint(Color.brand)
        }
    }
}

// MARK: - More Tab (hub for Tariffer, Shelly, About)

struct MoreView: View {
    @Bindable var settings: SettingsViewModel

    var body: some View {
        List {
            Section {
                NavigationLink {
                    TariffView()
                        .navigationTitle("Tariffer")
                        .navigationBarTitleDisplayMode(.inline)
                } label: {
                    Label("Tariffer", systemImage: "list.bullet.rectangle")
                }

                NavigationLink {
                    ShellyTariffView()
                        .navigationTitle("Shelly Live Tariff")
                        .navigationBarTitleDisplayMode(.inline)
                } label: {
                    Label("Shelly Live Tariff", systemImage: "bolt.horizontal.circle")
                }
            }

            Section("Indstillinger") {
                Picker("Priszone", selection: $settings.area) {
                    ForEach(Area.allCases) { a in
                        Text(a.displayName).tag(a)
                    }
                }

                Picker("Pristype", selection: $settings.mode) {
                    ForEach(PriceMode.allCases) { m in
                        Text(m.displayName).tag(m)
                    }
                }

                if settings.mode.requiresNetwork {
                    Picker("Netselskab", selection: $settings.networkGLN) {
                        Text("Ingen valgt").tag(nil as String?)
                        ForEach(NetworkOperators.forArea(settings.area)) { net in
                            Text(net.name).tag(net.gln as String?)
                        }
                    }
                }
            }

            Section {
                NavigationLink {
                    AboutView()
                        .navigationTitle("Om Elpris")
                        .navigationBarTitleDisplayMode(.inline)
                } label: {
                    Label("Om Elpris", systemImage: "info.circle")
                }

                Link(destination: URL(string: "https://elpriser.org")!) {
                    Label("elpriser.org", systemImage: "globe")
                }
            }
        }
    }
}
