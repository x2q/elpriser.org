import SwiftUI

/// Pris: ét svar først (prisen nu, om den er billig, hvornår den bliver billigere), så grafen for de næste døgn.
/// Telefon: hero, periode, graf, to felter. Tablet: hero-kort til venstre, periode og graf til højre.
struct PrisScreen: View {
    @Environment(AppModel.self) private var vm
    @State private var selected: Int?
    /// Prisopbygningen under teksten er foldet ud.
    @State private var breakdownOpen = false

    init() {
        #if DEBUG
        // Kun til skærmbilleder: -debugBreakdown YES folder opdelingen ud, -debugSelect <indeks> vælger en søjle på forhånd.
        let d = UserDefaults.standard
        _breakdownOpen = State(initialValue: d.bool(forKey: "debugBreakdown"))
        _selected = State(initialValue: d.object(forKey: "debugSelect") != nil ? d.integer(forKey: "debugSelect") : nil)
        #endif
    }

    private enum Shape { case phone, stacked, columns }

    var body: some View {
        // Timen opdateres uden at vente på nye data: fx når appen har ligget i baggrunden hen over et timeskift.
        TimelineView(.periodic(from: .now, by: 30)) { _ in
            GeometryReader { g in
                // To kolonner kræver både bredde og et liggende format; en iPad på højkant får kortene stablet, med grafen
                // fyldende resten af højden.
                let shape: Shape = g.size.width >= 760 && g.size.width >= g.size.height * 1.2 ? .columns
                    : (g.size.width >= 600 && g.size.height >= g.size.width * 0.9 ? .stacked : .phone)
                content(shape, g.size)
            }
            // Grafens vindue følger timen: et valgt søjleindeks ville efter et timeskift pege på en anden time.
            .onChange(of: Clock.hour()) { _, _ in selected = nil }
        }
        .background(T.bg)
        .onChange(of: vm.period) { _, _ in selected = nil }
        .onChange(of: vm.settings.prisMode) { _, _ in selected = nil }
    }

    // MARK: indhold

    @ViewBuilder private func content(_ shape: Shape, _ size: CGSize) -> some View {
        let s = vm.settings
        let days = vm.days(s.prisMode)
        let today = Clock.today(), now = Clock.hour()
        let summary = prisSummary(days: days, today: today, now: now, period: vm.period)
        let chart = prisChart(period: vm.period, days: days, today: today, now: now)
        let tablet = shape != .phone
        let pad: CGFloat = shape == .phone ? 20 : 28
        let caption = CaptionModel(
            text: priceCaption(spot: s.prisIsSpot, hasNet: s.net != nil),
            breakdown: priceBreakdown(mode: s.prisMode, days: days, today: today, now: now, spec: chart, selected: selected,
                                      charges: vm.charges(s.prisMode), netName: s.net?.name),
            open: $breakdownOpen, onBack: { selected = nil })
        // Opdelingen gør hero-kortet højere; den højde lægges til, så prisen ikke skrumper og grafen ikke trykkes sammen.
        let extra: CGFloat = breakdownOpen && caption.breakdown != nil ? (selected != nil ? 380 : 330) : 0

        VStack(spacing: 0) {
            PrisHeader(tablet: tablet).padding(.horizontal, pad).padding(.top, 8).padding(.bottom, 12)
            if let summary {
                switch shape {
                case .columns:
                    let leftW = min(440, max(340, size.width * 0.36))
                    let h = max(size.height - 80, 560) + extra
                    ScrollView {
                        VStack(spacing: 12) {
                            if let e = vm.error { ErrorCard(text: e, onRetry: { vm.refresh(force: true) }) }
                            HStack(alignment: .top, spacing: 24) {
                                VStack(spacing: 16) {
                                    HeroCard(summary: summary, weekday: weekdayToday(today), caption: caption, compact: leftW < 400)
                                    Tiles(summary: summary, tablet: true)
                                }
                                .frame(width: leftW)
                                VStack(spacing: 20) {
                                    PeriodPill(wide: true)
                                    ChartCard(spec: chart, tablet: true, selected: $selected, fill: true, caption: caption)
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .frame(height: h)
                        }
                        .padding(.horizontal, pad).padding(.bottom, 20)
                    }
                    .refreshable { await vm.load(force: true) }
                case .stacked:
                    ScrollView {
                        VStack(spacing: 20) {
                            if let e = vm.error { ErrorCard(text: e, onRetry: { vm.refresh(force: true) }) }
                            if size.width >= 760 {
                                HStack(alignment: .top, spacing: 16) {
                                    HeroCard(summary: summary, weekday: weekdayToday(today), caption: caption)
                                    Tiles(summary: summary, tablet: true, vertical: true).frame(width: 260)
                                }
                            } else {
                                HeroCard(summary: summary, weekday: weekdayToday(today), caption: caption)
                            }
                            PeriodPill(wide: true)
                            ChartCard(spec: chart, tablet: true, selected: $selected, fill: true, caption: caption)
                            if size.width < 760 { Tiles(summary: summary, tablet: true) }
                        }
                        .frame(height: max(size.height - 80, 820) + extra)
                        .padding(.horizontal, pad).padding(.bottom, 20)
                    }
                    .refreshable { await vm.load(force: true) }
                case .phone:
                    ScrollView {
                        VStack(spacing: 20) {
                            if let e = vm.error { ErrorCard(text: e, onRetry: { vm.refresh(force: true) }) }
                            HeroPlain(summary: summary)
                            PeriodPill(wide: false)
                            ChartCard(spec: chart, tablet: false, selected: $selected, fill: false, caption: caption)
                            Tiles(summary: summary, tablet: false)
                        }
                        .padding(.horizontal, pad).padding(.bottom, 16)
                    }
                    .scrollBounceBehavior(.basedOnSize)
                    .refreshable { await vm.load(force: true) }
                }
            } else {
                ScrollView {
                    Group {
                        vm.loading
                            ? AnyView(LoadingView())
                            : AnyView(ErrorCard(text: vm.error ?? "Ingen priser for i dag endnu.", onRetry: { vm.refresh(force: true) }))
                    }
                    .padding(.horizontal, pad)
                }
                .refreshable { await vm.load(force: true) }
            }
        }
    }

    private func weekdayToday(_ today: String) -> String {
        weekdayName(Day(date: today, actual: true, price: [], lo: nil, hi: nil))
    }
}

// MARK: - header

private struct PrisHeader: View {
    @Environment(AppModel.self) private var vm
    let tablet: Bool

    var body: some View {
        let s = vm.settings
        let label = netChipLabel(net: s.net, area: s.effectiveArea)
        HStack {
            HStack(spacing: 10) {
                if !tablet {
                    Image(systemName: "bolt.fill").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 30, height: 30).background(T.brandSolid, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                        .accessibilityHidden(true)
                }
                Text("Elpriser").font(.app(tablet ? 20 : 17, .heavy)).tracking(-0.3)
            }
            Spacer(minLength: 8)
            NavigationLink(value: Route.settings) {
                HStack(spacing: 6) {
                    Image(systemName: "mappin.and.ellipse").font(.app(tablet ? 14 : 13, .bold)).foregroundStyle(T.brandSolid)
                    Text(label).font(.app(tablet ? 14 : 13, .bold)).foregroundStyle(T.text).lineLimit(1)
                }
                .padding(.horizontal, tablet ? 16 : 12).frame(height: tablet ? 40 : 36)
                .background(T.surface, in: Capsule())
                .overlay(Capsule().stroke(T.outline, lineWidth: 1))
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Netselskab og indstillinger, \(label)")
        }
    }
}

// MARK: - hero

private struct VerdictPill: View {
    let tier: PriceTier
    var large = false
    var body: some View {
        HStack(spacing: large ? 8 : 7) {
            Circle().fill(tier.color).frame(width: large ? 9 : 8, height: large ? 9 : 8)
            Text(tierLabel(tier)).font(.app(large ? 15 : 14, .heavy)).foregroundStyle(tier.ink)
        }
        .padding(.horizontal, large ? 14 : 12).frame(height: large ? 34 : 30)
        .background(tier.soft, in: Capsule())
    }
}

private func heroSentenceText(_ s: PrisSummary, size: CGFloat, color: Color) -> Text {
    guard let e = s.emphasis, let r = s.sentence.range(of: e) else {
        return Text(s.sentence).font(.app(size, .semibold)).foregroundStyle(color)
    }
    return Text(String(s.sentence[..<r.lowerBound])).font(.app(size, .semibold)).foregroundStyle(color)
        + Text(e).font(.app(size, .heavy)).foregroundStyle(T.text)
}

/// Telefonens hero: ligger direkte på baggrunden, som i designet.
private struct HeroPlain: View {
    let summary: PrisSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Elpris lige nu · kl. \(pad(summary.hour))").font(.app(13, .semibold)).foregroundStyle(T.text2)
            HStack(alignment: .lastTextBaseline, spacing: 8) {
                Text(fmt(summary.price)).font(.app(76, .heavy)).tracking(-3).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.5)
                Text("kr/kWh").font(.app(18, .bold)).foregroundStyle(T.text2)
            }
            .accessibilityElement(children: .combine)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) {
                    VerdictPill(tier: summary.tier)
                    heroSentenceText(summary, size: 14, color: T.text3).lineLimit(1)
                }
                VStack(alignment: .leading, spacing: 8) {
                    VerdictPill(tier: summary.tier)
                    heroSentenceText(summary, size: 14, color: T.text3)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Tabletternes hero-kort, med prisvalget og dets forklaring i kortet.
private struct HeroCard: View {
    let summary: PrisSummary
    let weekday: String
    let caption: CaptionModel
    /// Smalt hero-kort (telefon på langs): mindre tal og luft.
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 12 : 18) {
            Text("Elpris lige nu · \(weekday) kl. \(pad(summary.hour))").font(.app(14, .semibold)).foregroundStyle(T.text2)
            HStack(alignment: .lastTextBaseline, spacing: 10) {
                Text(fmt(summary.price)).font(.app(compact ? 76 : 104, .heavy)).tracking(compact ? -3 : -5).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.5)
                Text("kr/kWh").font(.app(compact ? 18 : 22, .bold)).foregroundStyle(T.text2)
            }
            .accessibilityElement(children: .combine)
            VerdictPill(tier: summary.tier, large: true)
            heroSentenceText(summary, size: compact ? 16 : 18, color: T.text3).lineSpacing(compact ? 3 : 5)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 8) {
                ModeSwitch(large: true)
                caption.view
            }
            .padding(.top, 4)
        }
        .padding(compact ? 22 : 32)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(T.surface, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).stroke(T.outline, lineWidth: 1))
        .accessibilityElement(children: .contain)
    }
}

// MARK: - valg

/// Din pris | Spotpris. Ændrer kun den gemte visning; alle fire gamle visninger hører stadig til i API'et.
private struct ModeSwitch: View {
    @Environment(AppModel.self) private var vm
    var large = false

    var body: some View {
        let spot = vm.settings.prisIsSpot
        HStack(spacing: 3) {
            seg("Din pris", on: !spot) { vm.settings.updateView(0) }
            seg("Spotpris", on: spot) { vm.settings.updateView(2) }
        }
        .padding(3)
        .background(T.surface2, in: RoundedRectangle(cornerRadius: large ? 16 : 14, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Prisvisning")
    }

    private func seg(_ title: String, on: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.app(large ? 14 : 12, on ? .heavy : .bold))
                .foregroundStyle(on ? T.text : T.text2)
                .padding(.horizontal, large ? 16 : 10).frame(minHeight: 38)
                .background {
                    if on {
                        RoundedRectangle(cornerRadius: large ? 13 : 11, style: .continuous).fill(T.surface)
                            .shadow(color: .black.opacity(0.12), radius: 1.5, y: 1)
                    }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// 2 døgn | 5 døgn, som en fanebjælke med den aktive i mørkeblåt.
private struct PeriodPill: View {
    @Environment(AppModel.self) private var vm
    let wide: Bool

    var body: some View {
        HStack(spacing: 0) {
            tab(.two)
            tab(.five)
        }
        .padding(4)
        .background(T.surface, in: Capsule())
        .shadow(color: .black.opacity(0.08), radius: 7, y: 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Periode")
    }

    private func tab(_ p: PricePeriod) -> some View {
        let on = vm.period == p
        return Button { vm.period = p } label: {
            Text(p.pillTitle).font(.app(15, .heavy))
                .foregroundStyle(on ? Color.white : Color(light: 0x14308f, dark: 0xa9c0ff))
                .padding(.horizontal, wide ? 26 : 0)
                .frame(maxWidth: wide ? nil : .infinity, minHeight: 44)
                .background(on ? T.navy : Color.clear, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(p.pillTitle)
        .accessibilityHint("Viser priserne for \(p.title.lowercased())")
        .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - grafkort

private struct ChartCard: View {
    let spec: PrisChartSpec?
    let tablet: Bool
    @Binding var selected: Int?
    let fill: Bool
    let caption: CaptionModel
    @Environment(AppModel.self) private var vm

    var body: some View {
        let title = vm.period.title
        VStack(alignment: .leading, spacing: tablet ? 14 : 10) {
            if tablet {
                // Forklaringen udgår, hvis kortet er for smalt til både titel og den.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) {
                        Text(title).font(.app(17, .heavy)).lineLimit(1).fixedSize()
                        Spacer(minLength: 8)
                        Legend().fixedSize()
                    }
                    Text(title).font(.app(17, .heavy)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                HStack(spacing: 12) {
                    Text(title).font(.app(14, .heavy)).lineLimit(1)
                    Spacer(minLength: 8)
                    ModeSwitch()
                }
                caption.view
            }
            if let spec {
                PriceBarChart(spec: spec, selected: $selected,
                              plotHeight: tablet ? 240 : 160, flexible: fill, large: tablet)
            } else {
                Text("Priserne for perioden er ikke hentet endnu.")
                    .font(.app(14, .semibold)).foregroundStyle(T.text2)
                    .frame(maxWidth: .infinity, minHeight: 120, alignment: .center)
                    .frame(maxHeight: fill ? .infinity : nil)
            }
        }
        .padding(tablet ? EdgeInsets(top: 24, leading: 28, bottom: 20, trailing: 28) : EdgeInsets(top: 16, leading: 16, bottom: 14, trailing: 16))
        .frame(maxWidth: .infinity, maxHeight: fill ? .infinity : nil, alignment: .topLeading)
        .background(T.surface, in: RoundedRectangle(cornerRadius: tablet ? 28 : 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: tablet ? 28 : 22, style: .continuous).stroke(T.outline, lineWidth: 1))
    }
}

private struct Legend: View {
    var body: some View {
        HStack(spacing: 16) {
            item("Billig", PriceTier.low.color)
            item("Middel", PriceTier.mid.color)
            item("Dyr", PriceTier.high.color)
        }
        .accessibilityHidden(true)
    }
    private func item(_ t: String, _ c: Color) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 3).fill(c).frame(width: 10, height: 10)
            Text(t).font(.app(12, .bold)).foregroundStyle(T.text2)
        }
    }
}

// MARK: - felter

private struct Tiles: View {
    let summary: PrisSummary
    let tablet: Bool
    var vertical = false

    var body: some View {
        let items = Group {
            tile(summary.cheapest)
            tile(summary.dearest)
        }
        if vertical { VStack(spacing: 12) { items } } else { HStack(spacing: 12) { items } }
    }

    private func tile(_ e: PrisExtreme) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(e.label).font(.app(12, .bold)).foregroundStyle(T.text2)
            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text(fmt(e.price)).font(.app(20, .heavy)).monospacedDigit()
                Text("kr · kl. \(pad(e.hour))").font(.app(12, .bold)).foregroundStyle(T.text2)
            }
            .lineLimit(1).minimumScaleFactor(0.8)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(T.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(T.outline, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

/// Det, teksten under Din pris | Spotpris skal bruge: selve teksten, opdelingen (nil uden `charges`) og om den er foldet ud.
struct CaptionModel {
    let text: String
    let breakdown: PriceBreakdown?
    let open: Binding<Bool>
    let onBack: () -> Void

    var view: some View { CaptionDisclosure(caption: text, breakdown: breakdown, open: open, onBack: onBack) }
}
