import XCTest
@testable import Elpriser

/// Which zone the app is on: the pure decision (`resolveZone`) and the settings that carry it. Every test runs on a throw-away
/// store and a chosen device locale, so none depends on the simulator or on what an earlier run left behind.
final class ZoneSettingsTests: DanishTestCase {
    private let n1 = "5790001089030"        // N1, DK1
    private let radius = "5790000705689"    // Radius, DK2

    // MARK: resolveZone

    private func resolve(stored: String? = nil, onboarded: Bool = false, area: String = "DK1", netArea: String? = nil,
                         region: String? = nil, language: String? = nil) -> String {
        resolveZone(stored: stored, onboarded: onboarded, area: area, netArea: netArea, region: region, language: language).key
    }

    func testAChosenZoneWins() {
        XCTAssertEqual(resolve(stored: "no3", onboarded: true, area: "DK2", region: "DK", language: "da"), "no3")
        XCTAssertEqual(resolve(stored: "de", region: "DK"), "de")
        XCTAssertEqual(resolve(stored: "DE"), "de", "keys in any case")
    }

    func testAnInstallFromBeforeZonesMapsItsAreaSoNothingChanges() {
        XCTAssertEqual(resolve(onboarded: true, area: "DK1"), "dk1")
        XCTAssertEqual(resolve(onboarded: true, area: "DK2"), "dk2")
        XCTAssertEqual(resolve(onboarded: true, area: "DK1", netArea: "DK2"), "dk2", "the grid company decides the area")
        // whatever the phone's locale says: this user has been on the Danish areas all along
        XCTAssertEqual(resolve(onboarded: true, area: "DK2", region: "DE", language: "de"), "dk2")
        XCTAssertEqual(resolve(onboarded: true, area: "garbage"), "dk1")
    }

    func testAFreshInstallGetsTheZoneOfTheDevice() {
        XCTAssertEqual(resolve(region: "DK", language: "da"), "dk1")
        XCTAssertEqual(resolve(region: "DE", language: "de"), "de")
        XCTAssertEqual(resolve(region: "NO", language: "nb"), "no1")
        XCTAssertEqual(resolve(region: "SE", language: "sv"), "se3")
        XCTAssertEqual(resolve(region: "GB", language: "en"), "de")
        XCTAssertEqual(resolve(region: nil, language: nil), "de")
    }

    func testADanishZoneFollowsItsGridCompanyEvenIfTheOtherAreaWasStored() {
        XCTAssertEqual(resolve(stored: "dk1", netArea: "DK2"), "dk2")
        XCTAssertEqual(resolve(stored: "dk2", netArea: nil), "dk2")
    }

    // MARK: Settings

    func testAFreshGermanInstallShowsGermanyWithoutStoringAnything() {
        let defaults = UserDefaults(suiteName: "elpriser-test-fresh-de")!
        defaults.removePersistentDomain(forName: "elpriser-test-fresh-de")
        let s = Settings(defaults: defaults, locale: Locale(identifier: "de_DE"))
        XCTAssertEqual(s.zone.key, "de")
        XCTAssertFalse(s.onboarded)
        XCTAssertFalse(s.isDanish)
        XCTAssertEqual(s.mode, "zone")
        XCTAssertEqual(s.prisMode, "zone")
        XCTAssertEqual(s.effectiveArea, "DE")
        XCTAssertNil(defaults.object(forKey: "zone"), "the default is not persisted until the user chooses or skips")
        XCTAssertNil(defaults.object(forKey: "onboarded"))
        // skipping stores the zone the device gave, so a later change of region does not move the user
        s.skipOnboarding()
        XCTAssertEqual(defaults.string(forKey: "zone"), "de")
        XCTAssertTrue(defaults.bool(forKey: "onboarded"))
        let again = Settings(defaults: defaults, locale: Locale(identifier: "da_DK"))
        XCTAssertEqual(again.zone.key, "de")
    }

    func testAFreshDanishInstallIsOnDK1AsBefore() {
        let s = makeSettings(locale: "da_DK")
        XCTAssertEqual(s.zone.key, "dk1")
        XCTAssertTrue(s.isDanish)
        XCTAssertEqual(s.mode, "inkl_alt")
        XCTAssertEqual(s.effectiveArea, "DK1")
        s.skipOnboarding()
        XCTAssertEqual(s.storedZone, "dk1")
        XCTAssertEqual(s.mode, "inkl_alt")
    }

    func testAnUpgradingUserSeesNoChange() {
        // stored before zones existed: onboarded, a grid company in DK2, an old area of DK1, the spot view
        let s = makeSettings(locale: "de_DE") { d in
            d.set(true, forKey: "onboarded"); d.set(self.radius, forKey: "netGln"); d.set("DK1", forKey: "area"); d.set(2, forKey: "view")
        }
        XCTAssertEqual(s.zone.key, "dk2")
        XCTAssertEqual(s.effectiveArea, "DK2")
        XCTAssertEqual(s.net?.name, "Radius")
        XCTAssertEqual(s.mode, "spot_inkl")
        XCTAssertTrue(s.prisIsSpot)
        XCTAssertNil(s.storedZone)

        let noNet = makeSettings(locale: "en_US") { d in d.set(true, forKey: "onboarded"); d.set("DK2", forKey: "area") }
        XCTAssertEqual(noNet.zone.key, "dk2")
        XCTAssertEqual(noNet.mode, "inkl_alt")
        let withNet = makeSettings(locale: "en_US") { d in d.set(true, forKey: "onboarded"); d.set(self.n1, forKey: "netGln") }
        XCTAssertEqual(withNet.zone.key, "dk1")
        XCTAssertEqual(withNet.mode, "net_inkl_alt")
    }

    func testChoosingAZoneOutsideDenmarkForgetsTheNetAndIgnoresTheView() {
        let s = makeSettings(locale: "da_DK") { d in d.set(true, forKey: "onboarded"); d.set(self.n1, forKey: "netGln"); d.set(2, forKey: "view") }
        XCTAssertEqual(s.mode, "spot_inkl")
        s.chooseZone(Zones.byKey("no2")!)
        XCTAssertNil(s.net)
        XCTAssertEqual(s.zone.key, "no2")
        XCTAssertEqual(s.mode, "zone")
        XCTAssertEqual(s.prisMode, "zone")
        XCTAssertFalse(s.prisIsSpot, "there is no spot/total choice outside Denmark")
        s.updateView(0)
        XCTAssertEqual(s.mode, "zone")
        XCTAssertEqual(s.effectiveArea, "NO2")
        XCTAssertTrue(s.onboarded)
    }

    func testBackToDenmarkComesBackToTheDanishModes() {
        let s = makeSettings(locale: "de_DE")
        s.chooseZone(Zones.byKey("fi")!)
        XCTAssertEqual(s.mode, "zone")
        s.chooseDanishArea("DK2")
        XCTAssertEqual(s.zone.key, "dk2")
        XCTAssertEqual(s.area, "DK2")
        XCTAssertEqual(s.mode, "inkl_alt")
        s.saveNet(Nets.byGln(n1)!, how: "manual")
        XCTAssertEqual(s.zone.key, "dk1", "a grid company puts the zone in its own area")
        XCTAssertEqual(s.area, "DK1")
        XCTAssertEqual(s.mode, "net_inkl_alt")
        s.forgetNet()
        XCTAssertEqual(s.zone.key, "dk1")
        XCTAssertEqual(s.mode, "inkl_alt")
    }

    func testChoosingADanishZoneThroughChooseZoneIsTheDanishArea() {
        let s = makeSettings(locale: "fr_FR")
        s.chooseZone(Zones.byKey("dk2")!)
        XCTAssertEqual(s.zone.key, "dk2")
        XCTAssertEqual(s.area, "DK2")
        XCTAssertNil(s.net)
    }

    func testTheChoiceIsRememberedByANewSettingsObject() {
        let name = "elpriser-test-remember"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        Settings(defaults: defaults, locale: Locale(identifier: "de_DE")).chooseZone(Zones.byKey("se4")!)
        let later = Settings(defaults: defaults, locale: Locale(identifier: "de_DE"))
        XCTAssertEqual(later.zone.key, "se4")
        XCTAssertEqual(later.zone.chipLabel, "SE4 · Malmö")
    }

    func testAnUnknownStoredZoneIsIgnored() {
        let s = makeSettings(locale: "de_DE") { $0.set("xx9", forKey: "zone") }
        XCTAssertNil(s.storedZone)
        XCTAssertEqual(s.zone.key, "de")
    }

    func testDevicesKeepTheirKeysAndGetTheirNamesFromTheCatalogue() {
        let s = makeSettings()
        XCTAssertEqual(s.devices.map(\.key), ["heatpump", "car", "water"])
        XCTAssertEqual(s.devices.map(\.name), ["Varmepumpe", "Elbil", "Vandvarmer"])
        L10n.language = "de"
        XCTAssertEqual(s.devices.map(\.name), ["Wärmepumpe", "E-Auto", "Warmwasserspeicher"])
    }
}
