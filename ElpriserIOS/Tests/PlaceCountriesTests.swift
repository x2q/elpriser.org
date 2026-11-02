import XCTest
@testable import Elpriser

/// The country list of the place sheet: order, search, detail texts and where a tap leads.
final class PlaceCountriesTests: DanishTestCase {
    func testThirtyCountriesSortedByTheirNameInTheLanguageOfTheTexts() {
        L10n.language = "da"
        let da = placeCountries()
        XCTAssertEqual(da.count, 30)
        XCTAssertEqual(Set(da), Set(Zones.countries))
        XCTAssertEqual(da.first, "AL", "Albanien")
        XCTAssertEqual(da.last, "AT", "Østrig sorts after the Z's in Danish")
        XCTAssertLessThan(da.firstIndex(of: "FR")!, da.firstIndex(of: "DE")!, "Frankrig before Tyskland")
    }

    func testTheOrderFollowsTheLanguage() {
        L10n.language = "de"
        let de = placeCountries()
        // Österreich sorts with the O's in German: after Norwegen, before Polen
        let at = de.firstIndex(of: "AT")!
        XCTAssertEqual(de[at - 1], "NO")
        XCTAssertEqual(de[at + 1], "PL")
        L10n.language = "en"
        XCTAssertEqual(placeCountries().first, "AL")
        XCTAssertEqual(placeCountries().last, "CH", "Switzerland")
    }

    func testSearchFindsCountriesByLocalizedNameIgnoringCaseAndAccents() {
        L10n.language = "de"
        XCTAssertEqual(placeSearchCountries("österr"), ["AT"])
        XCTAssertEqual(placeSearchCountries("OSTERR"), ["AT"], "diacritics ignored")
        XCTAssertEqual(placeSearchCountries("  deutsch "), ["DE"])
        XCTAssertTrue(placeSearchCountries("zzz").isEmpty)
        XCTAssertTrue(placeSearchCountries("").isEmpty)
        L10n.language = "da"
        XCTAssertEqual(placeSearchCountries("tysk"), ["DE"])
        XCTAssertTrue(placeSearchCountries("norg").contains("NO"))
        L10n.language = "en"
        XCTAssertTrue(placeSearchCountries("land").contains("FI"))
        XCTAssertEqual(placeSearchCountries("germany"), ["DE"])
    }

    func testNoMatchTextNamesWhatWasTyped() {
        XCTAssertEqual(placeNoMatch(" xyz "), "Ingen lande eller netselskaber matcher “xyz”.")
        L10n.language = "en"
        XCTAssertTrue(placeNoMatch("xyz").contains("xyz"))
    }

    func testATapOnACountryLeadsToTheRightPlace() {
        XCTAssertEqual(placeCountryTarget("DK"), .denmark)
        XCTAssertEqual(placeCountryTarget("NO"), .zones("NO"))
        XCTAssertEqual(placeCountryTarget("SE"), .zones("SE"))
        XCTAssertEqual(placeCountryTarget("DE"), .choose(Zones.byKey("de")!))
        XCTAssertEqual(placeCountryTarget("IT"), .choose(Zones.byKey("it-n")!))
        for c in Zones.countries where c != "DK" && Zones.zones(of: c).count == 1 {
            XCTAssertEqual(placeCountryTarget(c), .choose(Zones.zones(of: c)[0]), c)
        }
    }

    func testDetailShowsTheZoneOrNetOnlyOnTheCurrentCountry() {
        let n1 = Nets.all.first { $0.name == "N1" }!
        XCTAssertEqual(placeCountryDetail(country: "NO", zone: Zones.byKey("no3")!, net: nil), "NO3 · Trondheim")
        XCTAssertEqual(placeCountryDetail(country: "SE", zone: Zones.byKey("no3")!, net: nil), "")
        XCTAssertEqual(placeCountryDetail(country: "DE", zone: Zones.byKey("de")!, net: nil), "", "one zone: the name says it")
        XCTAssertEqual(placeCountryDetail(country: "DK", zone: Zones.byKey("dk1")!, net: n1), "N1")
        XCTAssertEqual(placeCountryDetail(country: "DK", zone: Zones.byKey("dk2")!, net: nil), "Uden netselskab")
        XCTAssertEqual(placeCountryDetail(country: "DK", zone: Zones.byKey("fi")!, net: nil), "")
    }

    func testAreaTextsComeFromTheCatalogue() {
        L10n.language = "en"
        XCTAssertEqual(placeAreas.map(\.name), ["West Denmark", "East Denmark"])
        XCTAssertEqual(placeAreaDetail(area: "DK1", net: nil, chosenArea: "DK1"), "Without grid company")
        XCTAssertEqual(netChipLabel(net: nil, area: "DK2"), "DK2 · East")
        XCTAssertEqual(Nets.all[0].areaLabel, "DK1 West")
    }

    func testTheChipForAnyZone() {
        XCTAssertEqual(zoneChipLabel(zone: Zones.byKey("dk1")!, net: Nets.byGln("5790001089030")), "N1 · Vest")
        XCTAssertEqual(zoneChipLabel(zone: Zones.byKey("dk2")!, net: nil), "DK2 · Øst")
        XCTAssertEqual(zoneChipLabel(zone: Zones.byKey("no5")!, net: nil), "NO5 · Bergen")
        XCTAssertEqual(zoneChipLabel(zone: Zones.byKey("pl")!, net: nil), "Polen")
    }

    func testNotesAreCatalogueTexts() {
        XCTAssertEqual(PlaceNote.noPosition.text, "Vi kunne ikke finde din position. Vælg dit netselskab på listen i stedet.")
        XCTAssertEqual(PlaceNote.outside.text, "Din position ligger uden for Danmark. Vælg dit land på listen.")
        L10n.language = "en"
        for n in [PlaceNote.noPosition, .denied, .outside, .noNet, .failed] { XCTAssertFalse(n.text.isEmpty); XCTAssertFalse(n.text.contains("_")) }
    }

    func testTheZoneCaptionIsTheDayAheadNote() {
        XCTAssertEqual(zoneCaption(), "Børspris (day-ahead) uden afgifter, nettarif og moms")
        L10n.language = "de"
        XCTAssertFalse(zoneCaption().isEmpty)
    }
}
