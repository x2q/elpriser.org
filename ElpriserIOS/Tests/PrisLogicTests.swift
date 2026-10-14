import XCTest
@testable import Elpriser

/// Pris-skærmens rene logik (Design A): niveau, akse, sætning, statistikfelter, søjler og tekster.
/// Prøvedata er det samme døgnpar som designets skitse (DK1, N1, onsdag 14. okt.).
final class PrisLogicTests: XCTestCase {
    private let today = "2026-10-14"  // en onsdag
    private let t: [Double] = [1.32, 1.37, 1.35, 1.31, 1.30, 1.43, 1.78, 1.92, 2.11, 1.97, 1.86, 1.74, 1.52, 1.39, 1.44, 1.63, 1.98, 3.21, 3.68, 3.90, 3.67, 2.67, 2.43, 2.20]
    private let m: [Double] = [1.73, 1.69, 1.69, 1.69, 1.64, 1.63, 1.95, 2.23, 2.45, 2.18, 2.07, 1.84, 1.53, 1.38, 1.42, 1.63, 2.00, 3.03, 3.33, 3.34, 2.98, 2.15, 2.10, 2.09]
    private var both: [Double] { t + m }

    private func day(_ date: String, _ p: [Double], actual: Bool = true) -> Day {
        Day(date: date, actual: actual, price: p, lo: nil, hi: nil)
    }
    private func ten() -> [Day] {
        var out = [day("2026-10-14", t), day("2026-10-15", m)]
        for (i, date) in ["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"].enumerated() {
            out.append(day(date, m.map { $0 + Double(i) * 0.01 }, actual: false))
        }
        return out
    }

    // MARK: akse

    func testAxisMaxIsHighestTimes112RoundedUpToHalf() {
        let a = priceAxis(lo: 0, hi: 3.90)
        XCTAssertEqual(a.min, 0)
        XCTAssertEqual(a.max, 4.5)
        XCTAssertEqual(a.ticks, [0, 1, 2, 3, 4])
        XCTAssertEqual(a.ticks.map(a.label), ["0", "1", "2", "3", "4"])
    }

    func testAxisNeverLetsTheTallestBarTouchTheTop() {
        for hi in [0.3, 0.88, 1.0, 1.79, 2.0, 3.5, 4.0, 4.46, 9.9] {
            XCTAssertGreaterThan(priceAxis(lo: 0, hi: hi).max, hi * 1.1, "hi \(hi)")
        }
        // en pris præcis på et halvt trin: 4,0 × 1,12 = 4,48 → 4,5
        XCTAssertEqual(priceAxis(lo: 0, hi: 4.0).max, 4.5)
    }

    func testLowAxisUsesHalfKronerWithDanishComma() {
        let a = priceAxis(lo: 0, hi: 1.2)
        XCTAssertEqual(a.max, 1.5)
        XCTAssertEqual(a.ticks, [0, 0.5, 1.0, 1.5])
        XCTAssertEqual(a.ticks.map(a.label), ["0", "0,5", "1", "1,5"])
    }

    func testTallSpikeKeepsTheLabelCountDown() {
        let a = priceAxis(lo: 0, hi: 11)
        XCTAssertLessThanOrEqual(a.ticks.count, 7)
        XCTAssertEqual(a.ticks.first, 0)
    }

    func testNegativePricesExtendTheAxisBelowZero() {
        let a = priceAxis(lo: -0.3, hi: 2.0)
        XCTAssertEqual(a.min, -0.5)
        XCTAssertEqual(a.max, 2.5)
        XCTAssertTrue(a.ticks.contains(0))
    }

    // MARK: sætning og niveau

    func testSentenceNamesTomorrowsCheapestHour() {
        let s = heroSentence(prices: both, now: 21)
        XCTAssertEqual(s.text, "Billigere i morgen kl. 13 — 1,38 kr")
        XCTAssertEqual(s.emphasis, "1,38 kr")
    }

    func testSentenceSaysIDagWhenTheCheapestHourIsToday() {
        XCTAssertEqual(heroSentence(prices: both, now: 12).text, "Billigere i dag kl. 13 — 1,39 kr")
    }

    func testSentenceWhenNowIsTheCheapestOfTheNext24Hours() {
        // kl. 13 i dag (1,39) er billigst i vinduet 13..36; morgendagens 1,38 ligger lige uden for.
        let s = heroSentence(prices: both, now: 13)
        XCTAssertEqual(s.text, "Billigste time de næste 24 timer")
        XCTAssertNil(s.emphasis)
    }

    func testSentenceUsesWhatExistsWhenTomorrowIsMissing() {
        // uden i morgen er resten af i dag hele vinduet: kl. 23 (2,20) er billigere end kl. 21 (2,67)
        XCTAssertEqual(heroSentence(prices: t, now: 21).text, "Billigere i dag kl. 23 — 2,20 kr")
        XCTAssertEqual(heroSentence(prices: t, now: 23).text, "Billigste time de næste 24 timer")
        XCTAssertEqual(heroSentence(prices: t, now: 8).text, "Billigere i dag kl. 13 — 1,39 kr")
    }

    func testTierFollowsTheExistingVerdictRule() {
        XCTAssertEqual(priceTier(1.30, in: both), .low)
        XCTAssertEqual(priceTier(2.67, in: both), .high)
        XCTAssertEqual(priceTier(1.9, in: both), .mid)
        XCTAssertEqual(tierLabel(.low), "Billig lige nu")
        XCTAssertEqual(tierLabel(.mid), "Middel lige nu")
        XCTAssertEqual(tierLabel(.high), "Dyr lige nu")
        XCTAssertEqual(priceTier(1, in: []), .mid)  // ingen data: aldrig et nedbrud
    }

    // MARK: statistikfelter

    func testStatTilesNameTheDayOfTheUpcomingExtreme() throws {
        let e = try XCTUnwrap(prisExtremes(prices: both, now: 21))
        XCTAssertEqual(e.cheapest, PrisExtreme(label: "Billigst i morgen", price: 1.38, hour: 13))
        // kl. 19 i dag er allerede gået; det dyreste kommende er i morgen kl. 19
        XCTAssertEqual(e.dearest, PrisExtreme(label: "Dyrest i morgen", price: 3.34, hour: 19))
    }

    func testDearestTodayIsIAftenOnlyFromFive() throws {
        XCTAssertEqual(try XCTUnwrap(prisExtremes(prices: both, now: 10)).dearest.label, "Dyrest i aften")
        // dyreste time i dag før kl. 17 hedder "i dag"
        var morning = both
        morning[8] = 9.0
        XCTAssertEqual(try XCTUnwrap(prisExtremes(prices: morning, now: 6)).dearest.label, "Dyrest i dag")
        XCTAssertEqual(try XCTUnwrap(prisExtremes(prices: both, now: 0)).cheapest.label, "Billigst i dag")
    }

    func testSummaryNeedsToday() throws {
        XCTAssertNil(prisSummary(days: [day("2026-10-15", m)], today: today, now: 9))
        let s = try XCTUnwrap(prisSummary(days: [day(today, t), day("2026-10-15", m)], today: today, now: 21))
        XCTAssertEqual(s.price, 2.67)
        XCTAssertEqual(s.tier, .high)
        XCTAssertEqual(s.hour, 21)
    }

    // MARK: søjler

    func testTwoDayChart() throws {
        let c = try XCTUnwrap(prisChart(period: .two, days: ten(), today: today, now: 21))
        XCTAssertEqual(c.title, "Næste 2 døgn")
        XCTAssertEqual(c.bars.count, 48)
        XCTAssertEqual(c.nowIndex, 21)
        XCTAssertEqual(c.bars.filter(\.past).count, 21)
        XCTAssertFalse(c.bars[21].past)
        XCTAssertEqual(c.bars[19].tip, "I dag kl. 19 · 3,90 kr/kWh")
        XCTAssertEqual(c.bars[37].tip, "I morgen kl. 13 · 1,38 kr/kWh")
        XCTAssertEqual(c.axis.max, 4.5)
        XCTAssertNil(c.forecastFrom)
        XCTAssertEqual(c.xLabels(step: 12).map(\.text), ["I dag 00", "12", "I morgen 00", "12"])
        XCTAssertEqual(c.xLabels(step: 6).map(\.text), ["I dag 00", "06", "12", "18", "I morgen 00", "06", "12", "18"])
        XCTAssertEqual(c.xLabels(step: 6).map(\.at), [0, 6, 12, 18, 24, 30, 36, 42])
    }

    func testBarTiersAgreeWithTheHeroForTheCurrentHour() throws {
        let c = try XCTUnwrap(prisChart(period: .two, days: ten(), today: today, now: 21))
        let s = try XCTUnwrap(prisSummary(days: ten(), today: today, now: 21))
        XCTAssertEqual(c.bars[21].tier, s.tier)
    }

    func testLongChartIsDaysThreeToTenWithWeekdayTooltips() throws {
        let c = try XCTUnwrap(prisChart(period: .long, days: ten(), today: today, now: 21))
        XCTAssertEqual(c.title, "Døgn 3–10")
        XCTAssertEqual(c.bars.count, 8 * 24)
        XCTAssertNil(c.nowIndex)
        XCTAssertFalse(c.bars.contains { $0.past })
        XCTAssertEqual(c.dayNames.first, "fre 16")
        XCTAssertEqual(c.dayNames.last, "fre 23")
        XCTAssertEqual(c.bars[13].tip, "fre 16. okt kl. 13 · 1,38 kr/kWh")
        XCTAssertEqual(c.forecastFrom, 0)
        XCTAssertEqual(c.xLabels(step: 12).count, 8)
    }

    func testForecastDividerFallsWhereTomorrowStopsBeingPublished() throws {
        let days = [day(today, t), day("2026-10-15", m, actual: false)]
        let c = try XCTUnwrap(prisChart(period: .two, days: days, today: today, now: 9))
        XCTAssertEqual(c.forecastFrom, 24)
    }

    func testLongChartWithoutData() {
        XCTAssertNil(prisChart(period: .long, days: [day(today, t), day("2026-10-15", m)], today: today, now: 9))
    }

    // MARK: tekster

    func testCaptions() {
        XCTAssertEqual(priceCaption(spot: false, hasNet: true), "Inkl. nettarif, afgifter og moms")
        XCTAssertEqual(priceCaption(spot: false, hasNet: false), "Inkl. Energinets tariffer, afgifter og moms")
        XCTAssertEqual(priceCaption(spot: true, hasNet: true), "Spotpris inkl. moms")
    }

    func testNetChip() {
        XCTAssertEqual(netChipLabel(net: Nets.byGln("5790001089030"), area: "DK1"), "N1 · Vest")
        XCTAssertEqual(netChipLabel(net: Nets.byGln("5790000705689"), area: "DK1"), "Radius · Øst")
        XCTAssertEqual(netChipLabel(net: nil, area: "DK1"), "DK1 · Vest")
        XCTAssertEqual(netChipLabel(net: nil, area: "DK2"), "DK2 · Øst")
    }

    func testPriceModeMapsTheTwoSwitchOptions() {
        let s = Settings()
        let before = s.view
        defer { s.updateView(before) }
        s.updateView(2)
        XCTAssertEqual(s.prisMode, "spot_inkl")
        XCTAssertTrue(s.prisIsSpot)
        for legacy in [0, 1, 3] {
            s.updateView(legacy)
            XCTAssertFalse(s.prisIsSpot)
            XCTAssertTrue(["net_inkl_alt", "inkl_alt"].contains(s.prisMode))
        }
    }
}
