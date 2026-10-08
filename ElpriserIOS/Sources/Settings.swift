import Foundation
import Observation

struct Device: Identifiable, Equatable {
    let key: String
    let name: String
    let kw: Double
    var hours: Int
    var on: Bool
    var id: String { key }
}

/// Brugerens indstillinger, gemt på enheden. Netselskabet gemmes som svar (GLN) —
/// koordinater og adresse gemmes aldrig.
@Observable
final class Settings {
    private let d = UserDefaults.standard

    private(set) var netGln: String?
    private(set) var netHow: String
    private(set) var area: String
    private(set) var onboarded: Bool
    /// 0 samlet med netselskab, 1 uden netselskab, 2 spot inkl. moms, 3 spot ekskl. moms
    private(set) var view: Int
    /// system | light | dark
    private(set) var theme: String
    private(set) var devices: [Device]

    init() {
        netGln = d.string(forKey: "netGln")
        netHow = d.string(forKey: "netHow") ?? "manual"
        area = d.string(forKey: "area") ?? "DK1"
        onboarded = d.bool(forKey: "onboarded")
        view = d.object(forKey: "view") as? Int ?? 0
        theme = d.string(forKey: "theme") ?? "system"
        devices = Settings.loadDevices(d)
    }

    var net: Net? { Nets.byGln(netGln) }
    var effectiveArea: String { net?.area ?? area }

    /// Visningen falder tilbage til "uden netselskab", når der ikke er et netselskab.
    var mode: String {
        switch view {
        case 0: return net != nil ? "net_inkl_alt" : "inkl_alt"
        case 1: return "inkl_alt"
        case 2: return "spot_inkl"
        default: return "spot_ex"
        }
    }

    func saveNet(_ n: Net, how: String) {
        netGln = n.gln; netHow = how; onboarded = true
        d.set(n.gln, forKey: "netGln"); d.set(how, forKey: "netHow"); d.set(true, forKey: "onboarded")
    }

    func forgetNet() {
        netGln = nil
        d.removeObject(forKey: "netGln")
    }

    func skipOnboarding() { onboarded = true; d.set(true, forKey: "onboarded") }
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
            Device(key: "heatpump", name: "Varmepumpe", kw: 1.8, hours: 10, on: true),
            Device(key: "car", name: "Elbil", kw: 7.4, hours: 5, on: true),
            Device(key: "water", name: "Vandvarmer", kw: 2.0, hours: 3, on: false),
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
