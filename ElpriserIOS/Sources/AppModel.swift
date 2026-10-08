import Foundation
import Observation

enum AppTab: Hashable { case nu, prognose, automation, settings }

/// Første-start- og netselskabsflowet, der ligger oven på appen.
enum Step: Equatable {
    case welcome
    case searching
    case found(Net)
    case picker(String?)
}

@MainActor
@Observable
final class AppModel {
    let settings = Settings()
    private let finder = PositionFinder()

    var tab: AppTab = .nu
    /// Valgt døgn (0 = i dag) i Prognose og Time for time.
    var selDay = 0
    var step: Step?

    private(set) var loading = false
    private(set) var error: String?
    /// Hentede serier pr. visning (mode).
    private(set) var series: [String: Forecast] = [:]
    private(set) var co2: [String: [Int]] = [:]
    private var loadedAt = Date.distantPast
    private var loadedKey = ""

    init() {
        step = settings.onboarded ? nil : .welcome
        #if DEBUG
        // Kun til skærmbilleder: -debugTab nu|prognose|automation|settings
        switch UserDefaults.standard.string(forKey: "debugTab") {
        case "prognose": tab = .prognose
        case "automation": tab = .automation
        case "settings": tab = .settings
        default: break
        }
        #endif
    }

    /// Dage fra i dag og frem for en visning.
    func days(_ mode: String? = nil) -> [Day] {
        let today = Clock.today()
        return (series[mode ?? settings.mode]?.days ?? []).filter { $0.date >= today }
    }

    var modelName: String? { series[settings.mode]?.model }

    /// Henter alt, appen skal bruge: den valgte visning plus de tre, prisopbygningen regnes af.
    func refresh(force: Bool = false) {
        Task { await load(force: force) }
    }

    func load(force: Bool = false) async {
        let key = "\(settings.mode)|\(settings.effectiveArea)|\(settings.netGln ?? "-")"
        if !force && key == loadedKey && Date().timeIntervalSince(loadedAt) < 20 * 60 && !series.isEmpty { return }
        loadedKey = key
        let area = settings.effectiveArea
        let gln = settings.netGln
        var modes = [settings.mode, "inkl_alt", "spot_inkl"]
        if gln != nil { modes.append("net_inkl_alt") }
        modes = Array(NSOrderedSet(array: modes)) as! [String]
        loading = true
        error = nil
        do {
            let results = try await withThrowingTaskGroup(of: (String, Forecast).self) { group -> [String: Forecast] in
                for m in modes { group.addTask { (m, try await Api.forecast(area: area, mode: m, gln: gln)) } }
                var out: [String: Forecast] = [:]
                for try await (m, f) in group { out[m] = f }
                return out
            }
            series = results
            if let c = try? await Api.co2(area: area) { co2 = c }
            loadedAt = Date()
        } catch {
            self.error = series.isEmpty
                ? "Vi kunne ikke hente priserne. Tjek din forbindelse og prøv igen."
                : "Viser de seneste priser — kunne ikke opdatere."
            loadedKey = ""
        }
        loading = false
    }

    // MARK: netselskab og position

    func openWelcome() { step = .welcome }
    func openPicker(_ note: String? = nil) { step = .picker(note) }
    func closeStep() { step = nil }

    func skip() {
        settings.skipOnboarding()
        step = nil
    }

    func choose(_ net: Net, how: String) {
        settings.saveNet(net, how: how)
        step = nil
        refresh(force: true)
    }

    func forget() {
        settings.forgetNet()
        refresh(force: true)
    }

    /// Spørger om tilladelse (kun nu, hvor brugeren har trykket), finder positionen én gang og slår netselskabet op.
    /// Koordinaterne bruges kun til opslaget.
    func detect() {
        step = .searching
        Task {
            guard let loc = await finder.current() else {
                step = .picker("Vi kunne ikke finde din position. Vælg dit netselskab på listen i stedet.")
                return
            }
            do {
                let r = try await Api.lookup(lat: loc.coordinate.latitude, lng: loc.coordinate.longitude)
                if let net = Nets.match(r.name) {
                    step = .found(net)
                } else if r.error == "outside_denmark" {
                    step = .picker("Din position ligger uden for Danmark. Vælg dit netselskab på listen.")
                } else {
                    step = .picker("Vi kunne ikke finde netselskabet for din position. Vælg det på listen — det står på din elregning.")
                }
            } catch {
                step = .picker("Opslaget lykkedes ikke. Vælg dit netselskab på listen, eller prøv igen senere.")
            }
        }
    }
}
