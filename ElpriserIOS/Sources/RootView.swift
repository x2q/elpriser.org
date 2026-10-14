import SwiftUI

/// Skærme uden for fanerne.
enum Route: Hashable { case settings }

/// Giver skærmene besked, om der er plads til to paneler (iPad og store iPhones i landscape).
struct Adaptive<Content: View>: View {
    @ViewBuilder var content: (Bool) -> Content
    var body: some View {
        GeometryReader { g in content(g.size.width >= 700) }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var phase
    /// Kun til skærmbilleder (-debugTab settings): åbner "Netselskab og indstillinger" direkte i Pris-fanens stak.
    @State private var prisPath: [Route] = {
        #if DEBUG
        return UserDefaults.standard.string(forKey: "debugTab") == "settings" ? [.settings] : []
        #else
        return []
        #endif
    }()

    var body: some View {
        tabs
    }

    @ViewBuilder private var tabs: some View {
        @Bindable var m = model
        // Bredde, ikke enhedstype: en iPad i en smal Split View-rude skal have iPhone-opbygningen,
        // og en stor iPhone i landscape har plads til skinnen.
        GeometryReader { g in
            Group {
                if g.size.width >= 700 { railLayout } else { compactLayout }
            }
        }
        .tint(T.brandSolid)
        .preferredColorScheme(scheme)
        .fullScreenCover(isPresented: Binding(get: { model.step != nil }, set: { if !$0 { model.closeStep() } })) {
            FlowHost().environment(model).preferredColorScheme(scheme)
        }
        .task { model.refresh() }
        #if DEBUG
        // Kun til skærmbilleder: -debugLandscape YES tvinger liggende format.
        .task {
            guard UserDefaults.standard.bool(forKey: "debugLandscape") else { return }
            try? await Task.sleep(for: .seconds(1))
            if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
                scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscape)) { print("geometry error", $0) }
            }
        }
        #endif
        .onChange(of: phase) { _, p in if p == .active { model.refresh() } }
        .onChange(of: model.settings.mode) { _, _ in model.refresh() }
        .onChange(of: model.settings.netGln) { _, _ in model.refresh() }
        .onChange(of: model.settings.area) { _, _ in model.refresh() }
    }

    /// iPad: skinne til venstre og indholdet til højre, som i Android-tabletudgaven.
    private var railLayout: some View {
        @Bindable var m = model
        return HStack(spacing: 0) {
            SideRail(selected: $m.tab)
            ZStack {
                switch model.tab {
                case .pris: NavigationStack(path: $prisPath) { PrisScreen().routes() }
                case .smartHjem: NavigationStack { AutomationScreen().toolbar(.hidden, for: .navigationBar) }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(T.bg.ignoresSafeArea())
        }
    }

    /// iPhone: faneliste i bunden.
    private var compactLayout: some View {
        @Bindable var m = model
        return TabView(selection: $m.tab) {
            Tab("Pris", systemImage: "bolt", value: AppTab.pris) {
                NavigationStack(path: $prisPath) { PrisScreen().routes() }
            }
            Tab("Smart hjem", systemImage: "slider.horizontal.3", value: AppTab.smartHjem) {
                NavigationStack { AutomationScreen().toolbar(.hidden, for: .navigationBar) }
            }
        }
    }

    private var scheme: ColorScheme? {
        switch model.settings.theme { case "light": .light; case "dark": .dark; default: nil }
    }
}

extension View {
    /// Skjult navigationslinje på hovedskærmen; indstillingerne skubbes ind med sin egen.
    func routes() -> some View {
        self.toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { _ in SettingsScreen() }
    }
}
