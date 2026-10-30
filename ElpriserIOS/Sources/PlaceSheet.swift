import SwiftUI

/// Skærmene i arket: roden, et område og Indstillinger.
private enum PlaceRoute: Hashable { case area(String), settings }

/// "Hvor er du?": ét ark med Apple-grupperet liste. Position, Danmark (Vest/Øst fører ind til netselskaberne),
/// andre lande og Indstillinger. Et valg gælder med det samme og lukker arket.
struct PlaceSheet: View {
    @Environment(AppModel.self) private var vm
    @State private var path: [PlaceRoute] = {
        #if DEBUG
        switch UserDefaults.standard.string(forKey: "debugTab") {
        case "dk1": return [.area("DK1")]
        case "dk2": return [.area("DK2")]
        case "settings": return [.settings]
        default: return []
        }
        #else
        return []
        #endif
    }()
    @State private var query: String = {
        #if DEBUG
        UserDefaults.standard.string(forKey: "debugPlaceQuery") ?? ""
        #else
        ""
        #endif
    }()

    var body: some View {
        NavigationStack(path: $path) {
            PlaceRoot(query: $query)
                .navigationDestination(for: PlaceRoute.self) { r in
                    switch r {
                    case .area(let a): PlaceAreaList(area: a)
                    case .settings: SettingsScreen().toolbar { closeButton }
                    }
                }
                .toolbar { closeButton }
        }
        .tint(T.brandSolid)
    }

    @ToolbarContentBuilder private var closeButton: some ToolbarContent {
        ToolbarItem(placement: .confirmationAction) {
            Button(vm.settings.onboarded ? "Luk" : "Spring over") { vm.closePlace() }
                .font(.app(16, .bold))
        }
    }
}

private extension View {
    /// Fælles udseende for listerne i arket: appens baggrund og flader, Manrope.
    func placeList() -> some View {
        self.scrollContentBackground(.hidden).background(T.bg.ignoresSafeArea())
            .listRowBackground(T.surface)
    }
}

private struct PlaceRoot: View {
    @Environment(AppModel.self) private var vm
    @Environment(\.openURL) private var openURL
    @Binding var query: String

    var body: some View {
        let s = vm.settings
        let hits = placeSearch(query)
        let searching = !query.trimmingCharacters(in: .whitespaces).isEmpty
        List {
            if searching {
                searchResults(hits, s)
            } else {
                if let note = vm.placeNote {
                    Text(note).font(.app(14, .semibold)).lineSpacing(3).foregroundStyle(T.text)
                        .padding(.vertical, 4)
                        .listRowBackground(T.midSoft)
                }
                Section {
                    Button { vm.detect() } label: {
                        HStack(spacing: 12) {
                            if vm.locating { ProgressView().tint(T.brandSolid).frame(width: 22) }
                            else { Image(systemName: "location.fill").font(.app(16, .bold)).foregroundStyle(T.brandSolid).frame(width: 22) }
                            Text(vm.locating ? "Finder dit netselskab …" : "Brug min position").font(.app(16, .bold)).foregroundStyle(T.brand)
                            Spacer(minLength: 0)
                        }
                        .frame(minHeight: 32).contentShape(Rectangle())
                    }
                    .disabled(vm.locating)
                    if s.net != nil {
                        Button("Glem mit netselskab", role: .destructive) { vm.forget() }
                            .font(.app(16, .semibold)).foregroundStyle(T.bad).frame(minHeight: 32)
                    }
                } footer: {
                    Text("Finder dit netselskab ud fra din position. Positionen bruges kun én gang og gemmes aldrig.")
                        .font(.app(12.5)).foregroundStyle(T.text2)
                }
                Section {
                    ForEach(placeAreas, id: \.area) { a in
                        NavigationLink(value: PlaceRoute.area(a.area)) {
                            HStack {
                                Text(a.name).font(.app(16, .semibold)).foregroundStyle(T.text)
                                Spacer(minLength: 8)
                                Text(placeAreaDetail(area: a.area, net: s.net, chosenArea: s.area))
                                    .font(.app(15, .medium)).foregroundStyle(T.text2).lineLimit(1)
                            }
                            .frame(minHeight: 32)
                        }
                    }
                } header: { header("Danmark") }
                Section {
                    Button { openURL(URL(string: "https://elpriser.org/norden")!) } label: {
                        HStack {
                            Text("Norden og resten af Europa").font(.app(16, .semibold)).foregroundStyle(T.text)
                            Spacer(minLength: 8)
                            Image(systemName: "arrow.up.right").font(.app(13, .bold)).foregroundStyle(T.text2)
                        }
                        .frame(minHeight: 32).contentShape(Rectangle())
                    }
                } header: { header("Andre lande") }
                Section {
                    NavigationLink(value: PlaceRoute.settings) {
                        Text("Indstillinger").font(.app(16, .semibold)).foregroundStyle(T.text).frame(minHeight: 32)
                    }
                }
            }
        }
        .placeList()
        .navigationTitle("Hvor er du?")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Søg netselskab")
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
    }

    @ViewBuilder private func searchResults(_ hits: [Net], _ s: Settings) -> some View {
        if hits.isEmpty {
            Text(placeNoMatch(query)).font(.app(14.5)).foregroundStyle(T.text2)
                .frame(maxWidth: .infinity, alignment: .center).padding(.vertical, 24)
                .listRowBackground(Color.clear)
        } else {
            Section {
                ForEach(hits) { n in
                    Button { vm.choose(n, how: "manual") } label: {
                        HStack {
                            Text(n.name).font(.app(16, .semibold)).foregroundStyle(T.text)
                            Spacer(minLength: 8)
                            Text(n.areaLabel).font(.app(14, .medium)).foregroundStyle(T.text2)
                            if s.net?.gln == n.gln { Image(systemName: "checkmark").font(.app(15, .bold)).foregroundStyle(T.brandSolid) }
                        }
                        .frame(minHeight: 32).contentShape(Rectangle())
                    }
                }
            }
        }
    }

    private func header(_ t: String) -> some View {
        Text(t).font(.app(13, .bold)).foregroundStyle(T.text2).textCase(nil)
    }
}

/// Et område: "Uden netselskab" og områdets netselskaber. ✓ på det nuværende; et tryk vælger og lukker arket.
private struct PlaceAreaList: View {
    @Environment(AppModel.self) private var vm
    let area: String

    var body: some View {
        let s = vm.settings
        List {
            Section {
                row("Uden netselskab", on: placeIsWithoutNet(area: area, net: s.net, chosenArea: s.area)) { vm.chooseWithoutNet(area: area) }
                ForEach(Nets.all.filter { $0.area == area }) { n in
                    row(n.name, on: s.net?.gln == n.gln) { vm.choose(n, how: "manual") }
                }
            } footer: {
                Text("Med et netselskab inkluderer prisen nettarif, afgifter og moms som på din regning.")
                    .font(.app(12.5)).foregroundStyle(T.text2)
            }
        }
        .placeList()
        .navigationTitle(placeAreaName(area))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(s.onboarded ? "Luk" : "Spring over") { vm.closePlace() }.font(.app(16, .bold))
            }
        }
    }

    private func row(_ title: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(title).font(.app(16, .semibold)).foregroundStyle(T.text)
                Spacer(minLength: 8)
                if on { Image(systemName: "checkmark").font(.app(15, .bold)).foregroundStyle(T.brandSolid) }
            }
            .frame(minHeight: 32).contentShape(Rectangle())
        }
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
