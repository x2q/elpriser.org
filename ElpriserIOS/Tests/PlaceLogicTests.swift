import XCTest
@testable import Elpriser

/// Stedslisten ("Hvor er du?"): detaljer på områderækkerne, "Uden netselskab" og søgning.
final class PlaceLogicTests: XCTestCase {
    private let n1 = Nets.all.first { $0.name == "N1" }!
    private let radius = Nets.all.first { $0.name == "Radius" }!

    func testAreaNames() {
        XCTAssertEqual(placeAreas.map(\.name), ["Vestdanmark", "Østdanmark"])
        XCTAssertEqual(placeAreaName("DK2"), "Østdanmark")
    }

    func testDetailShowsTheSavedNetInItsOwnAreaOnly() {
        XCTAssertEqual(placeAreaDetail(area: "DK1", net: n1, chosenArea: "DK1"), "N1")
        XCTAssertEqual(placeAreaDetail(area: "DK2", net: n1, chosenArea: "DK1"), "")
        XCTAssertEqual(placeAreaDetail(area: "DK2", net: radius, chosenArea: "DK1"), "Radius")
    }

    func testDetailSaysWithoutNetForTheChosenAreaWhenNoNetIsSaved() {
        XCTAssertEqual(placeAreaDetail(area: "DK1", net: nil, chosenArea: "DK1"), "Uden netselskab")
        XCTAssertEqual(placeAreaDetail(area: "DK2", net: nil, chosenArea: "DK1"), "")
    }

    func testWithoutNetIsCurrentOnlyWithoutANetInThatArea() {
        XCTAssertTrue(placeIsWithoutNet(area: "DK2", net: nil, chosenArea: "DK2"))
        XCTAssertFalse(placeIsWithoutNet(area: "DK1", net: nil, chosenArea: "DK2"))
        XCTAssertFalse(placeIsWithoutNet(area: "DK1", net: n1, chosenArea: "DK1"))
    }

    func testSearchSpansBothAreasIgnoringCaseAndAccents() {
        XCTAssertEqual(placeSearch("trefor").map(\.name), ["Trefor", "Trefor Øst"])
        XCTAssertEqual(placeSearch("  RADIUS ").map(\.name), ["Radius"])
        XCTAssertEqual(placeSearch("ELVÆRK").map(\.name), ["Elværk"])
        XCTAssertEqual(placeSearch("trefor").map(\.area), ["DK1", "DK2"])
        XCTAssertEqual(placeSearch("ØST").map(\.name), ["Trefor Øst"])
    }

    func testEmptyAndUnknownSearches() {
        XCTAssertTrue(placeSearch("").isEmpty)
        XCTAssertTrue(placeSearch("   ").isEmpty)
        XCTAssertTrue(placeSearch("zzz").isEmpty)
        XCTAssertEqual(placeNoMatch(" zzz "), "Ingen netselskaber matcher “zzz”.")
    }

    func testEveryNetIsReachableThroughItsArea() {
        for a in placeAreas { XCTAssertFalse(Nets.all.filter { $0.area == a.area }.isEmpty, a.area) }
        XCTAssertEqual(placeAreas.map { a in Nets.all.filter { $0.area == a.area }.count }.reduce(0, +), Nets.all.count)
    }
}
