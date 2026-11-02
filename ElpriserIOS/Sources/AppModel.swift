import Foundation
import Observation

/// De to hovedpunkter: Pris og Smart hjem. Indstillinger åbnes fra netselskabsknappen på Pris.
enum AppTab: Hashable { case pris, smartHjem }

@MainActor
@Observable
final class AppModel {
    let settings: Settings
    private let finder = PositionFinder()

    var tab: AppTab = .pris
    /// Periode på Pris: 2 døgn eller 5 døgn.
    var period: PricePeriod = .two
    /// Stedsarket ("Hvor er du?"): åbner af sig selv ved første start og fra stedsknappen på Pris.
    var placeOpen = false
    /// Besked øverst i arket, når positionen ikke gav et netselskab.
    var placeNote: PlaceNote?
    /// Positionen slås op lige nu.
    private(set) var locating = false

    private(set) var loading = false
    private(set) var error: String?
    /// Hentede serier pr. visning (mode); uden for Danmark kun "zone".
    private(set) var series: [String: Forecast] = [:]
    private(set) var co2: [String: [Int]] = [:]
    private var loadedAt = Date.distantPast
    private var loadedKey = ""

    init(settings: Settings = Settings()) {
        self.settings = settings
        placeOpen = !settings.onboarded
        #if DEBUG
        // Kun til skærmbilleder: -debugTab 0|1 (0 = Pris, 1 = Smart hjem; "automation"/"smart" duer også),
        // -debugPeriod 2|5 (10 er et gammelt navn for 5 døgn) (periodevælgeren på Pris).
        // place|dk1|dk2|search|note|settings åbner stedsarket (på rod, et område, en søgning, med en note, på Indstillinger); søgeordet er -debugPlaceQuery.
        // -debugZone <key> (fx de, no2, se4) vælger en zone og lukker onboarding, som om brugeren havde valgt den.
        let d = UserDefaults.standard
        if let key = d.string(forKey: "debugZone"), let z = Zones.byKey(key) { settings.chooseZone(z); placeOpen = false }
        switch d.string(forKey: "debugTab") {
        case "1", "automation", "smart", "smarthjem": tab = .smartHjem
        case "place", "dk1", "dk2", "search", "settings", "countries", "norway": placeOpen = true
        case "note": placeOpen = true; placeNote = .noPosition
        default: break
        }
        if let p = PricePeriod(stored: d.string(forKey: "debugPeriod")) { period = p }
        #endif
        applyClock()
    }

    /// The zone on screen, and the clock that goes with it: "today" and "this hour" are the zone's own.
    var zone: Zone { settings.zone }

    private func applyClock() { Clock.zone = settings.zone.timeZone }

    /// Dage fra i dag og frem for en visning. Uden for Danmark kun de sammenhængende dage fra i dag (`Api.daysFrom`).
    func days(_ mode: String? = nil) -> [Day] {
        let today = Clock.today()
        let all = series[mode ?? settings.mode]?.days ?? []
        if !settings.isDanish { return Api.daysFrom(all, today: today) }
        return all.filter { $0.date >= today }
    }

    /// Afgifterne i svaret for en visning (nil i et ældre svar uden `charges`).
    func charges(_ mode: String? = nil) -> Charges? { series[mode ?? settings.mode]?.charges }

    var modelName: String? { series[settings.mode]?.model }

    /// Henter alt, appen skal bruge: den valgte visning plus de tre, prisopbygningen regnes af.
    func refresh(force: Bool = false) {
        Task { await load(force: force) }
    }

    func load(force: Bool = false) async {
        applyClock()
        let zone = settings.zone
        let key = "\(settings.mode)|\(zone.key)|\(settings.netGln ?? "-")"
        if !force && key == loadedKey && Date().timeIntervalSince(loadedAt) < 20 * 60 && !series.isEmpty { return }
        loadedKey = key
        loading = true
        error = nil
        do {
            if zone.isDanish {
                let area = settings.effectiveArea
                let gln = settings.netGln
                var modes = [settings.mode, "inkl_alt", "spot_inkl"]
                if gln != nil { modes.append("net_inkl_alt") }
                modes = Array(NSOrderedSet(array: modes)) as! [String]
                let results = try await withThrowingTaskGroup(of: (String, Forecast).self) { group -> [String: Forecast] in
                    for m in modes { group.addTask { (m, try await Api.forecast(area: area, mode: m, gln: gln)) } }
                    var out: [String: Forecast] = [:]
                    for try await (m, f) in group { out[m] = f }
                    return out
                }
                guard zone == settings.zone else { return }
                series = results
                if let c = try? await Api.co2(area: area) { co2 = c }
            } else {
                let f = try await Api.zone(zone)
                guard zone == settings.zone else { return }
                series = ["zone": f]
                co2 = [:]
            }
            loadedAt = Date()
        } catch {
            // A zone that answers 404 has no prices: nothing to show, nothing stale to fall back on.
            if (error as? ApiError) == .status(404) {
                series = [:]
                self.error = L10n.string("error_no_prices_today")
            } else {
                self.error = series.isEmpty ? L10n.string("error_load_failed") : L10n.string("error_load_stale")
            }
            loadedKey = ""
        }
        loading = false
    }

    // MARK: netselskab, zone og position

    func openPlace() { placeNote = nil; placeOpen = true }

    /// Lukker arket. Første gang tæller også som "spring over": så åbner det ikke af sig selv igen.
    func closePlace() {
        if !settings.onboarded { settings.skipOnboarding() }
        placeOpen = false
        placeNote = nil
    }

    func choose(_ net: Net, how: String) {
        let was = settings.zone
        settings.saveNet(net, how: how)
        changedZone(from: was)
    }

    /// "Uden netselskab" i et område: priser uden nettarif for DK1 eller DK2.
    func chooseWithoutNet(area: String) {
        let was = settings.zone
        settings.chooseDanishArea(area)
        changedZone(from: was)
    }

    /// A zone outside Denmark (or a Danish one without a grid company).
    func chooseZone(_ zone: Zone) {
        let was = settings.zone
        settings.chooseZone(zone)
        changedZone(from: was)
    }

    private func changedZone(from was: Zone) {
        applyClock()
        // Moving between Denmark and the rest, or between two zones outside Denmark: the old series must not show under the new
        // zone's clock and chip while the answer is on its way. Inside Denmark the Danish screens keep what they had.
        if !(was.isDanish && settings.zone.isDanish) {
            series = [:]
            co2 = [:]
        }
        placeOpen = false
        placeNote = nil
        refresh(force: true)
    }

    func forget() {
        settings.forgetNet()
        refresh(force: true)
    }

    /// Spørger om tilladelse (kun nu, hvor brugeren har trykket), finder positionen én gang og slår netselskabet op.
    /// Koordinaterne bruges kun til opslaget. Et fund vælges straks; ellers bliver arket stående med en note.
    func detect() {
        guard !locating else { return }
        locating = true
        placeNote = nil
        Task {
            defer { locating = false }
            guard let loc = await finder.current() else { placeNote = finder.wasDenied ? .denied : .noPosition; return }
            do {
                let r = try await Api.lookup(lat: loc.coordinate.latitude, lng: loc.coordinate.longitude)
                if let net = Nets.match(r.name) { choose(net, how: "gps") }
                else if r.error == "outside_denmark" { placeNote = .outside }
                else { placeNote = .noNet }
            } catch {
                placeNote = .failed
            }
        }
    }
}
