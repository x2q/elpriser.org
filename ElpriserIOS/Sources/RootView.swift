import SwiftUI

enum Route: Hashable { case time }

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

    var body: some View {
        #if DEBUG
        // Kun til skærmbilleder: -debugTime YES åbner "Time for time" direkte.
        if UserDefaults.standard.bool(forKey: "debugTime") {
            NavigationStack { TimeScreen() }.task { model.refresh() }
        } else { tabs }
        #else
        tabs
        #endif
    }

    @ViewBuilder private var tabs: some View {
        @Bindable var m = model
        TabView(selection: $m.tab) {
            Tab("Nu", systemImage: "bolt", value: AppTab.nu) {
                NavigationStack { NuScreen().routes() }
            }
            Tab("Prognose", systemImage: "chart.line.uptrend.xyaxis", value: AppTab.prognose) {
                NavigationStack { PrognoseScreen().routes() }
            }
            Tab("Automation", systemImage: "clock", value: AppTab.automation) {
                NavigationStack { AutomationScreen().toolbar(.hidden, for: .navigationBar) }
            }
            Tab("Mere", systemImage: "line.3.horizontal", value: AppTab.settings) {
                NavigationStack { SettingsScreen().toolbar(.hidden, for: .navigationBar) }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tint(T.brandSolid)
        .preferredColorScheme(scheme)
        .fullScreenCover(isPresented: Binding(get: { model.step != nil }, set: { if !$0 { model.closeStep() } })) {
            FlowHost().environment(model).preferredColorScheme(scheme)
        }
        .task { model.refresh() }
        .onChange(of: phase) { _, p in if p == .active { model.refresh() } }
        .onChange(of: model.settings.mode) { _, _ in model.refresh() }
        .onChange(of: model.settings.netGln) { _, _ in model.refresh() }
        .onChange(of: model.settings.area) { _, _ in model.refresh() }
    }

    private var scheme: ColorScheme? {
        switch model.settings.theme { case "light": .light; case "dark": .dark; default: nil }
    }
}

extension View {
    /// Skærmene uden for fanerne (Time for time) og skjult navigationslinje på hovedskærmene.
    func routes() -> some View {
        self.toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { _ in TimeScreen() }
    }
}

// MARK: - Nu

/// Aktuel visning som tekst: hvad prisen indeholder.
func viewNote(_ s: Settings) -> String {
    switch s.mode {
    case "net_inkl_alt": return "inkl. \(s.net?.name ?? "")-nettarif, afgifter og moms"
    case "inkl_alt": return "inkl. tariffer, afgifter og moms · uden netselskab"
    case "spot_inkl": return "spotpris inkl. moms"
    default: return "spotpris ekskl. moms"
    }
}

func areaName(_ area: String) -> String { area == "DK1" ? "Vestdanmark" : "Østdanmark" }

/// Sammensat serie for flere døgn: priser, P10/P90 (faktiske døgn bruger prisen selv) og antal faktiske punkter.
struct Series {
    let vals: [Double], lo: [Double], hi: [Double]
    let nSolid: Int
}

func combine(_ days: [Day]) -> Series {
    let vals = days.flatMap { $0.price }
    let lo = days.flatMap { $0.lo ?? $0.price }
    let hi = days.flatMap { $0.hi ?? $0.price }
    let firstFc = days.firstIndex { !$0.actual }
    let n = firstFc.map { $0 * 24 } ?? vals.count
    return Series(vals: vals, lo: lo, hi: hi, nSolid: n)
}

struct NuScreen: View {
    @Environment(AppModel.self) private var vm

    var body: some View {
        let s = vm.settings
        let days = vm.days()
        let today = days.first.flatMap { $0.date == Clock.today() ? $0 : nil }
        let netLabel = s.net.map { "\($0.areaLabel) · \($0.name)" } ?? "\(s.effectiveArea) · vælg netselskab"

        Adaptive { wide in
            VStack(spacing: 0) {
                ScreenHeader(title: "Nu", subtitle: todayLong()) {
                    Button { vm.openPicker() } label: {
                        HStack(spacing: 6) {
                            Text(netLabel).font(.system(size: 13.5, weight: .bold))
                            Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold))
                        }
                        .foregroundStyle(T.text)
                        .padding(.horizontal, 14).frame(minHeight: 44)
                        .background(T.surface2, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
                if let today {
                    if wide {
                        HStack(alignment: .top, spacing: 20) {
                            ScrollView { NuMain(today: today, days: days).padding(.bottom, 20) }
                                .refreshable { await vm.load(force: true) }
                            ScrollView { WeekList(days: days).padding(.bottom, 20) }.frame(width: 360)
                        }
                        .padding(.horizontal, 20)
                    } else {
                        ScrollView { NuMain(today: today, days: days).padding(.horizontal, 16).padding(.bottom, 16) }
                            .refreshable { await vm.load(force: true) }
                    }
                } else {
                    ScrollView {
                        Group { vm.loading ? AnyView(LoadingView()) : AnyView(ErrorCard(text: vm.error ?? "Ingen priser for i dag endnu.", onRetry: { vm.refresh(force: true) })) }
                            .padding(16)
                    }
                }
            }
        }
        .background(T.bg)
    }
}

private struct NuMain: View {
    @Environment(AppModel.self) private var vm
    let today: Day
    let days: [Day]
    @State private var range = 0

    var body: some View {
        let s = vm.settings
        let now = Clock.hour()
        let vals = today.price
        let price = vals[now]
        let v = verdict(price, vals)
        let (vbg, vfg): (Color, Color) = v.kind == 0 ? (T.goodSoft, T.good) : v.kind == 1 ? (T.midSoft, T.mid) : (T.badSoft, T.bad)
        let co2 = vm.co2[today.date]
        let cheap = cheapestWindow(vals, 3), peak = cheapestWindow(vals, 3, highest: true)
        let save = Int(((1 - cheap.avg / peak.avg) * 100).rounded())

        VStack(spacing: 12) {
            if let e = vm.error { ErrorCard(text: e, onRetry: { vm.refresh(force: true) }) }

            VStack(alignment: .leading, spacing: 0) {
                Text("\(areaName(s.effectiveArea)) · \(s.effectiveArea)\(s.net.map { " · \($0.name)" } ?? "") · LIGE NU KL. \(pad(now))".uppercased())
                    .font(.system(size: 11.5, weight: .bold)).tracking(0.8).foregroundStyle(T.text2)
                HStack(alignment: .lastTextBaseline, spacing: 6) {
                    Text(fmt(price)).font(.system(size: 68, weight: .bold)).tracking(-2.5).minimumScaleFactor(0.6).lineLimit(1)
                    Text("kr/kWh").font(.system(size: 16, weight: .bold)).foregroundStyle(T.text2)
                }
                .padding(.top, 2)
                Text(viewNote(s)).font(.system(size: 13, weight: .medium)).foregroundStyle(T.text2)
                HStack(spacing: 8) {
                    Pill(text: v.label, bg: vbg, fg: vfg)
                    if let co2 { Pill(text: "\(co2[now]) g CO₂/kWh", bg: T.co2Soft, fg: T.co2) }
                }
                .padding(.top, 12)
            }
            .card(padding: 20)

            let inCheap = now >= cheap.s && now < cheap.e
            Text((inCheap ? "Strømmen er billig nu. " : "") + "De tre billigste timer i dag er kl. \(cheap.label) — \(fmt(cheap.avg)) kr/kWh i snit, \(save) % under spidsen kl. \(peak.label).")
                .font(.system(size: 14.5, weight: .semibold)).lineSpacing(3).foregroundStyle(.white)
                .padding(.horizontal, 18).padding(.vertical, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(T.brandSolid, in: RoundedRectangle(cornerRadius: 24, style: .continuous))

            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Prisen time for time").font(.system(size: 15, weight: .heavy))
                    Spacer()
                    Segmented(options: ["I dag", "3 døgn"], selected: range) { range = $0 }.frame(width: 190)
                }
                if range == 0 {
                    PriceChart(vals: vals, nSolid: today.actual ? 24 : 0, nowIndex: now, lo: today.lo, hi: today.hi)
                } else {
                    let three = Array(days.prefix(3))
                    let c = combine(three)
                    PriceChart(vals: c.vals, nSolid: c.nSolid, nowIndex: now, lo: c.lo, hi: c.hi, bandFrom: c.nSolid, days: three.count, dayNames: three.map(dayLabel))
                }
                NavigationLink(value: Route.time) {
                    Text("Se time for time").font(.system(size: 13.5, weight: .bold)).foregroundStyle(T.brand)
                        .padding(.horizontal, 18).frame(minHeight: 44)
                        .background(T.brandSoft, in: Capsule())
                }
                .buttonStyle(.plain)
            }
            .card()

            HStack(spacing: 8) {
                let lo = vals.min()!, hi = vals.max()!
                StatTile(label: "Billigst", value: fmt(lo), sub: "kl. \(pad(vals.firstIndex(of: lo)!))", color: T.good)
                StatTile(label: "Dyrest", value: fmt(hi), sub: "kl. \(pad(vals.firstIndex(of: hi)!))", color: T.bad)
                if let co2, let g = co2.min() {
                    StatTile(label: "Grønnest", value: "\(g)", sub: "g kl. \(pad(co2.firstIndex(of: g)!))", color: T.co2)
                }
            }
        }
    }
}

struct WeekList: View {
    @Environment(AppModel.self) private var vm
    let days: [Day]
    var body: some View {
        let shown = Array(days.prefix(7))
        let lo = shown.map { $0.price.min()! }.min() ?? 0, hi = shown.map { $0.price.max()! }.max() ?? 1
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(text: "Næste 7 døgn")
            ForEach(shown) { d in
                Button { vm.selDay = days.firstIndex { $0.id == d.id } ?? 0; vm.tab = .prognose } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(dayLabel(d)).font(.system(size: 14, weight: .bold))
                            Text(d.actual ? "Børspris" : "Prognose").font(.system(size: 11.5, weight: .semibold)).foregroundStyle(T.text2)
                        }
                        .frame(width: 92, alignment: .leading)
                        RangeBar(min: d.price.min()!, max: d.price.max()!, lo: lo, hi: hi)
                        Text(fmt(d.price.reduce(0, +) / 24)).font(.system(size: 14, weight: .heavy)).frame(width: 52, alignment: .trailing)
                    }
                    .padding(.vertical, 9)
                }
                .buttonStyle(.plain)
            }
        }
        .card()
    }
}

// MARK: - Prognose

struct PrognoseScreen: View {
    @Environment(AppModel.self) private var vm
    @State private var basis = 0

    var body: some View {
        let s = vm.settings
        let mode = basis == 0 ? s.mode : "spot_inkl"
        let days = vm.days(mode)
        let sel = min(max(vm.selDay, 0), max(days.count - 1, 0))
        let ownLabel = s.mode == "net_inkl_alt" ? "Din pris" : "Valgt visning"

        Adaptive { wide in
            VStack(spacing: 0) {
                ScreenHeader(title: "Prognose", subtitle: "10 døgn frem · børspris og modelprognose")
                if days.isEmpty {
                    ScrollView { Group { vm.loading ? AnyView(LoadingView()) : AnyView(ErrorCard(text: vm.error ?? "Ingen data endnu.", onRetry: { vm.refresh(force: true) })) }.padding(16) }
                } else {
                    let list = VStack(spacing: 12) {
                        if s.mode != "spot_inkl" {
                            Segmented(options: [ownLabel, "Spot inkl. moms"], selected: basis) { basis = $0 }
                        }
                        let lo = days.map { $0.price.min()! }.min()!, hi = days.map { $0.price.max()! }.max()!
                        VStack(spacing: 0) {
                            ForEach(Array(days.enumerated()), id: \.element.id) { i, d in
                                Button { vm.selDay = i } label: {
                                    HStack {
                                        VStack(alignment: .leading, spacing: 0) {
                                            Text(dayLabel(d)).font(.system(size: 14, weight: .bold))
                                            Text("\(dayMonth(d)) · \(d.actual ? "børspris" : "prognose")").font(.system(size: 11.5, weight: .semibold)).foregroundStyle(T.text2)
                                        }
                                        .frame(width: wide ? 128 : 104, alignment: .leading)
                                        RangeBar(min: d.price.min()!, max: d.price.max()!, lo: lo, hi: hi)
                                        Text(fmt(d.price.reduce(0, +) / 24)).font(.system(size: 14.5, weight: .heavy)).frame(width: 54, alignment: .trailing)
                                    }
                                    .padding(.horizontal, 10).padding(.vertical, 10)
                                    .background(i == sel ? T.brandSoft : Color.clear, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .card(padding: 8)
                    }
                    let detail = DayDetail(day: days[sel])
                    if wide {
                        HStack(alignment: .top, spacing: 20) {
                            ScrollView { list.padding(.bottom, 20) }
                            ScrollView { detail.padding(.bottom, 20) }
                        }
                        .padding(.horizontal, 20)
                    } else {
                        ScrollView { VStack(spacing: 12) { list; detail }.padding(.horizontal, 16).padding(.bottom, 16) }
                            .refreshable { await vm.load(force: true) }
                    }
                }
            }
        }
        .background(T.bg)
    }
}

private struct DayDetail: View {
    @Environment(AppModel.self) private var vm
    let day: Day
    var body: some View {
        let cheap = cheapestWindow(day.price, 3), peak = cheapestWindow(day.price, 3, highest: true)
        VStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(dayLong(day)).font(.system(size: 17, weight: .heavy))
                    Text(day.actual ? "Offentliggjorte børspriser" : "Modelprognose med P10–P90-bånd")
                        .font(.system(size: 12.5, weight: .semibold)).foregroundStyle(T.text2)
                }
                PriceChart(vals: day.price, nSolid: day.actual ? 24 : 0, nowIndex: nil, lo: day.lo, hi: day.hi)
                HStack(spacing: 8) {
                    StatTile(label: "Billigste 3 t", value: fmt(cheap.avg), sub: "kl. \(cheap.label)", color: T.good)
                    StatTile(label: "Dyreste 3 t", value: fmt(peak.avg), sub: "kl. \(peak.label)", color: T.bad)
                }
                if let lo = day.lo, let hi = day.hi {
                    Text("Usikkerhed: gennemsnittet ligger mellem \(fmt(lo.reduce(0, +) / 24)) og \(fmt(hi.reduce(0, +) / 24)) kr/kWh (P10–P90). Jo længere frem, jo bredere bånd.")
                        .font(.system(size: 12.5, weight: .medium)).lineSpacing(3).foregroundStyle(T.text2)
                }
                NavigationLink(value: Route.time) {
                    Text("Se time for time").font(.system(size: 13.5, weight: .bold)).foregroundStyle(T.brand)
                        .padding(.horizontal, 18).frame(minHeight: 44)
                        .background(T.brandSoft, in: Capsule())
                }
                .buttonStyle(.plain)
            }
            .card()
            if let m = vm.modelName {
                Text("Prognosen kommer fra en åben model (\(m)) og opdateres hver dag. Se modellen og data på huggingface.co/Elpriser.")
                    .font(.system(size: 11.5)).lineSpacing(3).foregroundStyle(T.text2).padding(.horizontal, 8)
            }
        }
    }
}
