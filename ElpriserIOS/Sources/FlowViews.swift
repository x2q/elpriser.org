import SwiftUI

/// Første start og "find / skift netselskab" — ligger oven på hele appen.
struct FlowHost: View {
    @Environment(AppModel.self) private var vm

    var body: some View {
        ZStack {
            T.bg.ignoresSafeArea()
            switch vm.step {
            case .welcome: WelcomeView()
            case .searching: SearchingView()
            case .found(let net): FoundView(net: net)
            case .picker(let note): PickerView(note: note)
            case nil: EmptyView()
            }
        }
        .interactiveDismissDisabled()
    }
}

private struct Brand: View {
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "bolt.fill").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                .frame(width: 28, height: 28).background(T.brandSolid, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            Text("elpriser").font(.system(size: 15, weight: .heavy))
        }
    }
}

/// Holder indholdet smalt og centreret på iPad.
private struct Narrow<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        content().frame(maxWidth: 560).frame(maxWidth: .infinity)
    }
}

private struct WelcomeView: View {
    @Environment(AppModel.self) private var vm
    var body: some View {
        Narrow {
            VStack(spacing: 0) {
                HStack {
                    Brand()
                    Spacer()
                    Button(vm.settings.onboarded ? "Annullér" : "Spring over") {
                        vm.settings.onboarded ? vm.closeStep() : vm.skip()
                    }
                    .font(.system(size: 13, weight: .bold)).foregroundStyle(T.brand)
                }
                .padding(.horizontal, 20).frame(height: 56)
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ZStack {
                            Circle().fill(T.brandSoft.opacity(0.45)).frame(width: 200, height: 200)
                            Circle().fill(T.brandSoft.opacity(0.8)).frame(width: 144, height: 144)
                            Image(systemName: "mappin.and.ellipse").font(.system(size: 38, weight: .semibold)).foregroundStyle(.white)
                                .frame(width: 88, height: 88).background(T.brandSolid, in: Circle())
                        }
                        .frame(maxWidth: .infinity).frame(height: 210)
                        Text("Find dit netselskab").font(.system(size: 30, weight: .heavy)).tracking(-0.8).padding(.top, 12)
                        Text("Din elregning afhænger af, hvem der ejer ledningerne til dit hus. Med din position finder vi netselskabet, så priserne i appen er dem, du faktisk betaler.")
                            .font(.system(size: 15, weight: .medium)).lineSpacing(4).foregroundStyle(T.text2).padding(.top, 10)
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach([
                                "Vi spørger kun, når du trykker på knappen — aldrig i baggrunden.",
                                "Positionen bruges én gang. Vi gemmer netselskabet, ikke koordinaterne.",
                                "Du kan altid skifte eller glemme netselskabet under Indstillinger.",
                            ], id: \.self) { t in
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: "checkmark").font(.system(size: 14, weight: .bold)).foregroundStyle(T.brand)
                                        .frame(width: 32, height: 32).background(T.surface, in: Circle()).overlay(Circle().stroke(T.outline))
                                    Text(t).font(.system(size: 14, weight: .semibold)).lineSpacing(3).padding(.top, 5)
                                }
                            }
                        }
                        .padding(.top, 20)
                    }
                    .padding(.horizontal, 24)
                }
                VStack(spacing: 6) {
                    PrimaryButton(title: "Find mit netselskab", height: 56) { vm.detect() }
                    TextAction(title: "Vælg selv på listen") { vm.openPicker() }
                }
                .padding(.horizontal, 20).padding(.bottom, 12)
            }
        }
    }
}

private struct SearchingView: View {
    var body: some View {
        VStack(spacing: 6) {
            LoadingView()
            Text("Finder dit netselskab …").font(.system(size: 17, weight: .heavy))
            Text("Det tager et øjeblik. Positionen bliver ikke gemt.").font(.system(size: 13.5)).foregroundStyle(T.text2)
        }
        .padding(32)
    }
}

private struct FoundView: View {
    @Environment(AppModel.self) private var vm
    let net: Net
    var body: some View {
        Narrow {
            VStack(spacing: 0) {
                HStack { Brand(); Spacer() }.padding(.horizontal, 20).frame(height: 56)
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        Image(systemName: "checkmark").font(.system(size: 34, weight: .bold)).foregroundStyle(T.good)
                            .frame(width: 72, height: 72).background(T.goodSoft, in: Circle())
                        Text("VI FANDT").font(.system(size: 14, weight: .heavy)).tracking(1).foregroundStyle(T.text2).padding(.top, 20)
                        Text(net.name).font(.system(size: 44, weight: .heavy)).tracking(-1.4)
                        Text("Prisområde \(net.areaLabel) · netselskab for din adresse").font(.system(size: 16, weight: .semibold)).foregroundStyle(T.text2).padding(.top, 4)
                        VStack(alignment: .leading, spacing: 10) {
                            SectionLabel(text: "Hvad bliver gemt")
                            row("Netselskab: \(net.name) (prisområde \(net.area))", ok: true)
                            row("Gemmes kun på denne enhed", ok: true)
                            row("Din position — hverken koordinater eller adresse", ok: false)
                        }
                        .card(padding: 16).padding(.top, 22)
                        Text("Står netselskabet forkert? Positionen kan være upræcis tæt på en grænse mellem to netselskaber — så vælg det på listen.")
                            .font(.system(size: 12.5)).lineSpacing(3).foregroundStyle(T.text2).padding(.top, 14)
                    }
                    .padding(.horizontal, 24)
                }
                VStack(spacing: 6) {
                    PrimaryButton(title: "Brug \(net.name)", height: 56) { vm.choose(net, how: "gps") }
                    TextAction(title: "Det er ikke mit netselskab") { vm.openPicker() }
                }
                .padding(.horizontal, 20).padding(.bottom, 12)
            }
        }
    }

    private func row(_ text: String, ok: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: ok ? "checkmark" : "xmark").font(.system(size: 13, weight: .bold)).foregroundStyle(ok ? T.good : T.text2)
                .frame(width: 28, height: 28).background(ok ? T.goodSoft : T.surface2, in: Circle())
            Text(text).font(.system(size: 14, weight: .semibold)).lineSpacing(2)
        }
    }
}

private struct PickerView: View {
    @Environment(AppModel.self) private var vm
    let note: String?
    @State private var q = ""
    @State private var sel: Net?

    var body: some View {
        let needle = q.trimmingCharacters(in: .whitespaces).lowercased()
        let nets = Nets.all.filter { needle.isEmpty || $0.name.lowercased().contains(needle) }
        Narrow {
            VStack(spacing: 0) {
                HStack(spacing: 4) {
                    Button { vm.settings.onboarded ? vm.closeStep() : vm.openWelcome() } label: {
                        Image(systemName: "arrow.left").font(.system(size: 20, weight: .semibold)).foregroundStyle(T.text).frame(width: 48, height: 48)
                    }
                    .accessibilityLabel("Tilbage")
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Vælg netselskab").font(.system(size: 22, weight: .heavy)).tracking(-0.4)
                        Text("Står på din elregning").font(.system(size: 12, weight: .semibold)).foregroundStyle(T.text2)
                    }
                    Spacer()
                }
                .padding(.horizontal, 8).frame(height: 60)
                VStack(spacing: 10) {
                    if let note {
                        Text(note).font(.system(size: 13, weight: .semibold)).lineSpacing(3)
                            .padding(.horizontal, 14).padding(.vertical, 10).frame(maxWidth: .infinity, alignment: .leading)
                            .background(T.midSoft, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass").foregroundStyle(T.text2)
                        TextField("Søg netselskab", text: $q).font(.system(size: 16, weight: .semibold)).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                    .padding(.horizontal, 18).frame(height: 52).background(T.surface2, in: Capsule())
                    Button { vm.openWelcome() } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "mappin.and.ellipse")
                            Text("Ved du det ikke? Find det med din position").font(.system(size: 14, weight: .heavy))
                            Spacer(minLength: 0)
                        }
                        .foregroundStyle(T.brand).padding(.horizontal, 16).frame(height: 48)
                        .background(T.brandSoft, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16)
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach([("DK1", "DK1 · JYLLAND OG FYN"), ("DK2", "DK2 · SJÆLLAND, LOLLAND OG FALSTER")], id: \.0) { area, title in
                            let group = nets.filter { $0.area == area }
                            if !group.isEmpty {
                                SectionLabel(text: title).padding(.leading, 8).padding(.top, 14)
                                VStack(spacing: 0) {
                                    ForEach(group) { n in
                                        Button { sel = n } label: {
                                            HStack {
                                                Text(n.name).font(.system(size: 15, weight: .bold)).foregroundStyle(T.text)
                                                Spacer()
                                                RadioMark(selected: sel?.gln == n.gln)
                                            }
                                            .padding(.horizontal, 8).frame(minHeight: 50)
                                            .contentShape(Rectangle())
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                                .card(padding: 8)
                            }
                        }
                        if nets.isEmpty {
                            Text("Ingen netselskaber matcher “\(q)”.").font(.system(size: 14)).foregroundStyle(T.text2).frame(maxWidth: .infinity).padding(40)
                        }
                    }
                    .padding(.horizontal, 16).padding(.bottom, 16)
                }
                PrimaryButton(title: sel.map { "Gem \($0.name) som mit netselskab" } ?? "Vælg et netselskab", enabled: sel != nil, height: 56) {
                    if let sel { vm.choose(sel, how: "manual") }
                }
                .padding(.horizontal, 20).padding(.vertical, 12)
            }
        }
        .onAppear { sel = vm.settings.net }
    }
}
