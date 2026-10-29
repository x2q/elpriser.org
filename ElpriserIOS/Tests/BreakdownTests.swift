import XCTest
@testable import Elpriser

/// Prisopbygningen (teksten under Din pris | Spotpris foldet ud): regnestykket, afrundingen, teksterne og valget af time.
/// Håndregnet prøvedata: system 0,07, transmission 0,054, elafgift 0,008, nettarif 0,33 og spot 0,85 kr/kWh ekskl. moms
/// giver (0,85 + 0,07 + 0,054 + 0,008 + 0,33) × 1,25 = 1,64 kr/kWh, med moms 0,328.
final class BreakdownTests: XCTestCase {
    private let charges = Charges(sys: 0.07, trans: 0.054, afg: 0.008, vat: 0.25)
    private let today = "2026-10-14"  // en onsdag

    private func b(_ mode: String = "net_inkl_alt", price: Double = 1.64, hour: Int = 8, forecast: Bool = false,
                   charges: Charges? = Charges(sys: 0.07, trans: 0.054, afg: 0.008, vat: 0.25), tariff: Double? = 0.33,
                   net: String? = "N1", when: String = "") -> PriceBreakdown? {
        breakdownOf(mode: mode, price: price, hour: hour, forecastDay: forecast, charges: charges, gridTariff: tariff, netName: net, headingWhen: when)
    }

    // MARK: regnestykket

    func testDinPrisWithNetSplitsTheHandCalculatedHour() throws {
        let r = try XCTUnwrap(b())
        XCTAssertEqual(r.heading, "Sådan er prisen kl. 08 sammensat")
        XCTAssertEqual(r.rows.map(\.label), [
            "Spotpris (Nord Pool)", "Systemtarif (Energinet)", "Transmissionstarif (Energinet)",
            "Nettarif (N1, kl. 08)", "Elafgift", "Moms (25 %)",
        ])
        XCTAssertEqual(r.rows.map(\.text), ["85,0 øre", "7,0 øre", "5,4 øre", "33,0 øre", "0,8 øre", "32,8 øre"])
        XCTAssertEqual(r.rows.map(\.part), [.spot, .system, .transmission, .grid, .duty, .vat])
        XCTAssertEqual(r.totalText, "1,64 kr/kWh")
        XCTAssertEqual(r.totalTenths, 1640)
        XCTAssertEqual(r.rows.map(\.tenths).reduce(0, +), r.totalTenths)
        XCTAssertFalse(r.isSelected)
    }

    func testDinPrisWithoutNetHasNoTariffRow() throws {
        // (0,86 + 0,07 + 0,054 + 0,008) × 1,25 = 1,24
        let r = try XCTUnwrap(b("inkl_alt", price: 1.24, tariff: nil, net: nil))
        XCTAssertEqual(r.rows.map(\.label), [
            "Spotpris (Nord Pool)", "Systemtarif (Energinet)", "Transmissionstarif (Energinet)", "Elafgift", "Moms (25 %)",
        ])
        XCTAssertEqual(r.rows.map(\.text), ["86,0 øre", "7,0 øre", "5,4 øre", "0,8 øre", "24,8 øre"])
        XCTAssertEqual(r.totalText, "1,24 kr/kWh")
        XCTAssertEqual(r.rows.map(\.tenths).reduce(0, +), 1240)
    }

    func testSpotprisIsSpotAndVatOnly() throws {
        // 0,84 × 1,25 = 1,05 — samme svars afgifter bruges kun til momssatsen
        let r = try XCTUnwrap(b("spot_inkl", price: 1.05, tariff: nil, net: nil))
        XCTAssertEqual(r.rows.map(\.label), ["Spotpris (Nord Pool)", "Moms (25 %)"])
        XCTAssertEqual(r.rows.map(\.text), ["84,0 øre", "21,0 øre"])
        XCTAssertEqual(r.totalText, "1,05 kr/kWh")
    }

    func testForecastDayCallsTheSpotRowPrognose() throws {
        XCTAssertEqual(try XCTUnwrap(b(forecast: true)).rows[0].label, "Spotpris (prognose)")
        XCTAssertEqual(try XCTUnwrap(b("spot_inkl", price: 1.05, forecast: true)).rows[0].label, "Spotpris (prognose)")
        XCTAssertEqual(try XCTUnwrap(b("inkl_alt", price: 1.24, forecast: true, tariff: nil)).rows[0].label, "Spotpris (prognose)")
    }

    func testSpotRowAbsorbsTheRoundingDifference() throws {
        // spot 0,1234 + 0,07 + 0,054 + 0,008 + 0,33 = 0,5854 × 1,25 = 0,73175 kr. Hver del for sig: spot 12,3, moms 14,6 — men
        // totalen er 73,2, så spotrækken tager de 0,1 øre: 12,4 + 7,0 + 5,4 + 33,0 + 0,8 + 14,6 = 73,2.
        let r = try XCTUnwrap(b(price: 0.73175))
        XCTAssertEqual(r.totalTenths, 732)
        XCTAssertEqual(r.rows.map(\.text), ["12,4 øre", "7,0 øre", "5,4 øre", "33,0 øre", "0,8 øre", "14,6 øre"])
        XCTAssertEqual(r.totalText, "0,73 kr/kWh")
    }

    func testRowsAlwaysSumExactlyToTheRoundedTotal() throws {
        var seed: UInt64 = 42
        func next() -> Double {  // deterministisk blanding, ingen tilfældighed i testen
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Double(seed >> 11) / Double(1 << 53)
        }
        for i in 0..<3000 {
            let tariff = next() * 1.2
            let spot = next() * 3 - 0.3  // også negative spotpriser
            let ch = Charges(sys: 0.05 + next() * 0.05, trans: 0.03 + next() * 0.05, afg: next() * 0.02, vat: 0.25)
            let price = (spot + ch.sys + ch.trans + ch.afg + tariff) * 1.25
            for mode in ["net_inkl_alt", "inkl_alt", "spot_inkl"] {
                let p = mode == "spot_inkl" ? spot * 1.25 : price
                let r = try XCTUnwrap(b(mode, price: p, hour: i % 24, charges: ch, tariff: tariff), "case \(i) \(mode)")
                XCTAssertEqual(r.rows.map(\.tenths).reduce(0, +), r.totalTenths, "case \(i) \(mode)")
                XCTAssertEqual(r.totalTenths, Int((p * 1000 + 0.5).rounded(.down)), "case \(i) \(mode)")
                XCTAssertFalse(r.rows.contains { $0.text.contains("NaN") || $0.text.hasPrefix("-0,0") }, "case \(i) \(mode)")
            }
        }
    }

    func testNeverANegativeZero() {
        XCTAssertEqual(tenthsText(0), "0,0")
        XCTAssertEqual(tenthsText(-3), "-0,3")
        XCTAssertEqual(tenthsText(-125), "-12,5")
        XCTAssertEqual(tenthsText(853), "85,3")
        // en spotpris på nul giver rækker på "0,0 øre", aldrig "-0,0 øre"
        let z = b("spot_inkl", price: 0, tariff: nil)
        XCTAssertEqual(z?.rows.map(\.text), ["0,0 øre", "0,0 øre"])
    }

    func testNegativeSpotPriceShowsMinusAndNoBarPiece() throws {
        // spot −0,05: (−0,05 + 0,132 + 0,33) × 1,25 = 0,515
        let r = try XCTUnwrap(b(price: 0.515))
        XCTAssertEqual(r.rows[0].text, "-5,0 øre")
        XCTAssertEqual(r.rows.map(\.tenths).reduce(0, +), r.totalTenths)
        XCTAssertEqual(r.barWeights[0], 0)
        XCTAssertEqual(r.barWeights.reduce(0, +), 1, accuracy: 1e-9)
    }

    func testBarWeightsAreProportionalToTheRows() throws {
        let r = try XCTUnwrap(b())
        XCTAssertEqual(r.barWeights[0], 0.85 / 1.64, accuracy: 1e-9)
        XCTAssertEqual(r.barWeights.reduce(0, +), 1, accuracy: 1e-9)
    }

    func testNetLabelWithoutAName() throws {
        XCTAssertEqual(try XCTUnwrap(b(net: nil)).rows[3].label, "Nettarif (kl. 08)")
        XCTAssertEqual(try XCTUnwrap(b(hour: 17, net: "Trefor Øst")).rows[3].label, "Nettarif (Trefor Øst, kl. 17)")
    }

    // MARK: når der intet er at vise

    func testNoBreakdownWithoutWhatItNeeds() {
        XCTAssertNil(b(charges: nil), "ældre svar uden charges")
        XCTAssertNil(b("spot_inkl", price: 1.05, charges: nil, tariff: nil, net: nil))
        XCTAssertNil(b(price: .nan), "timen har ingen pris")
        XCTAssertNil(b(price: .infinity))
        XCTAssertNil(b(tariff: nil), "net-visning uden nettarif for timen")
        XCTAssertNil(b(tariff: .nan))
        XCTAssertNil(b("spot_ex", price: 0.84, tariff: nil), "ikke en visning, der har en opdeling")
        XCTAssertNil(b(hour: 24))
        XCTAssertNil(b(hour: -1))
    }

    // MARK: valget af time

    private func fixtureDays() -> [Day] {
        let flat = [Double](repeating: 1.64, count: 24)
        let tariff = (0..<24).map { 0.30 + Double($0) * 0.001 }
        return ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"].enumerated().map { i, d in
            Day(date: d, actual: i < 2, price: flat, lo: nil, hi: nil, gridTariff: tariff)
        }
    }

    private func breakdown(_ days: [Day], period: PricePeriod = .five, selected: Int?, now: Int = 8, charges: Charges? = nil) -> PriceBreakdown? {
        let spec = prisChart(period: period, days: days, today: today, now: now)
        return priceBreakdown(mode: "net_inkl_alt", days: days, today: today, now: now, spec: spec, selected: selected,
                              charges: charges ?? self.charges, netName: "N1")
    }

    func testDefaultIsTheCurrentHourOfToday() throws {
        let r = try XCTUnwrap(breakdown(fixtureDays(), selected: nil, now: 8))
        XCTAssertEqual(r.heading, "Sådan er prisen kl. 08 sammensat")
        XCTAssertFalse(r.isSelected)
        XCTAssertEqual(r.rows[3].label, "Nettarif (N1, kl. 08)")
        XCTAssertEqual(r.rows[3].text, "30,8 øre")  // dagens nettarif for kl. 08: 0,308
    }

    func testSelectedBarNamesItsDayLikeTheTooltip() throws {
        let days = fixtureDays()
        let spec = try XCTUnwrap(prisChart(period: .five, days: days, today: today, now: 8))
        // i dag kl. 19, i morgen kl. 13, søn 18. okt kl. 13 (fjerde døgn efter i dag); søjle 0 er kl. 02 (seks timer før kl. 08)
        for (idx, when, hour) in [(19 - 2, "i dag", 19), (24 + 13 - 2, "i morgen", 13), (4 * 24 + 13 - 2, "søn 18. okt", 13)] {
            let r = try XCTUnwrap(breakdown(days, selected: idx))
            XCTAssertEqual(r.heading, "Sådan er prisen \(when) kl. \(pad(hour)) sammensat")
            XCTAssertTrue(r.isSelected)
            XCTAssertEqual(r.rows[3].label, "Nettarif (N1, kl. \(pad(hour)))")
            // samme dag og time som i tippet
            XCTAssertTrue(spec.bars[idx].tip.lowercased().hasPrefix("\(when) kl. \(pad(hour))"), spec.bars[idx].tip)
        }
    }

    func testSelectedBarFromAForecastDayIsLabelledPrognose() throws {
        let r = try XCTUnwrap(breakdown(fixtureDays(), selected: 2 * 24 + 5 - 2))  // fre 16. okt er prognose
        XCTAssertEqual(r.rows[0].label, "Spotpris (prognose)")
        XCTAssertEqual(try XCTUnwrap(breakdown(fixtureDays(), selected: 24 + 5 - 2)).rows[0].label, "Spotpris (Nord Pool)")
    }

    func testSelectionOutsideTheChartFallsBackToNow() throws {
        let r = try XCTUnwrap(breakdown(fixtureDays(), period: .two, selected: 120, now: 9))
        XCTAssertEqual(r.heading, "Sådan er prisen kl. 09 sammensat")
    }

    func testMissingChargesOrTariffGivesNilNotAnEmptyPanel() {
        var days = fixtureDays()
        XCTAssertNil(priceBreakdown(mode: "net_inkl_alt", days: days, today: today, now: 8, spec: nil, selected: nil, charges: nil, netName: "N1"))
        days[0] = Day(date: "2026-10-14", actual: true, price: [Double](repeating: 1.64, count: 24), lo: nil, hi: nil)
        XCTAssertNil(breakdown(days, selected: nil), "dagen har ingen nettarif")
        XCTAssertNil(breakdown(days, selected: 1), "samme døgn, valgt søjle")
        XCTAssertNotNil(breakdown(days, selected: 24 + 3 - 2), "andre døgn har stadig tariffen")
        // ingen døgn for i dag: ingenting at vise
        XCTAssertNil(priceBreakdown(mode: "inkl_alt", days: [], today: today, now: 8, spec: nil, selected: nil, charges: charges, netName: nil))
    }

    func testSpotModeUsesTheSameFieldsFromTheSameResponse() throws {
        let days = fixtureDays().map { Day(date: $0.date, actual: $0.actual, price: $0.price.map { $0 / 1.25 * 0.5 }, lo: nil, hi: nil) }
        let spec = prisChart(period: .two, days: days, today: today, now: 8)
        let r = try XCTUnwrap(priceBreakdown(mode: "spot_inkl", days: days, today: today, now: 8, spec: spec, selected: nil, charges: charges, netName: nil))
        XCTAssertEqual(r.rows.map(\.label), ["Spotpris (Nord Pool)", "Moms (25 %)"])
    }

    func testBarsCarryDateAndDayWords() throws {
        let spec = try XCTUnwrap(prisChart(period: .five, days: fixtureDays(), today: today, now: 8))
        XCTAssertEqual(spec.bars[0].when, "I dag")
        XCTAssertEqual(spec.bars[24 - 2].when, "I morgen")
        XCTAssertEqual(spec.bars[4 * 24 - 2].when, "søn 18. okt")
        XCTAssertEqual(spec.bars[4 * 24 - 2].date, "2026-10-18")
        XCTAssertEqual(breakdownWhen(spec.bars[24 - 2]), "i morgen")
    }

    // MARK: API-felterne

    func testApiParsesChargesAndGridTariffAdditively() throws {
        let tariff = (0..<24).map { 0.1 + Double($0) / 100 }
        let prices = (0..<24).map { ["hour": $0, "price": 1.5] as [String: Any] }
        let json: [String: Any] = [
            "charges": ["sys": 0.07, "trans": 0.054, "afg": 0.008, "vat": 0.25],
            "days": [["date": "2026-10-14", "type": "actual", "prices": prices, "grid_tariff": tariff]],
        ]
        let f = Api.parseForecast(json, area: "DK1", mode: "net_inkl_alt")
        XCTAssertEqual(f.charges, Charges(sys: 0.07, trans: 0.054, afg: 0.008, vat: 0.25))
        XCTAssertEqual(f.days.first?.gridTariff, tariff)
        XCTAssertEqual(f.days.first?.price, [Double](repeating: 1.5, count: 24))
    }

    func testApiWithoutTheNewFieldsStillParses() {
        let prices = (0..<24).map { ["hour": $0, "price": 1.5] as [String: Any] }
        let f = Api.parseForecast(["days": [["date": "2026-10-14", "type": "actual", "prices": prices]]], area: "DK1", mode: "inkl_alt")
        XCTAssertNil(f.charges)
        XCTAssertNil(f.days.first?.gridTariff)
        XCTAssertEqual(f.days.count, 1)
    }

    func testApiRejectsIncompleteChargesAndShortTariffs() {
        XCTAssertNil(Api.parseCharges(["sys": 0.07, "trans": 0.054, "afg": 0.008]))
        XCTAssertNil(Api.parseCharges(["sys": 0.07, "trans": "x", "afg": 0.008, "vat": 0.25]))
        XCTAssertNil(Api.parseCharges(nil))
        XCTAssertNil(Api.parseGridTariff([Double](repeating: 0.3, count: 23)))
        XCTAssertNil(Api.parseGridTariff(["a"] + [Any](repeating: 0.3, count: 23)))
        XCTAssertNil(Api.parseGridTariff(nil))
        XCTAssertEqual(Api.parseGridTariff([Double](repeating: 0.3, count: 24))?.count, 24)
    }
}
