import Foundation

// Ren logik til Pris-skærmen (Design A): niveau, akse, sætningen under prisen, statistikfelter og
// søjlerne. Intet her rører ved visning, netværk eller tid — "nu" og "i dag" gives udefra, så alt kan testes.

/// Periode-vælgeren: de næste 2 døgn eller døgn 3–10 (prognosen).
enum PricePeriod: Int {
    case two = 2, long = 10

    /// Døgn regnet fra i dag (0 = i dag), som perioden dækker.
    var offsets: ClosedRange<Int> { self == .two ? 0...1 : 2...9 }
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
    case .low: "Billig lige nu"
    case .mid: "Middel lige nu"
    case .high: "Dyr lige nu"
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
    /// Døgn regnet fra i dag (0 = i dag).
    let dayOffset: Int
    let hour: Int
    /// Timen er allerede gået (kun i dag, kun i 2-døgnsvisningen).
    let past: Bool
    let actual: Bool
    /// Teksten i værktøjstippet: "I dag kl. 19 · 3,90 kr/kWh".
    let tip: String
}

struct AxisLabel: Equatable {
    /// Position i søjleenheder fra venstre kant (0 = første søjles venstrekant).
    let at: Double
    let text: String
}

struct PrisChartSpec: Equatable {
    let period: PricePeriod
    let bars: [PrisBar]
    let axis: PriceAxis
    /// Ét navn pr. døgn i vinduet: "I dag", "I morgen" eller "lør 16".
    let dayNames: [String]
    let nowIndex: Int?
    /// Første søjle, der er prognose — nil når alt i vinduet er offentliggjort.
    let forecastFrom: Int?

    var title: String { period == .two ? "Næste 2 døgn" : "Døgn 3–10" }
    var days: Int { dayNames.count }

    /// 2 døgn: "I dag 00", så hver `step`. time, og "I morgen 00". 3–10 døgn: ét navn pr. døgn midt under dets søjler.
    func xLabels(step: Int) -> [AxisLabel] {
        if period == .long {
            return dayNames.indices.map { AxisLabel(at: Double($0 * 24 + 12), text: dayNames[$0]) }
        }
        return stride(from: 0, to: bars.count, by: Swift.max(step, 1)).map { i in
            let b = bars[i]
            return AxisLabel(at: Double(i), text: b.hour == 0 ? "\(dayNames[Swift.min(b.dayOffset, dayNames.count - 1)]) 00" : pad(b.hour))
        }
    }

    /// Kort tekst til skærmlæsere.
    var summary: String {
        guard let lo = bars.min(by: { $0.value < $1.value }), let hi = bars.max(by: { $0.value < $1.value }) else { return title }
        return "\(title). Billigst \(fmt(lo.value)) kr/kWh, dyrest \(fmt(hi.value)) kr/kWh. Træk fingeren hen over grafen for at høre prisen time for time."
    }
}

/// Døgnene, en periode dækker, fundet på dato (ikke på plads), så et hul i data ikke flytter timerne.
func daysIn(_ period: PricePeriod, days: [Day], today: String) -> [(offset: Int, day: Day)] {
    let base = Clock.parse(today)
    return days.compactMap { d in
        guard let n = Clock.calendar.dateComponents([.day], from: base, to: d.localDate).day,
              period.offsets.contains(n) else { return nil }
        return (n, d)
    }
    .sorted { $0.offset < $1.offset }
}

/// Søjlerne for en periode. nil når perioden ingen døgn har.
func prisChart(period: PricePeriod, days: [Day], today: String, now: Int) -> PrisChartSpec? {
    let window = daysIn(period, days: days, today: today)
    guard !window.isEmpty else { return nil }
    let all = window.flatMap { $0.day.price }
    guard !all.isEmpty else { return nil }

    var bars: [PrisBar] = []
    var forecastFrom: Int?
    for (k, item) in window.enumerated() {
        let d = item.day
        for (h, v) in d.price.enumerated() {
            let when = period == .two
                ? "\(dayLabel(d))"
                : "\(dayShort(d)) \(dayMonth(d))"
            if !d.actual && forecastFrom == nil { forecastFrom = bars.count }
            bars.append(PrisBar(
                value: v, tier: priceTier(v, in: all), dayOffset: k, hour: h,
                past: period == .two && item.offset == 0 && h < now, actual: d.actual,
                tip: "\(when) kl. \(pad(h)) · \(fmt(v)) kr/kWh"))
        }
    }
    let names = window.map { period == .two ? dayLabel($0.day) : "\(dayShort($0.day)) \(dayNum($0.day))" }
    let nowIdx = period == .two ? window.firstIndex { $0.offset == 0 }.map { $0 * 24 + now } : nil
    return PrisChartSpec(
        period: period, bars: bars,
        axis: priceAxis(lo: Swift.min(all.min() ?? 0, 0), hi: all.max() ?? 0),
        dayNames: names,
        nowIndex: nowIdx.flatMap { (0..<bars.count).contains($0) ? $0 : nil },
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
func heroSentence(prices: [Double], now: Int) -> (text: String, emphasis: String?) {
    guard now >= 0, now < prices.count else { return ("", nil) }
    let end = Swift.min(now + 24, prices.count)
    var best = now
    for i in now..<end where prices[i] < prices[best] { best = i }
    guard best != now, prices[best] < prices[now] else { return ("Billigste time de næste 24 timer", nil) }
    let amount = "\(fmt(prices[best])) kr"
    return ("Billigere \(best < 24 ? "i dag" : "i morgen") kl. \(pad(best % 24)) — \(amount)", amount)
}

/// "Billigst i morgen" / "Dyrest i aften" for den time blandt de kommende, der holder ekstremet.
func prisExtremes(prices: [Double], now: Int) -> (cheapest: PrisExtreme, dearest: PrisExtreme)? {
    guard now >= 0, now < prices.count else { return nil }
    var lo = now, hi = now
    for i in now..<prices.count {
        if prices[i] < prices[lo] { lo = i }
        if prices[i] > prices[hi] { hi = i }
    }
    let loWhen = lo < 24 ? "i dag" : "i morgen"
    let hiWhen = hi >= 24 ? "i morgen" : (hi % 24 >= 17 ? "i aften" : "i dag")
    return (PrisExtreme(label: "Billigst \(loWhen)", price: prices[lo], hour: lo % 24),
            PrisExtreme(label: "Dyrest \(hiWhen)", price: prices[hi], hour: hi % 24))
}

/// Alt hero og felter skal bruge. nil når i dag mangler (så viser skærmen indlæsning eller fejl).
func prisSummary(days: [Day], today: String, now: Int) -> PrisSummary? {
    let window = daysIn(.two, days: days, today: today)
    guard let first = window.first, first.offset == 0, now >= 0, now < first.day.price.count else { return nil }
    // Dagen i dag og i morgen hænger sammen; et manglende i morgen giver bare et kortere vindue.
    let prices = first.day.price + (window.count > 1 && window[1].offset == 1 ? window[1].day.price : [])
    guard let ext = prisExtremes(prices: prices, now: now) else { return nil }
    let s = heroSentence(prices: prices, now: now)
    return PrisSummary(
        hour: now, price: prices[now], tier: priceTier(prices[now], in: prices),
        sentence: s.text, emphasis: s.emphasis, cheapest: ext.cheapest, dearest: ext.dearest)
}

// MARK: - tekster

func priceCaption(spot: Bool, hasNet: Bool) -> String {
    if spot { return "Spotpris inkl. moms" }
    return hasNet ? "Inkl. nettarif, afgifter og moms" : "Inkl. Energinets tariffer, afgifter og moms"
}

/// Netselskabsknappen: "N1 · Vest", eller "DK1 · Vest" uden netselskab.
func netChipLabel(net: Net?, area: String) -> String {
    let side = (net?.area ?? area) == "DK1" ? "Vest" : "Øst"
    return "\(net?.name ?? (net?.area ?? area)) · \(side)"
}
