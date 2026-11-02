import Foundation
import Observation

struct Device: Identifiable, Equatable {
    let key: String
    let kw: Double
    var hours: Int
    var on: Bool
    var id: String { key }

    /// The name in the app's language (device_heatpump, device_car, device_water).
    var name: String { L10n.string("device_\(key)") }
}

/// Which zone the app shows. A pure decision, so every case can be tested:
///  1. a zone the user has chosen (stored) wins;
///  2. an install from before zones existed (onboarded, no zone stored) maps its grid company's area, else its stored area,
///     to dk1/dk2 — such a user must see no change;
///  3. a fresh install gets the zone of the device's region, else of its language, else Germany (`Zones.defaultFor`).
func resolveZone(stored: String?, onboarded: Bool, area: String, netArea: String?, region: String?, language: String?) -> Zone {
    if let z = Zones.byKey(stored) {
        // A grid company is always in the area it belongs to, whatever dk1/dk2 was stored.
        if z.isDanish, let na = Zones.byKey(netArea), na.isDanish { return na }
        return z
    }
    if onboarded { return Zones.byKey((netArea ?? area).lowercased()).flatMap { $0.isDanish ? $0 : nil } ?? Zones.byKey("dk1")! }
    return Zones.defaultFor(region: region, language: language)
}

/// Brugerens indstillinger, gemt på enheden. Netselskabet gemmes som svar (GLN) —
/// koordinater og adresse gemmes aldrig.
@Observable
final class Settings {
    private let d: UserDefaults
    private let locale: Locale

    private(set) var netGln: String?
    private(set) var netHow: String
    private(set) var area: String
    private(set) var onboarded: Bool
    /// The zone key the user has chosen ("de", "no2", "dk1"); nil until the first choice or skip.
    private(set) var storedZone: String?
    /// 0 samlet med netselskab, 1 uden netselskab, 2 spot inkl. moms, 3 spot ekskl. moms
    private(set) var view: Int
    /// system | light | dark
    private(set) var theme: String
    private(set) var devices: [Device]

    /// `defaults` and `locale` are parameters so tests can run on an empty store with a chosen device locale.
    init(defaults: UserDefaults = .standard, locale: Locale = .current) {
        d = defaults
        self.locale = locale
        netGln = d.string(forKey: "netGln")
        netHow = d.string(forKey: "netHow") ?? "manual"
        area = d.string(forKey: "area") ?? "DK1"
        onboarded = d.bool(forKey: "onboarded")
        storedZone = Zones.byKey(d.string(forKey: "zone"))?.key
        view = d.object(forKey: "view") as? Int ?? 0
        theme = d.string(forKey: "theme") ?? "system"
        devices = Settings.loadDevices(d)
    }

    var net: Net? { Nets.byGln(netGln) }

    /// The zone on screen. A saved grid company decides the Danish area; see `resolveZone` for the rest.
    var zone: Zone {
        resolveZone(stored: storedZone, onboarded: onboarded, area: area, netArea: net?.area,
                    region: locale.region?.identifier, language: locale.language.languageCode?.identifier)
    }

    var isDanish: Bool { zone.isDanish }

    /// "DK1" / "DK2" in Denmark; the zone key in capitals elsewhere ("NO1", "DE", "IT-N").
    var effectiveArea: String { zone.key.uppercased() }

    /// Visningen falder tilbage til "uden netselskab", når der ikke er et netselskab.
    /// Outside Denmark there is one series, the day-ahead price of the zone ("zone"); `view` is ignored.
    var mode: String {
        guard isDanish else { return "zone" }
        switch view {
        case 0: return net != nil ? "net_inkl_alt" : "inkl_alt"
        case 1: return "inkl_alt"
        case 2: return "spot_inkl"
        default: return "spot_ex"
        }
    }

    /// Visningen på Pris-skærmen: kun "Din pris" (samlet pris med netselskab, ellers uden) eller spotpris inkl. moms.
    /// De to andre visninger kan stadig gemmes (fra Indstillinger), men vises ikke under "Din pris".
    var prisIsSpot: Bool { isDanish && view == 2 }
    var prisMode: String { !isDanish ? "zone" : (prisIsSpot ? "spot_inkl" : (net != nil ? "net_inkl_alt" : "inkl_alt")) }

    /// A grid company: Denmark, and the zone follows its area.
    func saveNet(_ n: Net, how: String) {
        netGln = n.gln; netHow = how; onboarded = true
        area = n.area; storedZone = n.area.lowercased()
        d.set(n.gln, forKey: "netGln"); d.set(how, forKey: "netHow"); d.set(true, forKey: "onboarded")
        d.set(n.area, forKey: "area"); d.set(storedZone, forKey: "zone")
    }

    func forgetNet() {
        netGln = nil
        d.removeObject(forKey: "netGln")
    }

    /// Denmark without a grid company: the area is the zone.
    func chooseDanishArea(_ a: String) {
        forgetNet()
        updateArea(a)
        storedZone = a.lowercased()
        d.set(storedZone, forKey: "zone")
        skipOnboarding()
    }

    /// A zone outside Denmark: the grid company is forgotten (there is none), the price view no longer applies.
    func chooseZone(_ z: Zone) {
        if z.isDanish { chooseDanishArea(z.key.uppercased()); return }
        forgetNet()
        storedZone = z.key
        d.set(z.key, forKey: "zone")
        skipOnboarding()
    }

    /// First launch closed without a choice: the zone the device gave stays, and is stored now so it no longer depends on the locale.
    func skipOnboarding() {
        if storedZone == nil { storedZone = zone.key; d.set(storedZone, forKey: "zone") }
        onboarded = true; d.set(true, forKey: "onboarded")
    }
    func updateArea(_ a: String) { area = a; d.set(a, forKey: "area") }
    func updateView(_ v: Int) { view = v; d.set(v, forKey: "view") }
    func updateTheme(_ t: String) { theme = t; d.set(t, forKey: "theme") }

    func updateDevices(_ list: [Device]) {
        devices = list
        let arr = list.map { ["key": $0.key, "hours": $0.hours, "on": $0.on] as [String: Any] }
        if let data = try? JSONSerialization.data(withJSONObject: arr) { d.set(data, forKey: "devices") }
    }

    private static func loadDevices(_ d: UserDefaults) -> [Device] {
        var base = [
            Device(key: "heatpump", kw: 1.8, hours: 10, on: true),
            Device(key: "car", kw: 7.4, hours: 5, on: true),
            Device(key: "water", kw: 2.0, hours: 3, on: false),
        ]
        guard let data = d.data(forKey: "devices"),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return base }
        for i in base.indices {
            if let o = arr.first(where: { $0["key"] as? String == base[i].key }) {
                base[i].hours = min(12, max(1, o["hours"] as? Int ?? base[i].hours))
                base[i].on = o["on"] as? Bool ?? base[i].on
            }
        }
        return base
    }
}
