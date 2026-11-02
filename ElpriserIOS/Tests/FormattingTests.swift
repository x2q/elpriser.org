import XCTest
@testable import Elpriser

/// Numbers, dates, units and the clock of a zone. Every test names its language and zone: none reads the simulator's.
final class FormattingTests: DanishTestCase {
    // MARK: numbers

    func testFmtFollowsTheLocalesDecimalSeparatorAndMinusSign() {
        // (language, 3,9 with two decimals, -1,25, 1234,5 with one decimal) — the minus is U+2212 where CLDR writes it so
        let minus = "\u{2212}"
        let cases: [(String, String, String, String)] = [
            ("da", "3,90", "-1,25", "1234,5"), ("en", "3.90", "-1.25", "1234.5"), ("de", "3,90", "-1,25", "1234,5"),
            ("fr", "3,90", "-1,25", "1234,5"), ("sv", "3,90", "\(minus)1,25", "1234,5"), ("pl", "3,90", "-1,25", "1234,5"),
            ("nb", "3,90", "\(minus)1,25", "1234,5"), ("fi", "3,90", "\(minus)1,25", "1234,5"),
        ]
        for (lang, plain, negative, big) in cases {
            L10n.language = lang
            XCTAssertEqual(fmt(3.9), plain, lang)
            XCTAssertEqual(fmt(-1.25), negative, lang)
            XCTAssertEqual(fmt(1234.5, 1), big, "\(lang): no grouping separator in a price")
        }
    }

    func testFmtNeverWritesNegativeZeroOrNaN() {
        for lang in ["da", "en", "sv"] {
            L10n.language = lang
            XCTAssertEqual(fmt(-0.001), lang == "en" ? "0.00" : "0,00", lang)
            XCTAssertEqual(fmt(-0.04, 1), lang == "en" ? "0.0" : "0,0", lang)
            XCTAssertEqual(fmt(nil), "–")
            XCTAssertEqual(fmt(.nan), "–")
        }
    }

    func testFmtRoundsAsPrintfDoes() {
        // the Danish numbers must not move: 2,675 is below the tie in binary, so it is 2,67 as it has always been
        XCTAssertEqual(fmt(2.675), "2,67")
        XCTAssertEqual(fmt(0.125), "0,12")
        XCTAssertEqual(fmt(1.005), "1,00")
    }

    func testTenthsTextUsesTheLocalesSymbols() {
        XCTAssertEqual(tenthsText(-125), "-12,5")
        L10n.language = "en"
        XCTAssertEqual(tenthsText(853), "85.3")
        XCTAssertEqual(tenthsText(-3), "-0.3")
        L10n.language = "sv"
        XCTAssertEqual(tenthsText(-3), "\u{2212}0,3")
    }

    func testAxisLabelsFollowTheLocale() {
        L10n.language = "en"
        XCTAssertEqual(priceAxis(lo: 0, hi: 1.2).ticks.map(priceAxis(lo: 0, hi: 1.2).label), ["0", "0.5", "1", "1.5"])
    }

    // MARK: dates

    func testWeekdayAndMonthNamesComeFromTheCatalogueInEveryLanguage() {
        let day = Day(date: "2026-10-17", actual: true, price: [], lo: nil, hi: nil)  // a Saturday
        let cases: [(String, String, String, String)] = [
            ("da", "lør", "17. okt", "Lørdag 17. okt"), ("en", "Sat", "17 Oct", "Saturday 17 Oct"),
            ("de", "Sa", "17. Okt.", "Samstag, 17. Okt."), ("pl", "sob.", "17 paź", "Sobota, 17 paź"),
        ]
        for (lang, short, month, long) in cases {
            L10n.language = lang
            XCTAssertEqual(dayShort(day), short, lang)
            XCTAssertEqual(dayMonth(day), month, lang)
            XCTAssertEqual(dayLong(day), long, lang)
        }
    }

    func testWeekdayIsTheSameInEveryZoneBecauseADayIsParsedAtNoon() {
        for z in Zones.all {
            Clock.zone = z.timeZone
            let d = Day(date: "2026-10-14", actual: true, price: [], lo: nil, hi: nil)
            XCTAssertEqual(dayShort(d), "ons", z.key)
            XCTAssertEqual(dayNum(d), 14, z.key)
        }
    }

    // MARK: the clock of a zone

    private func date(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }

    func testTodayAndHourFollowTheZonesOwnClock() {
        let t = date("2026-10-10T22:30:00Z")
        let cph = Zones.byKey("dk1")!.timeZone, hel = Zones.byKey("fi")!.timeZone, lis = Zones.byKey("pt")!.timeZone
        XCTAssertEqual(Clock.today(t, in: cph), "2026-10-11"); XCTAssertEqual(Clock.hour(t, in: cph), 0)    // UTC+2
        XCTAssertEqual(Clock.today(t, in: hel), "2026-10-11"); XCTAssertEqual(Clock.hour(t, in: hel), 1)    // UTC+3
        XCTAssertEqual(Clock.today(t, in: lis), "2026-10-10"); XCTAssertEqual(Clock.hour(t, in: lis), 23)   // UTC+1
    }

    func testTheShortFormsUseTheCurrentZone() {
        let t = date("2026-10-10T22:30:00Z")
        Clock.zone = Zones.byKey("pt")!.timeZone
        XCTAssertEqual(Clock.today(t), "2026-10-10")
        XCTAssertEqual(Clock.hour(t), 23)
        Clock.zone = Zones.byKey("fi")!.timeZone
        XCTAssertEqual(Clock.today(t), "2026-10-11")
        XCTAssertEqual(Clock.hour(t), 1)
        Clock.zone = Clock.copenhagen
        XCTAssertEqual(Clock.today(t), "2026-10-11")
    }

    func testTheHourStepsRightAcrossTheAutumnClockChange() {
        // Berlin 2026-10-25: 03:00 CEST becomes 02:00 CET, so the wall clock shows hour 2 twice
        let berlin = Zones.byKey("de")!.timeZone
        XCTAssertEqual(Clock.hour(date("2026-10-24T23:30:00Z"), in: berlin), 1)   // 01:30 CEST
        XCTAssertEqual(Clock.hour(date("2026-10-25T00:30:00Z"), in: berlin), 2)   // 02:30 CEST
        XCTAssertEqual(Clock.hour(date("2026-10-25T01:30:00Z"), in: berlin), 2)   // 02:30 CET
        XCTAssertEqual(Clock.hour(date("2026-10-25T02:30:00Z"), in: berlin), 3)
        XCTAssertEqual(Clock.today(date("2026-10-25T22:59:00Z"), in: berlin), "2026-10-25")  // 23:59 CET
        XCTAssertEqual(Clock.today(date("2026-10-25T23:00:00Z"), in: berlin), "2026-10-26")
    }

    func testTheHourSkipsTwoOnTheSpringClockChange() {
        // Lisbon 2026-03-29: 01:00 WET becomes 02:00 WEST — hour 1 never exists
        let lisbon = Zones.byKey("pt")!.timeZone
        XCTAssertEqual(Clock.hour(date("2026-03-29T00:30:00Z"), in: lisbon), 0)
        XCTAssertEqual(Clock.hour(date("2026-03-29T01:30:00Z"), in: lisbon), 2)
        XCTAssertEqual(Clock.today(date("2026-03-29T23:30:00Z"), in: lisbon), "2026-03-30")  // 00:30 WEST
    }

    func testParseAndFormatRoundTripInEveryZoneOnClockChangeDays() {
        for z in Zones.all {
            for s in ["2026-03-29", "2026-10-25", "2026-12-31", "2027-01-01", "2028-02-29"] {
                let d = Clock.parse(s, in: z.timeZone)
                XCTAssertEqual(Clock.format(d, in: z.timeZone), s, "\(z.key) \(s)")
                XCTAssertEqual(Clock.hour(d, in: z.timeZone), 12, "\(z.key) \(s): a day is noon")
            }
        }
    }

    func testTheDaysOfAPeriodAreCountedOnTheZonesClockAcrossAClockChange() {
        Clock.zone = Zones.byKey("de")!.timeZone
        func d(_ s: String) -> Day { Day(date: s, actual: true, price: [Double](repeating: 1, count: 24), lo: nil, hi: nil) }
        let days = [d("2026-10-24"), d("2026-10-25"), d("2026-10-26"), d("2026-10-27")]
        let items = daysIn(.five, days: days, today: "2026-10-24")
        XCTAssertEqual(items.map(\.offset), [0, 1, 2, 3])
        // the long day: 25 hours on the wall clock, still one calendar day
        let chart = prisChart(period: .five, days: days, today: "2026-10-24", now: 9)
        XCTAssertEqual(chart?.days, 4)
    }

    func testAChartInHelsinkiKeepsItsOwnWeekdays() throws {
        Clock.zone = Zones.byKey("fi")!.timeZone
        let days = (0..<3).map { i -> Day in
            Day(date: "2026-10-\(14 + i)", actual: i < 2, price: (0..<24).map { Double($0) }, lo: nil, hi: nil)
        }
        let c = try XCTUnwrap(prisChart(period: .two, days: days, today: "2026-10-14", now: 10, unit: Zones.byKey("fi")!.unit))
        XCTAssertEqual(c.dayNames, ["I dag", "I morgen", "fre"])
        XCTAssertEqual(c.bars[0].hour, 4)
        XCTAssertEqual(c.bars[0].tip, "I dag kl. 04 · 4,0 ct/kWh")
    }

    // MARK: price units

    func testDanishUnitIsKronerWithTwoDecimals() {
        let u = Zones.byKey("dk1")!.unit
        XCTAssertEqual(u, PriceUnit.kroner)
        XCTAssertEqual(u.decimals, 2)
        XCTAssertFalse(u.isSubUnit)
        XCTAssertEqual(u.withUnit(3.9), "3,90 kr/kWh")
        XCTAssertEqual(u.amount(1.38), "1,38 kr")
        XCTAssertEqual(u.number(-0.001), "0,00")
        L10n.language = "de"
        XCTAssertEqual(PriceUnit.kroner.withUnit(3.9), "3,90 DKK/kWh", "a Danish price in a German app says DKK")
    }

    func testOtherZonesUseTheirSubUnitWithOneDecimal() {
        let cases: [(String, String, String)] = [("no2", "øre", "øre/kWh"), ("se3", "öre", "öre/kWh"), ("pl", "gr", "gr/kWh"), ("de", "ct", "ct/kWh")]
        for (key, short, perKwh) in cases {
            let u = Zones.byKey(key)!.unit
            XCTAssertEqual(u.decimals, 1, key)
            XCTAssertEqual(u.short, short, key)
            XCTAssertEqual(u.perKwh, perKwh, key)
            XCTAssertTrue(u.isSubUnit)
            XCTAssertEqual(u.perMajor, 100)
        }
        XCTAssertEqual(Zones.byKey("de")!.unit.withUnit(12.34), "12,3 ct/kWh")
        XCTAssertEqual(Zones.byKey("no1")!.unit.amount(85.26), "85,3 øre")
    }

    func testTheEuroCentIsWrittenAsTheLanguageWritesIt() {
        for (lang, perKwh) in [("da", "ct/kWh"), ("en", "ct/kWh"), ("fr", "c€/kWh"), ("it", "c€/kWh"), ("sv", "cent/kWh"), ("fi", "snt/kWh")] {
            L10n.language = lang
            XCTAssertEqual(Zones.byKey("nl")!.unit.perKwh, perKwh, lang)
        }
        L10n.language = "en"
        XCTAssertEqual(Zones.byKey("no1")!.unit.perKwh, "øre/kWh", "øre is a unit name, not a translation")
    }

    func testAmountsInTheZonesCurrency() {
        // 123 ct = 1,23 EUR; 456 øre = 4,56 NOK; the locale decides symbol and place
        L10n.language = "de"
        let eur = Zones.byKey("de")!.unit.money(123)
        XCTAssertTrue(eur.contains("1,23") && eur.contains("€"), eur)
        L10n.language = "en"
        XCTAssertEqual(Zones.byKey("de")!.unit.money(123), "€1.23")
        L10n.language = "nb"
        let nok = Zones.byKey("no1")!.unit.money(456)
        XCTAssertTrue(nok.contains("4,56") && nok.contains("kr"), nok)
        L10n.language = "pl"
        let pln = Zones.byKey("pl")!.unit.money(1234)
        XCTAssertTrue(pln.contains("12,34") && pln.contains("zł"), pln)
        L10n.language = "sv"
        let sek = Zones.byKey("se3")!.unit.money(50)
        XCTAssertTrue(sek.contains("0,50") && sek.contains("kr"), sek)
        // Denmark keeps its own way: the number and "kr"
        L10n.language = "da"
        XCTAssertEqual(Zones.byKey("dk2")!.unit.money(4.56), "4,56 kr")
    }

    // MARK: the axis

    func testTheDanishAxisIsUnchangedByTheUnitOverload() {
        for hi in [0.3, 1.2, 3.9, 4.0, 11, 25] {
            XCTAssertEqual(priceAxis(lo: 0, hi: hi, unit: .kroner), priceAxis(lo: 0, hi: hi), "hi \(hi)")
        }
        XCTAssertEqual(priceAxis(lo: -0.3, hi: 2.0, unit: .kroner), priceAxis(lo: -0.3, hi: 2.0))
    }

    func testSubUnitAxisUsesNiceStepsAndNeverMoreThanSixLabels() {
        let u = Zones.byKey("de")!.unit
        XCTAssertEqual(priceAxis(lo: 0, hi: 30, unit: u).ticks, [0, 10, 20, 30, 40])
        XCTAssertEqual(priceAxis(lo: 0, hi: 12.3, unit: u).ticks, [0, 5, 10, 15])
        XCTAssertEqual(priceAxis(lo: 0, hi: 3, unit: u).ticks, [0, 1, 2, 3, 4])
        XCTAssertEqual(priceAxis(lo: 0, hi: 120, unit: u).ticks, [0, 50, 100, 150])
        XCTAssertEqual(priceAxis(lo: 0, hi: 1.2, unit: u).ticks, [0, 0.5, 1, 1.5])
        for hi in stride(from: 0.2, through: 900, by: 3.7) {
            let a = priceAxis(lo: 0, hi: hi, unit: u)
            XCTAssertGreaterThanOrEqual(a.max, hi * 1.12 - 1e-9, "hi \(hi): the tallest bar stays below the top")
            XCTAssertLessThanOrEqual(a.ticks.count, 7, "hi \(hi)")
            XCTAssertEqual(a.min, 0)
            XCTAssertEqual(a.ticks.first, 0)
        }
    }

    func testSubUnitAxisReachesBelowZeroForNegativePrices() {
        let u = Zones.byKey("de")!.unit
        let a = priceAxis(lo: -5, hi: 30, unit: u)
        XCTAssertEqual(a.min, -10)
        XCTAssertEqual(a.max, 40)
        XCTAssertTrue(a.ticks.contains(0))
        XCTAssertEqual(a.ticks, [-10, 0, 10, 20, 30, 40])
        // all negative: the bars hang from zero
        let n = priceAxis(lo: -8, hi: -1, unit: u)
        XCTAssertEqual(n.max, 0)
        XCTAssertLessThan(n.min, -8)
        // nothing at all: a usable axis, not an empty one
        let z = priceAxis(lo: 0, hi: 0, unit: u)
        XCTAssertGreaterThan(z.max, z.min)
    }

    func testAChartInASubUnitCarriesItsUnitInTipsSummaryAndAxis() throws {
        let u = Zones.byKey("de")!.unit
        let days = (0..<2).map { i in Day(date: "2026-10-\(14 + i)", actual: true, price: (0..<24).map { 5 + Double($0) * 1.1 }, lo: nil, hi: nil) }
        let c = try XCTUnwrap(prisChart(period: .two, days: days, today: "2026-10-14", now: 10, unit: u))
        XCTAssertEqual(c.unit, u)
        XCTAssertEqual(c.bars[6].tip, "I dag kl. 10 · 16,0 ct/kWh")
        XCTAssertTrue(c.summary.contains("ct/kWh"), c.summary)
        XCTAssertEqual(c.axis, priceAxis(lo: 0, hi: c.bars.map(\.value).max()!, unit: u))
        let s = try XCTUnwrap(prisSummary(days: days, today: "2026-10-14", now: 10, unit: u))
        XCTAssertTrue(s.sentence.contains(" ct"), s.sentence)
        XCTAssertFalse(s.sentence.contains(" kr"), s.sentence)
    }
}
