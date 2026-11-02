import SwiftUI

/// The screens of the sheet: the root, a Danish area, Settings, Denmark (from a country list), the zones of a country, all countries.
private enum PlaceRoute: Hashable { case area(String), settings, denmark, zones(String), countries }

/// "Where are you?": one sheet with an Apple grouped list. Two shapes, by the zone on screen:
///  - Danish: position, Denmark (Vest/Øst lead to the grid companies), "All countries", Settings. As it has always been.
///  - elsewhere: the country list (the device's country first, then all 30), where Denmark is a row like the others.
/// A choice applies at once and closes the sheet.
struct PlaceSheet: View {
    @Environment(AppModel.self) private var vm
    @State private var path: [PlaceRoute] = {
        #if DEBUG
        switch UserDefaults.standard.string(forKey: "debugTab") {
        case "dk1": return [.area("DK1")]
        case "dk2": return [.area("DK2")]
        case "settings": return [.settings]
        case "countries": return [.countries]
        case "norway": return [.zones("NO")]
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
                    case .settings: SettingsScreen().placeClose()
                    case .denmark: PlaceDenmark()
                    case .zones(let c): PlaceZoneList(country: c)
                    case .countries: PlaceCountryList()
                    }
                }
                .placeClose()
        }
        .tint(T.brandSolid)
    }
}

private extension View {
    /// Fælles udseende for listerne i arket: appens baggrund og flader, Manrope.
    func placeList() -> some View {
        self.scrollContentBackground(.hidden).background(T.bg.ignoresSafeArea())
            .listRowBackground(T.surface)
    }

    /// The button at the top right of every screen of the sheet: "Close", or "Skip" until the user has chosen once.
    func placeClose() -> some View { modifier(PlaceCloseButton()) }
}

private struct PlaceCloseButton: ViewModifier {
    @Environment(AppModel.self) private var vm
    func body(content: Content) -> some View {
        content.toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(L10n.string(vm.settings.onboarded ? "place_close" : "welcome_skip")) { vm.closePlace() }
                    .font(.app(16, .bold))
            }
        }
    }
}

// MARK: - rows

/// One row of a list: a title, a detail text at the right, a check for the current choice, and a chevron when it is a link
/// (the system draws that for a NavigationLink, so it is not part of this view).
private struct PlaceRowLabel: View {
    let title: String
    var detail: String = ""
    var current = false

    var body: some View {
        HStack {
            Text(title).font(.app(16, .semibold)).foregroundStyle(T.text)
            Spacer(minLength: 8)
            if !detail.isEmpty { Text(detail).font(.app(15, .medium)).foregroundStyle(T.text2).lineLimit(1) }
            if current { Image(systemName: "checkmark").font(.app(15, .bold)).foregroundStyle(T.brandSolid) }
        }
        .frame(minHeight: 32).contentShape(Rectangle())
    }
}

private func sectionHeader(_ t: String) -> some View {
    Text(t).font(.app(13, .bold)).foregroundStyle(T.text2).textCase(nil)
}

/// The note at the top when the position did not give a grid company.
private struct PlaceNoteRow: View {
    let note: PlaceNote
    var body: some View {
        Text(note.text).font(.app(14, .semibold)).lineSpacing(3).foregroundStyle(T.text)
            .padding(.vertical, 4)
            .listRowBackground(T.midSoft)
    }
}

/// "Use my position" (Danish screens only): finds the grid company once; "Forget my grid company" while one is saved.
private struct PositionSection: View {
    @Environment(AppModel.self) private var vm

    var body: some View {
        Section {
            Button { vm.detect() } label: {
                HStack(spacing: 12) {
                    if vm.locating { ProgressView().tint(T.brandSolid).frame(width: 22) }
                    else { Image(systemName: "location.fill").font(.app(16, .bold)).foregroundStyle(T.brandSolid).frame(width: 22) }
                    Text(L10n.string(vm.locating ? "searching_title" : "place_use_position")).font(.app(16, .bold)).foregroundStyle(T.brand)
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 32).contentShape(Rectangle())
            }
            .disabled(vm.locating)
            if vm.settings.net != nil {
                Button(L10n.string("place_forget"), role: .destructive) { vm.forget() }
                    .font(.app(16, .semibold)).foregroundStyle(T.bad).frame(minHeight: 32)
            }
        } footer: {
            Text(L10n.string("place_position_note")).font(.app(12.5)).foregroundStyle(T.text2)
        }
    }
}

/// Vestdanmark / Østdanmark: the detail is the saved grid company or "Without grid company"; a tap leads to the area's list.
private struct DenmarkAreaRows: View {
    @Environment(AppModel.self) private var vm

    var body: some View {
        let s = vm.settings
        // Outside Denmark no area is the current one, whatever area was stored before.
        let chosen = s.isDanish ? s.zone.key.uppercased() : ""
        ForEach(placeAreas, id: \.area) { a in
            NavigationLink(value: PlaceRoute.area(a.area)) {
                HStack {
                    Text(a.name).font(.app(16, .semibold)).foregroundStyle(T.text)
                    Spacer(minLength: 8)
                    Text(placeAreaDetail(area: a.area, net: s.net, chosenArea: chosen))
                        .font(.app(15, .medium)).foregroundStyle(T.text2).lineLimit(1)
                }
                .frame(minHeight: 32)
            }
        }
    }
}

/// A country row: its name, its zone/grid company if it is the current country, a check, and where a tap leads.
private struct CountryRow: View {
    @Environment(AppModel.self) private var vm
    let code: String

    var body: some View {
        let s = vm.settings
        let current = s.zone.country == code
        let label = PlaceRowLabel(title: Zones.countryName(code),
                                  detail: placeCountryDetail(country: code, zone: s.zone, net: s.net), current: current)
        switch placeCountryTarget(code) {
        case .choose(let z):
            Button { vm.chooseZone(z) } label: { label }.accessibilityAddTraits(current ? .isSelected : [])
        case .zones(let c):
            NavigationLink(value: PlaceRoute.zones(c)) { label }
        case .denmark:
            NavigationLink(value: PlaceRoute.denmark) { label }
        }
    }
}

// MARK: - root

private struct PlaceRoot: View {
    @Environment(AppModel.self) private var vm
    @Binding var query: String

    var body: some View {
        let s = vm.settings
        let searching = !query.trimmingCharacters(in: .whitespaces).isEmpty
        List {
            if searching {
                searchResults(s)
            } else if s.isDanish {
                danishRoot(s)
            } else {
                countryRoot(s)
            }
        }
        .placeList()
        .navigationTitle(L10n.string("place_title"))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: L10n.string("place_search_hint"))
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
    }

    // Danish context: as it has always been, with the web row replaced by the list of all countries.
    @ViewBuilder private func danishRoot(_ s: Settings) -> some View {
        if let note = vm.placeNote { PlaceNoteRow(note: note) }
        PositionSection()
        Section {
            DenmarkAreaRows()
        } header: { sectionHeader(L10n.string("place_group_dk")) }
        Section {
            NavigationLink(value: PlaceRoute.countries) {
                Text(L10n.string("place_all_countries")).font(.app(16, .semibold)).foregroundStyle(T.text).frame(minHeight: 32)
            }
        } header: { sectionHeader(L10n.string("place_others")) }
        settingsSection
    }

    // Elsewhere: welcome (first launch), the device's country, all countries. Denmark is a row like the others.
    @ViewBuilder private func countryRoot(_ s: Settings) -> some View {
        if !s.onboarded {
            VStack(alignment: .leading, spacing: 6) {
                Text(L10n.string("welcome_zone_title")).font(.app(22, .heavy)).foregroundStyle(T.text)
                Text(L10n.string("welcome_zone_body")).font(.app(14.5, .medium)).lineSpacing(3).foregroundStyle(T.text2)
            }
            .padding(.vertical, 6)
            .listRowBackground(Color.clear)
        }
        if let mine = Zones.deviceCountry() {
            Section { CountryRow(code: mine) } header: { sectionHeader(L10n.string("place_your_country")) }
        }
        Section {
            ForEach(placeCountries(), id: \.self) { CountryRow(code: $0) }
        } header: { sectionHeader(L10n.string("place_countries")) }
        settingsSection
    }

    private var settingsSection: some View {
        Section {
            NavigationLink(value: PlaceRoute.settings) {
                Text(L10n.string("place_settings")).font(.app(16, .semibold)).foregroundStyle(T.text).frame(minHeight: 32)
            }
        }
    }

    /// Countries (by localized name) and grid companies that match what was typed.
    @ViewBuilder private func searchResults(_ s: Settings) -> some View {
        let countries = placeSearchCountries(query)
        let nets = placeSearch(query)
        if countries.isEmpty && nets.isEmpty {
            Text(placeNoMatch(query)).font(.app(14.5)).foregroundStyle(T.text2)
                .frame(maxWidth: .infinity, alignment: .center).padding(.vertical, 24)
                .listRowBackground(Color.clear)
        } else {
            if !countries.isEmpty {
                Section {
                    ForEach(countries, id: \.self) { CountryRow(code: $0) }
                } header: { sectionHeader(L10n.string("place_countries")) }
            }
            if !nets.isEmpty {
                Section {
                    ForEach(nets) { n in
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
    }
}

// MARK: - the other screens

/// All countries, from the Danish root.
private struct PlaceCountryList: View {
    var body: some View {
        List {
            Section {
                ForEach(placeCountries(), id: \.self) { CountryRow(code: $0) }
            }
        }
        .placeList()
        .navigationTitle(L10n.string("place_countries"))
        .navigationBarTitleDisplayMode(.inline)
        .placeClose()
    }
}

/// The zones of a country with several (Norway, Sweden): "NO1 · Oslo" … One tap chooses.
private struct PlaceZoneList: View {
    @Environment(AppModel.self) private var vm
    let country: String

    var body: some View {
        let current = vm.settings.zone
        List {
            Section {
                ForEach(Zones.zones(of: country)) { z in
                    Button { vm.chooseZone(z) } label: { PlaceRowLabel(title: z.chipLabel, current: z == current) }
                        .accessibilityAddTraits(z == current ? .isSelected : [])
                }
            } footer: {
                Text(L10n.string("place_zone_note")).font(.app(12.5)).foregroundStyle(T.text2)
            }
        }
        .placeList()
        .navigationTitle(L10n.string("place_zone_title"))
        .navigationBarTitleDisplayMode(.inline)
        .placeClose()
    }
}

/// Denmark reached from a country list: the position row (Danish screens only) and Vestdanmark / Østdanmark.
private struct PlaceDenmark: View {
    @Environment(AppModel.self) private var vm

    var body: some View {
        List {
            if let note = vm.placeNote { PlaceNoteRow(note: note) }
            PositionSection()
            Section { DenmarkAreaRows() }
        }
        .placeList()
        .navigationTitle(L10n.string("place_group_dk"))
        .navigationBarTitleDisplayMode(.inline)
        .placeClose()
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
                row(L10n.string("view_nonet_title"), on: placeIsWithoutNet(area: area, net: s.net, chosenArea: s.isDanish ? s.zone.key.uppercased() : "")) { vm.chooseWithoutNet(area: area) }
                ForEach(Nets.all.filter { $0.area == area }) { n in
                    row(n.name, on: s.net?.gln == n.gln) { vm.choose(n, how: "manual") }
                }
            } footer: {
                Text(L10n.string("place_net_note")).font(.app(12.5)).foregroundStyle(T.text2)
            }
        }
        .placeList()
        .navigationTitle(placeAreaName(area))
        .navigationBarTitleDisplayMode(.inline)
        .placeClose()
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
