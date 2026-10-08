import SwiftUI

extension Color {
    init(light: UInt, dark: UInt) {
        self.init(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }
    init(hex: UInt) { self.init(UIColor(hex: hex)) }
}

extension UIColor {
    convenience init(hex: UInt, alpha: CGFloat = 1) {
        self.init(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
    }
}

/// Samme farver som i Android-appen og designet.
enum T {
    static let bg = Color(light: 0xf4f7fc, dark: 0x0b1220)
    static let surface = Color(light: 0xffffff, dark: 0x131b29)
    static let surface2 = Color(light: 0xeaf0fa, dark: 0x1b2535)
    static let outline = Color(light: 0xdbe3f0, dark: 0x26324a)
    static let text = Color(light: 0x0e1421, dark: 0xe8edf5)
    static let text2 = Color(light: 0x4d596b, dark: 0xa9b5c9)
    static let brand = Color(light: 0x1747d6, dark: 0x7ea2ff)
    static let brandSoft = Color(light: 0xe2eaff, dark: 0x1c2b55)
    static let brandSolid = Color(light: 0x1b57f5, dark: 0x5b8bff)
    static let good = Color(light: 0x157a3c, dark: 0x4cd964)
    static let goodSoft = Color(light: 0xddf4e4, dark: 0x133222)
    static let mid = Color(light: 0x8a5a00, dark: 0xffd24a)
    static let midSoft = Color(light: 0xfff1d1, dark: 0x3a3112)
    static let bad = Color(light: 0xb4231b, dark: 0xff7a70)
    static let badSoft = Color(light: 0xfde3e0, dark: 0x3d1d1b)
    static let co2 = Color(light: 0x0b756a, dark: 0x2fd4bf)
    static let co2Soft = Color(light: 0xd9f2ee, dark: 0x10332f)
    static let nav = Color(light: 0xe9eef8, dark: 0x161f30)
}

/// Samme farveskala som elpriser.org: grøn (billig) → lime → gul → orange → rød (dyr).
func ramp(_ t0: Double) -> Color {
    let stops: [(Double, (Double, Double, Double))] = [
        (0, (52, 199, 89)), (0.35, (168, 216, 74)), (0.6, (255, 204, 0)), (0.85, (255, 149, 0)), (1, (255, 59, 48)),
    ]
    let t = min(1, max(0, t0))
    for i in 1..<stops.count where t <= stops[i].0 {
        let (p0, c0) = stops[i - 1], (p1, c1) = stops[i]
        let k = (t - p0) / (p1 - p0)
        return Color(red: (c0.0 + (c1.0 - c0.0) * k) / 255, green: (c0.1 + (c1.1 - c0.1) * k) / 255, blue: (c0.2 + (c1.2 - c0.2) * k) / 255)
    }
    return Color(red: 1, green: 59 / 255, blue: 48 / 255)
}

func tOf(_ v: Double, _ vals: [Double]) -> Double {
    guard let lo = vals.min(), let hi = vals.max(), hi != lo else { return 0 }
    return (v - lo) / (hi - lo)
}

/// Dansk talformat: komma som decimaltegn og aldrig "-0,00".
func fmt(_ v: Double?, _ d: Int = 2) -> String {
    guard let v, !v.isNaN else { return "–" }
    var s = String(format: "%.\(d)f", v)
    if s.range(of: "^-0\\.?0*$", options: .regularExpression) != nil { s.removeFirst() }
    return s.replacingOccurrences(of: ".", with: ",")
}

func pad(_ h: Int) -> String { String(format: "%02d", h) }
func hh(_ h: Int) -> String { "\(pad(h))–\(pad((h + 1) % 24))" }

struct Win {
    let s: Int, e: Int, avg: Double
    var label: String { "\(pad(s))–\(pad(e % 24))" }
}

func cheapestWindow(_ vals: [Double], _ n: Int, highest: Bool = false) -> Win {
    var best: Win?
    for s in 0...(vals.count - n) {
        let a = vals[s..<s + n].reduce(0, +) / Double(n)
        if best == nil || (highest ? a > best!.avg : a < best!.avg) { best = Win(s: s, e: s + n, avg: a) }
    }
    return best!
}

/// 0 billig, 1 middel, 2 dyr — efter hvor mange af døgnets timer der er billigere.
struct Verdict { let kind: Int; let label: String }

func verdict(_ price: Double, _ vals: [Double]) -> Verdict {
    let pct = Int((Double(vals.filter { $0 < price }.count) / Double(vals.count) * 100).rounded())
    if pct <= 33 { return Verdict(kind: 0, label: "Billig lige nu") }
    if pct <= 66 { return Verdict(kind: 1, label: "Middel lige nu") }
    return Verdict(kind: 2, label: "Dyr lige nu")
}

private let weekdays = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"]
private let weekdaysShort = ["søn", "man", "tir", "ons", "tor", "fre", "lør"]
private let months = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]

private func parts(_ d: Day) -> (wd: Int, day: Int, month: Int) {
    let c = Clock.calendar.dateComponents([.weekday, .day, .month], from: d.localDate)
    return ((c.weekday ?? 1) - 1, c.day ?? 1, (c.month ?? 1) - 1)
}

func cap(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }

func dayLabel(_ d: Day) -> String {
    let today = Clock.today()
    if d.date == today { return "I dag" }
    let tomorrow = Clock.format(Clock.calendar.date(byAdding: .day, value: 1, to: Clock.parse(today))!)
    if d.date == tomorrow { return "I morgen" }
    return cap(weekdays[parts(d).wd])
}
func dayShort(_ d: Day) -> String { weekdaysShort[parts(d).wd] }
func dayNum(_ d: Day) -> Int { parts(d).day }
func dayMonth(_ d: Day) -> String { let p = parts(d); return "\(p.day). \(months[p.month])" }
func dayLong(_ d: Day) -> String { let p = parts(d); return "\(cap(weekdays[p.wd])) \(p.day). \(months[p.month])" }
func todayLong() -> String {
    let d = Day(date: Clock.today(), actual: true, price: [], lo: nil, hi: nil)
    return dayLong(d)
}
