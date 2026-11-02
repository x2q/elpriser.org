import Foundation

// Ren logik til Pris-skærmen (Design A): niveau, akse, sætningen under prisen, statistikfelter og
// søjlerne. Intet her rører ved visning, netværk eller tid — "nu" og "i dag" gives udefra, så alt kan testes.

/// Periode-vælgeren: de næste 2 døgn eller de næste 5 døgn. Kalenderdøgnene (hero, nøgletal) er i dag + 1 eller i dag + 4;
/// grafen starter seks timer før nu og løber 48 eller 120 timer frem (se `chartWindow`).
enum PricePeriod: Int {
    case two = 2, five = 5

    /// Døgn regnet fra i dag (0 = i dag), som perioden dækker som kalender.
    var offsets: ClosedRange<Int> { self == .two ? 0...1 : 0...4 }
    /// Døgn, grafen kan komme ind i: vinduet starter i dag og slutter højst seks timer ind i døgn 3 (2 døgn) eller døgn 6 (5 døgn).
    var chartOffsets: ClosedRange<Int> { self == .two ? 0...2 : 0...5 }

    /// Knappen i periodevælgeren.
    var pillTitle: String { L10n.string(self == .two ? "period_two" : "period_five") }
    /// Titlen på grafkortet.
    var title: String { L10n.string(self == .two ? "period_title_two" : "period_title_five") }

    /// Gemte værdier og startargumenter. Den gamle "3–10 døgn"-visning (10, "long", "3-10" …) er nu 5 døgn;
    /// alt ukendt giver nil, så kalderen beholder standarden i stedet for at fejle.
    init?(stored value: String?) {
        let v = (value ?? "").trimmingCharacters(in: .whitespaces).lowercased()
        switch v {
        case "2", "two", "2d", "2 døgn": self = .two
        case "5", "five", "5d", "5 døgn",
             "10", "long", "3-10", "3–10", "3_10", "3-10 døgn", "3–10 døgn": self = .five
        default: return nil
        }
    }
}

enum PriceTier: Int { case low = 0, mid, high }

/// Niveauet efter appens eksisterende regel (`verdict`: hvor mange af timerne er billigere), målt mod `ref`.
func priceTier(_ price: Double, in ref: [Double]) -> PriceTier {
    guard !ref.isEmpty else { return .mid }
    switch verdict(price, ref).kind {
    case 0: return .low
    case 1: return .mid
    default: return .high
    }
}

func tierLabel(_ t: PriceTier) -> String {
    switch t {
    case .low: L10n.string("verdict_cheap")
    case .mid: L10n.string("verdict_mid")
    case .high: L10n.string("verdict_high")
    }
}

// MARK: - y-aksen

/// Nulbaseret akse: maks = højeste pris × 1,12 rundet op til næste 0,5, så den højeste søjle aldrig rører toppen.
/// Negative priser trækker aksen ned under nul på samme måde.
struct PriceAxis: Equatable {
    let min: Double
    let max: Double
    let ticks: [Double]

    func label(_ v: Double) -> String {
        abs(v - v.rounded()) < 1e-9 ? String(Int(v.rounded())) : fmt(v, 1)
    }
}

/// The axis for a unit. Danish kroner: the rule below, unchanged. A sub-unit (ct, øre ...): the values are tens, so nice steps
/// (0.5, then 1, 2, 5 × 10^k, never more than five intervals) and the same room above the tallest bar (× 1,12);
/// negative prices extend the axis below zero.
func priceAxis(lo: Double, hi: Double, unit: PriceUnit) -> PriceAxis {
    guard unit.isSubUnit else { return priceAxis(lo: lo, hi: hi) }
    let top0 = hi > 0 ? hi * 1.12 : 0
    let bottom0 = lo < 0 ? lo * 1.12 : 0
    let span0 = Swift.max(top0 - bottom0, 1)
    let steps: [Double] = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]
    let step = steps.first { span0 / $0 <= 5 } ?? 10000
    let top = hi > 0 ? (top0 / step - 1e-9).rounded(.up) * step : (bottom0 < 0 ? 0 : step)
    let bottom = lo < 0 ? (bottom0 / step + 1e-9).rounded(.down) * step : 0
    var ticks: [Double] = []
    var v = bottom
    while v <= top + 1e-9 { ticks.append(v); v += step }
    return PriceAxis(min: bottom, max: top, ticks: ticks)
}

func priceAxis(lo: Double, hi: Double) -> PriceAxis {
    func roundUp(_ v: Double) -> Double { (v * 1.12 / 0.5).rounded(.up) * 0.5 }
    let top = hi > 0 ? roundUp(hi) : 0.5
    let bottom = lo < 0 ? -roundUp(-lo) : 0
    let span = top - bottom
    // Hele kroner som standard; halve, når aksen er lav, og grovere, når en prisspids gør den høj.
    let step: Double = span < 2 ? 0.5 : (span <= 5 ? 1 : (span / 5).rounded(.up))
    var ticks: [Double] = []
    var v = (bottom / step - 1e-9).rounded(.up) * step
    while v <= top + 1e-9 { ticks.append(v); v += step }
    return PriceAxis(min: bottom, max: top, ticks: ticks)
}

// MARK: - søjler

struct PrisBar: Equatable {
    let value: Double
    let tier: PriceTier
    /// Døgnets plads blandt `PrisChartSpec.dayNames` (0 = det første døgn med søjler i vinduet).
    let dayOffset: Int
    let hour: Int
    /// Timen er allerede gået (kun i dag).
    let past: Bool
    let actual: Bool
    /// Døgnets dato ("2026-10-15"), så prisopbygningen kan finde døgnet — og dets nettarif — igen.
    let date: String
    /// Dagsordene i tippet: "I dag", "I morgen", "søn 17. okt".
    let when: String
    /// The same inside a sentence: "i dag", "i morgen", "søn 17. okt" (the catalogue's lower-case day words).
    let whenInline: String
    /// Teksten i værktøjstippet: "I dag kl. 19 · 3,90 kr/kWh", "søn 17. okt kl. 13 · 0,51 kr/kWh".
    let tip: String
}

struct AxisLabel: Equatable {
    /// Position i søjleenheder fra venstre kant (0 = første søjles venstrekant).
    let at: Double
    let text: String
}

/// Grafens vindue, talt i timer fra i dag kl. 00: seks timer før nu (ved kl. 00: fra midnat) og `period` døgn frem,
/// kortet af hvis data slutter før. Samme regel som på nettet (prisChart i functions/[[path]].js).
struct ChartWindow: Equatable {
    let start: Int
    let count: Int
}

func chartWindow(period: PricePeriod, now: Int, availableHours: Int) -> ChartWindow {
    let h = Swift.min(Swift.max(now, 0), 23)
    let back = Swift.min(6, h)
    let start = h - back
    let want = h > 0 ? back + period.rawValue * 24 : period.rawValue * 24
    return ChartWindow(start: start, count: Swift.max(Swift.min(want, availableHours - start), 0))
}

struct PrisChartSpec: Equatable {
    let period: PricePeriod
    let bars: [PrisBar]
    let axis: PriceAxis
    /// Ét navn pr. døgn, der er med i vinduet: "I dag", "I morgen", "fre" (2 døgn; til "fre 00") eller "fre 15" (5 døgn).
    let dayNames: [String]
    /// The same days as the 2-day axis writes them at midnight: "I dag 00", "I morgen 00", "fre 00".
    var midnightNames: [String] = []
    /// The unit of the values (kroner in Denmark, a sub-unit elsewhere).
    var unit: PriceUnit = .kroner
    /// Indeks på døgnets første søjle, ét pr. døgn i vinduet. Det første døgn starter typisk før vinduet (negativt eller 0).
    let dayStarts: [Int]
    let nowIndex: Int?
    /// Første søjle, der er prognose — nil når alt i vinduet er offentliggjort.
    let forecastFrom: Int?

    var title: String { period.title }
    var days: Int { dayNames.count }

    /// Søjleindeks hvor et nyt døgn begynder strengt inde i vinduet: her tegnes midnatsskillelinjerne.
    var midnights: [Int] { dayStarts.filter { $0 > 0 && $0 < bars.count } }

    /// 2 døgn: en etiket ved hver `step`. klokketime (6 eller 12) i vinduet, uret fra nu; midnat hedder "I dag 00", "I morgen 00"
    /// eller "fre 00". 5 døgn: ét navn pr. døgn midt under den del af døgnet, der er med (ingen med under seks timer).
    func xLabels(step: Int) -> [AxisLabel] {
        if period == .five {
            return dayNames.indices.compactMap { k in
                let start = k < dayStarts.count ? dayStarts[k] : 0
                let end = k + 1 < dayStarts.count ? dayStarts[k + 1] : bars.count
                let vs = Swift.max(start, 0), ve = Swift.min(end, bars.count)
                guard ve - vs >= 6 else { return nil }
                return AxisLabel(at: Double(vs + ve) / 2, text: dayNames[k])
            }
        }
        return bars.indices.compactMap { i in
            let b = bars[i]
            guard b.hour % Swift.max(step, 1) == 0 else { return nil }
            let k = Swift.min(b.dayOffset, dayNames.count - 1)
            let midnight = k < midnightNames.count ? midnightNames[k] : "\(dayNames[k]) 00"
            return AxisLabel(at: Double(i), text: b.hour == 0 ? midnight : pad(b.hour))
        }
    }

    /// Kort tekst til skærmlæsere.
    var summary: String {
        guard let lo = bars.min(by: { $0.value < $1.value }), let hi = bars.max(by: { $0.value < $1.value }) else { return title }
        // "Billigst i morgen: 1,38 kr/kWh kl. 13." — the day, the price and the hour, so the reader also says when, not only what.
        func tile(_ key: String, _ b: PrisBar) -> String {
            L10n.string("chart_summary_tile", L10n.string(key, b.whenInline), unit.withUnit(b.value), pad(b.hour))
        }
        return "\(title). \(tile("tile_cheapest", lo)) \(tile("tile_priciest", hi)) \(L10n.string("chart_hint"))"
    }
}

/// Døgnene, en periode dækker, fundet på dato (ikke på plads), så et hul i data ikke flytter timerne.
func daysIn(_ period: PricePeriod, days: [Day], today: String, offsets: ClosedRange<Int>? = nil) -> [(offset: Int, day: Day)] {
    let base = Clock.parse(today)
    let wanted = offsets ?? period.offsets
    return days.compactMap { d in
        guard let n = Clock.calendar.dateComponents([.day], from: base, to: d.localDate).day,
              wanted.contains(n) else { return nil }
        return (n, d)
    }
    .sorted { $0.offset < $1.offset }
}

/// Søjlerne for en periode: seks timer før nu og 48 eller 120 timer frem (`chartWindow`). nil når perioden ingen døgn har.
/// Alle indeks i specifikationen (nowIndex, forecastFrom, dayStarts, `selected`) tælles fra vinduets første søjle; en søjle
/// kender selv sin dato og time, så tip og prisopbygning altid peger på den rigtige time.
func prisChart(period: PricePeriod, days: [Day], today: String, now: Int, unit: PriceUnit = .kroner) -> PrisChartSpec? {
    let calendar = daysIn(period, days: days, today: today)
    guard !calendar.isEmpty else { return nil }
    // Niveauet er tertiler af kalenderperioden (2 døgn: 48 timer, 5 døgn: 120 timer); søjler uden for den måles mod samme referenceværdier.
    let all = calendar.flatMap { $0.day.price }
    guard !all.isEmpty else { return nil }
    let span = daysIn(period, days: days, today: today, offsets: period.chartOffsets)

    var bars: [PrisBar] = []
    var starts: [Int] = []
    var firstForecast: Int?
    for (k, item) in span.enumerated() {
        let d = item.day
        starts.append(bars.count)
        // I dag og i morgen går på ord; senere døgn på ugedag og dato.
        let later = "\(dayShort(d)) \(dayMonth(d))"
        let when = item.offset == 0 ? L10n.string("day_today_cap") : (item.offset == 1 ? L10n.string("day_tomorrow_cap") : later)
        let inline = item.offset == 0 ? L10n.string("day_today") : (item.offset == 1 ? L10n.string("day_tomorrow") : later)
        for (h, v) in d.price.enumerated() {
            if !d.actual && firstForecast == nil { firstForecast = bars.count }
            bars.append(PrisBar(
                value: v, tier: priceTier(v, in: all), dayOffset: k, hour: h,
                past: item.offset == 0 && h < now, actual: d.actual, date: d.date, when: when, whenInline: inline,
                tip: L10n.string("tooltip", when, pad(h), unit.withUnit(v))))
        }
    }
    let hasToday = span.first?.offset == 0
    let w = chartWindow(period: period, now: hasToday ? now : 0, availableHours: bars.count)
    guard w.count > 0 else { return nil }
    let shown = Array(bars[w.start..<(w.start + w.count)])

    // Døgnene, der har søjler i vinduet, med deres første søjle talt fra vinduets start.
    var names: [String] = [], midnights: [String] = [], dayStarts: [Int] = [], firstDay = -1
    for (k, item) in span.enumerated() {
        let from = starts[k], to = k + 1 < starts.count ? starts[k + 1] : bars.count
        guard to > w.start, from < w.start + w.count else { continue }
        if firstDay < 0 { firstDay = k }
        dayStarts.append(from - w.start)
        let d = item.day
        names.append(period == .two
            ? (item.offset == 0 ? L10n.string("day_today_cap") : (item.offset == 1 ? L10n.string("day_tomorrow_cap") : dayShort(d)))
            : dayShortNum(d))
        midnights.append(item.offset == 0 ? L10n.string("axis_today_midnight")
            : (item.offset == 1 ? L10n.string("axis_tomorrow_midnight") : "\(dayShort(d)) 00"))
    }
    let forecastFrom = firstForecast.flatMap { $0 < w.start + w.count ? Swift.max($0 - w.start, 0) : nil }
    let nowIdx = hasToday ? now - w.start : -1
    let values = shown.map(\.value)
    return PrisChartSpec(
        period: period,
        bars: shown.map { b in PrisBar(value: b.value, tier: b.tier, dayOffset: b.dayOffset - firstDay, hour: b.hour,
                                       past: b.past, actual: b.actual, date: b.date, when: b.when, whenInline: b.whenInline, tip: b.tip) },
        axis: priceAxis(lo: Swift.min(values.min() ?? 0, 0), hi: values.max() ?? 0, unit: unit),
        dayNames: names, midnightNames: midnights, unit: unit, dayStarts: dayStarts,
        nowIndex: (0..<shown.count).contains(nowIdx) ? nowIdx : nil,
        forecastFrom: forecastFrom)
}

// MARK: - hero og statistikfelter

struct PrisExtreme: Equatable {
    let label: String
    let price: Double
    let hour: Int
}

struct PrisSummary: Equatable {
    let hour: Int
    let price: Double
    let tier: PriceTier
    /// Hele sætningen under prisen, og den del af den der er fed ("1,38 kr") — nil for "Billigste time …".
    let sentence: String
    let emphasis: String?
    let cheapest: PrisExtreme
    let dearest: PrisExtreme
}

/// Sætningen under prisen: den billigste time de næste 24 timer, hvis den er billigere end nu.
/// `prices` er i dag fulgt af i morgen (op til 48 timer), `now` timen i dag.
func heroSentence(prices: [Double], now: Int, unit: PriceUnit = .kroner) -> (text: String, emphasis: String?) {
    guard now >= 0, now < prices.count else { return ("", nil) }
    let end = Swift.min(now + 24, prices.count)
    var best = now
    for i in now..<end where prices[i] < prices[best] { best = i }
    guard best != now, prices[best] < prices[now] else { return (L10n.string("cheaper_none"), nil) }
    let amount = unit.amount(prices[best])
    let day = L10n.string(best < 24 ? "day_today" : "day_tomorrow")
    return (L10n.string("cheaper_later", day, pad(best % 24), amount), amount)
}

/// "Billigst i morgen" / "Dyrest i aften" / "Billigst søn 17." for den time blandt de kommende, der holder ekstremet.
/// `laterDays[k]` er navnet på døgn k i vinduet ("søn 17.") og bruges fra og med døgn 2; uden navn: "senere".
func prisExtremes(prices: [Double], now: Int, laterDays: [String] = []) -> (cheapest: PrisExtreme, dearest: PrisExtreme)? {
    guard now >= 0, now < prices.count else { return nil }
    var lo = now, hi = now
    for i in now..<prices.count {
        if prices[i] < prices[lo] { lo = i }
        if prices[i] > prices[hi] { hi = i }
    }
    func later(_ i: Int) -> String { let d = i / 24; return d < laterDays.count ? laterDays[d] : L10n.string("day_later") }
    let today = L10n.string("day_today"), tomorrow = L10n.string("day_tomorrow")
    let loWhen = lo < 24 ? today : (lo < 48 ? tomorrow : later(lo))
    let hiWhen = hi >= 48 ? later(hi) : (hi >= 24 ? tomorrow : (hi % 24 >= 17 ? L10n.string("day_tonight") : today))
    return (PrisExtreme(label: L10n.string("tile_cheapest", loWhen), price: prices[lo], hour: lo % 24),
            PrisExtreme(label: L10n.string("tile_priciest", hiWhen), price: prices[hi], hour: hi % 24))
}

/// Alt hero og felter skal bruge. nil når i dag mangler (så viser skærmen indlæsning eller fejl).
/// Hero (niveau og sætning) hører altid til de næste 48 timer; felterne følger periodens synlige vindue.
func prisSummary(days: [Day], today: String, now: Int, period: PricePeriod = .two, unit: PriceUnit = .kroner) -> PrisSummary? {
    let window = daysIn(period, days: days, today: today)
    guard let first = window.first, first.offset == 0, now >= 0, now < first.day.price.count else { return nil }
    // Døgnene hænger sammen fra i dag; et hul afslutter vinduet (så en time aldrig får forkert dag).
    var run: [(offset: Int, day: Day)] = []
    for item in window {
        guard item.offset == run.count else { break }
        run.append(item)
    }
    let prices = run.flatMap { $0.day.price }
    let twoDays = run.prefix(2).flatMap { $0.day.price }
    let names = run.map { dayShortDate($0.day) }
    guard let ext = prisExtremes(prices: prices, now: now, laterDays: names) else { return nil }
    let s = heroSentence(prices: twoDays, now: now, unit: unit)
    return PrisSummary(
        hour: now, price: prices[now], tier: priceTier(prices[now], in: twoDays),
        sentence: s.text, emphasis: s.emphasis, cheapest: ext.cheapest, dearest: ext.dearest)
}

/// Næste valgte time, når skærmlæserens justering skubber: en time ad gangen, fra den nuværende time, aldrig udenfor.
func stepSelection(current: Int?, nowIndex: Int?, count: Int, forward: Bool) -> Int? {
    guard count > 0 else { return nil }
    let cur = current ?? nowIndex ?? 0
    return Swift.min(Swift.max(cur + (forward ? 1 : -1), 0), count - 1)
}

// MARK: - tekster

func priceCaption(spot: Bool, hasNet: Bool) -> String {
    if spot { return L10n.string("caption_spot_incl") }
    return L10n.string(hasNet ? "caption_net" : "caption_system")
}

/// Outside Denmark: the day-ahead price alone, no grid fee, taxes or VAT.
func zoneCaption() -> String { L10n.string("caption_zone") }

/// Netselskabsknappen: "N1 · Vest", eller "DK1 · Vest" uden netselskab.
func netChipLabel(net: Net?, area: String) -> String {
    let side = L10n.string((net?.area ?? area) == "DK1" ? "area_west" : "area_east")
    return "\(net?.name ?? (net?.area ?? area)) · \(side)"
}

/// The chip for any zone: Denmark as above, else "NO1 · Oslo" or the country's name.
func zoneChipLabel(zone: Zone, net: Net?) -> String {
    zone.isDanish ? netChipLabel(net: net, area: zone.key.uppercased()) : zone.chipLabel
}

// MARK: - prisopbygning

/// Delene en times pris er bygget af. Farven følger rollen; betydningen bæres altid af rækkens tekst.
enum BreakdownPart: Equatable { case spot, system, transmission, grid, duty, vat }

/// En række i opdelingen. `tenths` er øre/kWh × 10 (hele tal), så delene kan summe præcist.
struct BreakdownRow: Equatable, Identifiable {
    let part: BreakdownPart
    let label: String
    let tenths: Int
    var id: String { label }
    /// "85,3 øre", aldrig "-0,0 øre".
    var text: String { L10n.string("value_ore", tenthsText(tenths)) }
    /// Skærmlæserens linje: etiket og værdi.
    var spoken: String { "\(label), \(text)" }
}

struct PriceBreakdown: Equatable {
    let heading: String
    let rows: [BreakdownRow]
    /// Prisen × 100 afrundet til 0,1 øre. Rækkerne summer præcis hertil.
    let totalTenths: Int
    /// "2,06 kr/kWh" — samme tal som i hero og tip.
    let totalText: String
    /// Timen er valgt på grafen (så der vises "Tilbage til nu").
    let isSelected: Bool

    /// Søjlens bredder: de positive dele i forhold til deres sum (en negativ spotpris giver ikke et stykke). Tom sum → nuller.
    var barWeights: [Double] {
        let pos = rows.map { Double(Swift.max($0.tenths, 0)) }
        let sum = pos.reduce(0, +)
        return sum <= 0 ? rows.map { _ in 0 } : pos.map { $0 / sum }
    }
}

/// 853 → "85,3", -3 → "-0,3", 0 → "0,0".
func tenthsText(_ t: Int) -> String {
    let a = abs(t)
    let sym = L10n.numberSymbols
    return "\(t < 0 ? sym.minus : "")\(a / 10)\(sym.decimal)\(a % 10)"
}

/// kr → tiendedele øre, afrundet som Math.round (halve op), så alle tre platforme runder ens.
private func tenthsOf(_ kr: Double) -> Int {
    let v = (kr * 1000 + 0.5).rounded(.down)
    return v.isFinite && abs(v) < 1e12 ? Int(v) : 0
}

/// Prisen for én time delt op, ud fra den pris der vises (kr/kWh inkl. moms i den aktive visning) og samme svars `charges`.
///  - `net_inkl_alt`: spot, system, transmission, nettarif (timen), elafgift, moms
///  - `inkl_alt`: som ovenfor uden nettarif
///  - `spot_inkl`: spot og moms
/// Hver række afrundes til 0,1 øre, og Spotpris-rækken tager afrundingsforskellen, så rækkerne summer præcis til totalen.
/// nil når opdelingen ikke kan vises: `charges` mangler, timen har ingen pris, en net-visning mangler timens nettarif,
/// eller visningen er en anden. `headingWhen` er "" for denne time og ellers "i morgen" / "søn 18. okt".
func breakdownOf(
    mode: String, price: Double, hour: Int, forecastDay: Bool, charges: Charges?, gridTariff: Double?,
    netName: String?, headingWhen: String = ""
) -> PriceBreakdown? {
    guard let charges, price.isFinite, (0..<24).contains(hour) else { return nil }
    let net = mode == "net_inkl_alt"
    let sys: Int, trans: Int, afg: Int
    switch mode {
    case "net_inkl_alt", "inkl_alt": (sys, trans, afg) = (tenthsOf(charges.sys), tenthsOf(charges.trans), tenthsOf(charges.afg))
    case "spot_inkl": (sys, trans, afg) = (0, 0, 0)
    default: return nil
    }
    var grid = 0
    if net {
        guard let t = gridTariff, t.isFinite else { return nil }
        grid = tenthsOf(t)
    }
    let total = tenthsOf(price)
    // Moms = pris − pris/(1+sats), rundet for sig. Spotprisen er resten, så summen går op.
    let vat = tenthsOf(price - price / (1 + charges.vat))
    let spot = total - sys - trans - grid - afg - vat
    var rows = [BreakdownRow(part: .spot, label: L10n.string(forecastDay ? "part_spot_forecast" : "part_spot_actual"), tenths: spot)]
    if mode != "spot_inkl" {
        rows.append(BreakdownRow(part: .system, label: L10n.string("part_system"), tenths: sys))
        rows.append(BreakdownRow(part: .transmission, label: L10n.string("part_transmission"), tenths: trans))
        if net {
            let label = (netName ?? "").isEmpty ? L10n.string("part_grid", pad(hour)) : L10n.string("part_grid_named", netName!, pad(hour))
            rows.append(BreakdownRow(part: .grid, label: label, tenths: grid))
        }
        rows.append(BreakdownRow(part: .duty, label: L10n.string("part_duty"), tenths: afg))
    }
    rows.append(BreakdownRow(part: .vat, label: L10n.string("part_vat", Int((charges.vat * 100).rounded())), tenths: vat))
    return PriceBreakdown(
        heading: headingWhen.isEmpty ? L10n.string("breakdown_heading_now", pad(hour)) : L10n.string("breakdown_heading_when", headingWhen, pad(hour)),
        rows: rows, totalTenths: total, totalText: PriceUnit.kroner.withUnit(price), isSelected: !headingWhen.isEmpty)
}

/// Dagsordene i overskriften for en valgt søjle: tippets ord med småt ("i dag", "i morgen", "søn 18. okt").
func breakdownWhen(_ bar: PrisBar) -> String { bar.whenInline }

/// Opdelingen for den valgte søjle (`selected`: indeks i `spec.bars`), ellers for timen nu. nil når den ikke kan vises.
func priceBreakdown(
    mode: String, days: [Day], today: String, now: Int, spec: PrisChartSpec?, selected: Int?,
    charges: Charges?, netName: String?
) -> PriceBreakdown? {
    if let selected, let spec, spec.bars.indices.contains(selected) {
        let bar = spec.bars[selected]
        let tariff = days.first { $0.date == bar.date }?.gridTariff?[bar.hour]
        return breakdownOf(mode: mode, price: bar.value, hour: bar.hour, forecastDay: !bar.actual,
                           charges: charges, gridTariff: tariff, netName: netName, headingWhen: breakdownWhen(bar))
    }
    guard (0..<24).contains(now), let day = days.first(where: { $0.date == today }), day.price.indices.contains(now) else { return nil }
    return breakdownOf(mode: mode, price: day.price[now], hour: now, forecastDay: !day.actual,
                       charges: charges, gridTariff: day.gridTariff?[now], netName: netName)
}
