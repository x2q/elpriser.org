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

    func testFiveDayChartIsTodayPlusFourDays() throws {
        let c = try XCTUnwrap(prisChart(period: .five, days: ten(), today: today, now: 21))
        XCTAssertEqual(c.title, "Næste 5 døgn")
        XCTAssertEqual(c.bars.count, 120)
        XCTAssertEqual(c.days, 5)
        XCTAssertEqual(c.dayNames, ["ons 14", "tor 15", "fre 16", "lør 17", "søn 18"])
        XCTAssertEqual(c.dayStarts, [0, 24, 48, 72, 96])
        XCTAssertEqual(c.midnights, [24, 48, 72, 96])
        // i dag fra kl. 00: timer der er gået dæmpes, prikken står på den nuværende time
        XCTAssertEqual(c.nowIndex, 21)
        XCTAssertEqual(c.bars.filter(\.past).count, 21)
        XCTAssertFalse(c.bars[21].past)
        XCTAssertFalse(c.bars[24 + 3].past)
        // én etiket pr. døgn, midt under døgnets 24 søjler
        XCTAssertEqual(c.xLabels(step: 12).map(\.text), c.dayNames)
        XCTAssertEqual(c.xLabels(step: 6).map(\.at), [12, 36, 60, 84, 108])
    }

    func testFiveDayTooltipsUseIDagIMorgenThenWeekdayAndDate() throws {
        let c = try XCTUnwrap(prisChart(period: .five, days: ten(), today: today, now: 21))
        XCTAssertEqual(c.bars[19].tip, "I dag kl. 19 · 3,90 kr/kWh")
        XCTAssertEqual(c.bars[24 + 13].tip, "I morgen kl. 13 · 1,38 kr/kWh")
        XCTAssertEqual(c.bars[48 + 13].tip, "fre 16. okt kl. 13 · 1,38 kr/kWh")
        XCTAssertEqual(c.bars[96 + 13].tip, "søn 18. okt kl. 13 · 1,40 kr/kWh")
    }

    func testFiveDayPrognoseMarkerIsTheFirstForecastDay() throws {
        // i morgen er endnu ikke offentliggjort: prognosen begynder ved i morgen kl. 00
        let early = [day(today, t), day("2026-10-15", m, actual: false), day("2026-10-16", m, actual: false),
                     day("2026-10-17", m, actual: false), day("2026-10-18", m, actual: false)]
        XCTAssertEqual(try XCTUnwrap(prisChart(period: .five, days: early, today: today, now: 9)).forecastFrom, 24)
        // i morgen er offentliggjort: først dagen efter er prognose
        let c = try XCTUnwrap(prisChart(period: .five, days: ten(), today: today, now: 21))
        XCTAssertEqual(c.forecastFrom, 48)
        XCTAssertTrue(c.bars[47].actual)
        XCTAssertTrue(c.bars[24].actual)
        XCTAssertFalse(c.bars[48].actual)
    }

    func testFiveDayTiersAreTercilesOfTheVisibleWindow() throws {
        let c = try XCTUnwrap(prisChart(period: .five, days: ten(), today: today, now: 9))
        let n = Double(c.bars.count)
        let low = Double(c.bars.filter { $0.tier == .low }.count) / n
        let high = Double(c.bars.filter { $0.tier == .high }.count) / n
        XCTAssertEqual(low, 1.0 / 3, accuracy: 0.12)
        XCTAssertEqual(high, 1.0 / 3, accuracy: 0.12)
        // niveauet måles mod de 120 synlige timer, ikke mod de 48 i 2-døgnsvisningen
        let all = c.bars.map(\.value)
        for b in c.bars { XCTAssertEqual(b.tier, priceTier(b.value, in: all)) }
    }

    func testFiveDayAxisFollowsTheHighestVisiblePrice() throws {
        var days = ten()
        days[4] = day("2026-10-18", m.map { $0 + 6 }, actual: false)  // søn 18.: 3,34 + 6 = 9,34
        let c = try XCTUnwrap(prisChart(period: .five, days: days, today: today, now: 9))
        XCTAssertEqual(c.axis.max, 10.5)  // 9,34 × 1,12 = 10,46 → 10,5
        // et døgn uden for vinduet (døgn 6) rykker ikke aksen
        days[7] = day("2026-10-21", m.map { $0 + 50 }, actual: false)
        XCTAssertEqual(try XCTUnwrap(prisChart(period: .five, days: days, today: today, now: 9)).axis.max, 10.5)
    }

    func testFiveDaySummaryNamesTheExtremeHourAndDay() throws {
        let c = try XCTUnwrap(prisChart(period: .five, days: ten(), today: today, now: 21))
        XCTAssertTrue(c.summary.hasPrefix("Næste 5 døgn. Billigst 1,30 kr/kWh "), c.summary)
        XCTAssertTrue(c.summary.contains("kl. "), c.summary)
    }

    func testFiveDayChartShowsWhatExistsWhenForecastIsMissing() throws {
        let c = try XCTUnwrap(prisChart(period: .five, days: [day(today, t), day("2026-10-15", m)], today: today, now: 9))
        XCTAssertEqual(c.bars.count, 48)
        XCTAssertEqual(c.title, "Næste 5 døgn")
        XCTAssertEqual(c.dayNames, ["ons 14", "tor 15"])
    }

    func testFiveDayChartMatchesTheDaysByDateNotPosition() throws {
        // et hul i data (lør 17. mangler) flytter ikke de andre døgn
        let days = [day(today, t), day("2026-10-15", m), day("2026-10-16", m, actual: false), day("2026-10-18", m, actual: false)]
        let c = try XCTUnwrap(prisChart(period: .five, days: days, today: today, now: 9))
        XCTAssertEqual(c.bars.count, 96)
        XCTAssertEqual(c.dayNames, ["ons 14", "tor 15", "fre 16", "søn 18"])
    }

    func testLongPastTheFiveDayWindowIsNotShown() throws {
        let only = [day("2026-10-20", m, actual: false), day("2026-10-21", m, actual: false)]
        XCTAssertNil(prisChart(period: .five, days: only, today: today, now: 9))
    }

    func testStepSelectionStepsOneHourAndStaysInside() {
        XCTAssertEqual(stepSelection(current: nil, nowIndex: 21, count: 120, forward: true), 22)
        XCTAssertEqual(stepSelection(current: nil, nowIndex: nil, count: 120, forward: true), 1)
        XCTAssertEqual(stepSelection(current: 119, nowIndex: 21, count: 120, forward: true), 119)
        XCTAssertEqual(stepSelection(current: 0, nowIndex: 21, count: 120, forward: false), 0)
        XCTAssertEqual(stepSelection(current: 60, nowIndex: 21, count: 120, forward: false), 59)
        XCTAssertNil(stepSelection(current: nil, nowIndex: nil, count: 0, forward: true))
    }

    // MARK: periode

    func testPeriodWindowAndLabels() {
        XCTAssertEqual(PricePeriod.two.offsets, 0...1)
        XCTAssertEqual(PricePeriod.five.offsets, 0...4)
        XCTAssertEqual(PricePeriod.five.offsets.count * 24, 120)
        XCTAssertEqual(PricePeriod.two.pillTitle, "2 døgn")
        XCTAssertEqual(PricePeriod.five.pillTitle, "5 døgn")
        XCTAssertEqual(PricePeriod.two.title, "Næste 2 døgn")
        XCTAssertEqual(PricePeriod.five.title, "Næste 5 døgn")
    }

    func testLegacyThreeToTenValuesResolveToFiveDays() {
        for v in ["10", "long", "3-10", "3–10", "3–10 døgn", "5", "five"] {
            XCTAssertEqual(PricePeriod(stored: v), .five, v)
        }
        for v in ["2", "two", "2 døgn"] { XCTAssertEqual(PricePeriod(stored: v), .two, v) }
        // ukendt eller tomt: ingen værdi (kalderen beholder standarden) — aldrig et nedbrud
        for v in [nil, "", "banan", "7", "-1"] { XCTAssertNil(PricePeriod(stored: v), v ?? "nil") }
    }

    func testStatTilesFollowTheVisibleWindowAndNameLaterDays() throws {
        // døgn 4 (søn 18.) får både billigste og dyreste time i vinduet
        var days = ten()
        days[4] = day("2026-10-18", m.enumerated().map { $0.offset == 13 ? 0.51 : ($0.offset == 19 ? 9.99 : $0.element) }, actual: false)
        let s = try XCTUnwrap(prisSummary(days: days, today: today, now: 9, period: .five))
        XCTAssertEqual(s.cheapest, PrisExtreme(label: "Billigst søn 18.", price: 0.51, hour: 13))
        XCTAssertEqual(s.dearest, PrisExtreme(label: "Dyrest søn 18.", price: 9.99, hour: 19))
        // hero er uændret: niveau og sætning hører til de næste 48 timer, uanset periode
        let two = try XCTUnwrap(prisSummary(days: days, today: today, now: 9, period: .two))
        XCTAssertEqual(s.tier, two.tier)
        XCTAssertEqual(s.sentence, two.sentence)
        XCTAssertEqual(s.price, two.price)
        XCTAssertEqual(two.cheapest.label, "Billigst i morgen")  // 1,38 i morgen kl. 13 slår 1,39 i dag
        XCTAssertEqual(two.dearest.label, "Dyrest i aften")
    }

    func testExtremeWordingPerDay() throws {
        let names = ["ons 14.", "tor 15.", "fre 16.", "lør 17.", "søn 18."]
        var p = [Double](repeating: 1.5, count: 120)
        p[48 + 13] = 0.51
        p[96 + 19] = 2.49
        var e = try XCTUnwrap(prisExtremes(prices: p, now: 9, laterDays: names))
        XCTAssertEqual(e.cheapest.label, "Billigst fre 16.")
        XCTAssertEqual(e.dearest.label, "Dyrest søn 18.")
        XCTAssertEqual(e.cheapest.hour, 13)
        p[24 + 8] = 3.0  // i morgen kl. 08
        e = try XCTUnwrap(prisExtremes(prices: p, now: 9, laterDays: names))
        XCTAssertEqual(e.dearest.label, "Dyrest i morgen")
        p[9 + 4] = 0.2  // i dag kl. 13
        p[17] = 9  // i dag kl. 17 -> i aften
        e = try XCTUnwrap(prisExtremes(prices: p, now: 9, laterDays: names))
        XCTAssertEqual(e.cheapest.label, "Billigst i dag")
        XCTAssertEqual(e.dearest.label, "Dyrest i aften")
        // uden navne (kun to døgn kendt, eller et hul) aldrig et nedbrud
        XCTAssertEqual(try XCTUnwrap(prisExtremes(prices: p, now: 9)).cheapest.label, "Billigst i dag")
    }

    func testSummaryStopsAtAGapSoNoHourGetsTheWrongDay() throws {
        // lør 17. mangler: fre 16. er sidste sammenhængende døgn, søn 18. må ikke regnes som døgn 3
        var d2 = m
        d2[5] = 0.01
        let days = [day(today, t), day("2026-10-15", m), day("2026-10-16", m, actual: false), day("2026-10-18", d2, actual: false)]
        let s = try XCTUnwrap(prisSummary(days: days, today: today, now: 9, period: .five))
        XCTAssertNotEqual(s.cheapest.price, 0.01)
    }

    func testForecastDividerFallsWhereTomorrowStopsBeingPublished() throws {
        let days = [day(today, t), day("2026-10-15", m, actual: false)]
        let c = try XCTUnwrap(prisChart(period: .two, days: days, today: today, now: 9))
        XCTAssertEqual(c.forecastFrom, 24)
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
