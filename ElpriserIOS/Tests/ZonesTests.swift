import XCTest
@testable import Elpriser

/// The zone table, the default zone of a device, the /api/nordic parsing and the days of a feed, all against
/// tests/golden/app-contract.json (the file the web test and the Android tests read as well).
final class ZonesTests: DanishTestCase {
    private let golden = Repo.json("tests/golden/app-contract.json") as! [String: Any]

    private func doubles(_ a: Any?) -> [Double] { (a as! [NSNumber]).map(\.doubleValue) }
    private func nullable(_ a: Any?) -> [Double?]? {
        guard let arr = a as? [Any] else { return nil }
        return arr.map { ($0 as? NSNumber)?.doubleValue }
    }

    // MARK: the table

    func testTableEqualsTheContractRowForRowInOrder() {
        let rows = golden["zones"] as! [[String: Any]]
        XCTAssertEqual(rows.count, 38)
        XCTAssertEqual(Zones.all.count, rows.count)
        for (r, z) in zip(rows, Zones.all) {
            XCTAssertEqual(z.key, r["key"] as? String)
            XCTAssertEqual(z.country, r["country"] as? String, z.key)
            XCTAssertEqual(z.tz, r["tz"] as? String, z.key)
            XCTAssertEqual(z.currency, r["currency"] as? String, z.key)
            XCTAssertEqual(z.sub, r["sub"] as? String, z.key)
            XCTAssertEqual(z.city, r["city"] as? String, z.key)  // NSNull -> nil
        }
    }

    func testEveryTimeZoneIsARealOne() {
        for z in Zones.all { XCTAssertNotNil(TimeZone(identifier: z.tz), z.key); XCTAssertEqual(z.timeZone.identifier, z.tz) }
    }

    func testThirtyCountriesInTableOrderWithTheirZones() {
        let expected = golden["countries"] as! [[String: Any]]
        XCTAssertEqual(Zones.countries.count, 30)
        XCTAssertEqual(Zones.countries, expected.map { $0["country"] as! String })
        for c in expected {
            XCTAssertEqual(Zones.zones(of: c["country"] as! String).map(\.key), c["zones"] as? [String])
        }
        XCTAssertEqual(Zones.zones(of: "no").count, 5, "country codes in any case")
        XCTAssertTrue(Zones.zones(of: "US").isEmpty)
    }

    func testLookupAndDanishZones() {
        XCTAssertEqual(Zones.byKey("DE")?.key, "de")
        XCTAssertEqual(Zones.byKey("it-n")?.country, "IT")
        XCTAssertNil(Zones.byKey("xx"))
        XCTAssertNil(Zones.byKey(nil))
        XCTAssertEqual(Zones.all.filter(\.isDanish).map(\.key), ["dk1", "dk2"])
        XCTAssertTrue(Zones.isDanish("dk2"))
        XCTAssertFalse(Zones.isDanish("no1"))
    }

    func testFallbackRatesEqualTheContract() {
        let fx = golden["fxFallback"] as! [String: NSNumber]
        XCTAssertEqual(Zones.fxFallback.keys.sorted(), fx.keys.sorted())
        for (k, v) in fx { XCTAssertEqual(Zones.fxFallback[k]!, v.doubleValue, accuracy: 1e-12, k) }
    }

    // MARK: the zone a device starts on

    func testDefaultZoneForEveryCaseInTheContract() {
        for c in golden["defaultZone"] as! [[String: Any]] {
            let region = c["region"] as? String, language = c["language"] as? String
            XCTAssertEqual(Zones.defaultFor(region: region, language: language).key, c["expect"] as? String,
                           "region \(region ?? "nil") language \(language ?? "nil")")
        }
    }

    func testEveryRegionAndLanguageOfTheContractMapsToItsZone() {
        for (r, z) in golden["regionZone"] as! [String: String] { XCTAssertEqual(Zones.defaultFor(region: r, language: nil).key, z, r) }
        for (l, z) in golden["languageZone"] as! [String: String] { XCTAssertEqual(Zones.defaultFor(region: nil, language: l).key, z, l) }
        XCTAssertEqual(Zones.fallbackKey, golden["fallbackZone"] as? String)
    }

    func testDefaultZoneFromALocale() {
        XCTAssertEqual(Zones.defaultFor(locale: Locale(identifier: "da_DK")).key, "dk1")
        XCTAssertEqual(Zones.defaultFor(locale: Locale(identifier: "de_AT")).key, "at")
        XCTAssertEqual(Zones.defaultFor(locale: Locale(identifier: "en_GB")).key, "de", "an English phone outside the table: Germany")
        XCTAssertEqual(Zones.defaultFor(locale: Locale(identifier: "fr_LU")).key, "de", "Luxembourg shares DE-LU")
        XCTAssertEqual(Zones.defaultFor(locale: Locale(identifier: "nb_NO")).key, "no1")
        XCTAssertEqual(Zones.defaultFor(locale: Locale(identifier: "sr-Latn_RS")).key, "rs")
        XCTAssertEqual(Zones.defaultFor(locale: Locale(identifier: "ja_JP")).key, "de")
        // region wins over language: German speakers in Denmark are on DK1
        XCTAssertEqual(Zones.defaultFor(locale: Locale(identifier: "de_DK")).key, "dk1")
    }

    func testDeviceCountryOnlyWhenTheAppHasAZoneForIt() {
        XCTAssertEqual(Zones.deviceCountry(locale: Locale(identifier: "pl_PL")), "PL")
        XCTAssertNil(Zones.deviceCountry(locale: Locale(identifier: "en_US")))
        XCTAssertNil(Zones.deviceCountry(locale: Locale(identifier: "fr_LU")), "Luxembourg has no row of its own")
    }

    // MARK: names and labels

    func testCountryNamesAreLocalizedByTheLanguageOfTheTexts() {
        let cases: [(String, String, String)] = [
            ("da", "DE", "Tyskland"), ("en", "DE", "Germany"), ("de", "DE", "Deutschland"), ("de", "AT", "Österreich"),
            ("fr", "DK", "Danemark"), ("pl", "DE", "Niemcy"), ("sv", "FI", "Finland"), ("nb", "SE", "Sverige"),
        ]
        for (lang, code, name) in cases {
            L10n.language = lang
            XCTAssertEqual(Zones.countryName(code), name, "\(lang) \(code)")
        }
        L10n.language = "da"
        for c in Zones.countries { XCTAssertNotEqual(Zones.countryName(c), c, "\(c) has a name") }
    }

    func testChipLabelIsKeyAndCityWhereThereIsACityElseTheCountry() {
        XCTAssertEqual(Zones.byKey("no1")!.chipLabel, "NO1 · Oslo")
        XCTAssertEqual(Zones.byKey("se4")!.chipLabel, "SE4 · Malmö")
        XCTAssertEqual(Zones.byKey("de")!.chipLabel, "Tyskland")
        L10n.language = "en"
        XCTAssertEqual(Zones.byKey("de")!.chipLabel, "Germany")
        XCTAssertEqual(Zones.byKey("it-n")!.chipLabel, "Italy")
    }

    func testOnlyGermanyAndNorthItalyCarryANote() {
        XCTAssertEqual(Zones.all.compactMap { $0.noteKey != nil ? $0.key : nil }, ["de", "it-n"])
        XCTAssertEqual(L10n.string(Zones.byKey("de")!.noteKey!), "Tyskland og Luxembourg har fælles prisområde (DE-LU).")
    }

    // MARK: /api/nordic

    func testParseZoneAgreesWithEveryContractResponse() {
        let cases = golden["zoneResponses"] as! [[String: Any]]
        XCTAssertEqual(cases.count, 3)
        for c in cases {
            let resp = c["response"] as! [String: Any]
            let expect = c["expect"] as! [String: Any]
            let key = expect["zone"] as! String
            let f = Api.parseZone(resp, zone: Zones.byKey(key)!)
            let days = expect["days"] as! [[String: Any]]
            XCTAssertEqual(f.days.count, days.count, "\(key): days kept")
            XCTAssertEqual(f.mode, "zone")
            XCTAssertEqual(f.area, key.uppercased())
            XCTAssertNil(f.charges)
            for (e, d) in zip(days, f.days) {
                XCTAssertEqual(d.date, e["date"] as? String, key)
                XCTAssertEqual(d.actual, e["actual"] as? Bool, "\(key) \(d.date)")
                let want = doubles(e["price"])
                XCTAssertEqual(d.price.count, 24)
                for h in 0..<24 { XCTAssertEqual(d.price[h], want[h], accuracy: 1e-6, "\(key) \(d.date) h\(h)") }
                if e["lo"] is NSNull {
                    XCTAssertNil(d.lo, "\(key) \(d.date)"); XCTAssertNil(d.hi)
                } else {
                    let lo = nullable(e["lo"])!, hi = nullable(e["hi"])!
                    for h in 0..<24 {
                        // the app keeps NaN where the API gave no band for an hour; the contract says null
                        if let want = lo[h] { XCTAssertEqual(d.lo![h], want, accuracy: 1e-6, "\(key) \(d.date) lo h\(h)") }
                        else { XCTAssertTrue(d.lo![h].isNaN, "\(key) \(d.date) lo h\(h)") }
                        if let want = hi[h] { XCTAssertEqual(d.hi![h], want, accuracy: 1e-6, "\(key) \(d.date) hi h\(h)") }
                        else { XCTAssertTrue(d.hi![h].isNaN, "\(key) \(d.date) hi h\(h)") }
                    }
                }
            }
        }
    }

    func testParseZoneRulesInWords() {
        let cases = golden["zoneResponses"] as! [[String: Any]]
        let no = Api.parseZone(cases[0]["response"] as! [String: Any], zone: Zones.byKey("no1")!)
        // 23 and 25 hours are not days; a forecast day carries a band, a settled one does not
        XCTAssertEqual(no.days.map(\.date), ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-14"])
        XCTAssertEqual(no.days[1].price[0], 65.04, accuracy: 1e-9, "60 EUR/MWh x 10,84 / 10 = 65,04 øre/kWh")
        XCTAssertTrue(no.days[1].actual); XCTAssertFalse(no.days[2].actual)
        XCTAssertNil(no.days[1].lo); XCTAssertNotNil(no.days[2].lo)
        let de = Api.parseZone(cases[1]["response"] as! [String: Any], zone: Zones.byKey("de")!)
        XCTAssertEqual(de.days[0].price[0], -1.25, accuracy: 1e-9, "a negative price stays negative")
        let pl = Api.parseZone(cases[2]["response"] as! [String: Any], zone: Zones.byKey("pl")!)
        XCTAssertEqual(pl.days[0].price[0], 39.51, accuracy: 1e-9, "no rate in zoneInfo: the ECB fallback for PLN (4,39)")
    }

    func testParseZoneWithoutAnythingUsable() {
        let z = Zones.byKey("fi")!
        XCTAssertTrue(Api.parseZone([:], zone: z).days.isEmpty)
        XCTAssertTrue(Api.parseZone(["days": [["date": "2026-10-10", "type": "actual", "prices": []]]], zone: z).days.isEmpty)
        // a null price in one hour: the day is dropped
        var prices = (0..<24).map { ["hour": $0, "eur_mwh": 50.0] as [String: Any] }
        prices[5] = ["hour": 5, "eur_mwh": NSNull()]
        XCTAssertTrue(Api.parseZone(["days": [["date": "2026-10-10", "type": "actual", "prices": prices]]], zone: z).days.isEmpty)
        // a rate of zero or less is no rate: the fallback (EUR: 1)
        let ok = (0..<24).map { ["hour": $0, "eur_mwh": 50.0] as [String: Any] }
        let f = Api.parseZone(["zoneInfo": ["currency": "EUR", "rate": 0], "days": [["date": "2026-10-10", "type": "forecast", "prices": ok]]], zone: z)
        XCTAssertEqual(f.days.first?.price[0] ?? 0, 5, accuracy: 1e-9)
        XCTAssertEqual(f.days.first?.actual, false)
    }

    func testDaysFromAgreesWithTheContract() {
        for c in golden["zoneDays"] as! [[String: Any]] {
            let days = (c["dates"] as! [String]).map { Day(date: $0, actual: true, price: [Double](repeating: 1, count: 24), lo: nil, hi: nil) }
            XCTAssertEqual(Api.daysFrom(days, today: c["today"] as! String).map(\.date), c["expect"] as? [String], "\(c["dates"]!)")
        }
    }

    func testDaysFromSortsAndCrossesMonthAndYearEnds() {
        func d(_ s: String) -> Day { Day(date: s, actual: true, price: [], lo: nil, hi: nil) }
        XCTAssertEqual(Api.daysFrom([d("2027-01-01"), d("2026-12-31"), d("2026-12-30")], today: "2026-12-31").map(\.date), ["2026-12-31", "2027-01-01"])
        XCTAssertEqual(Api.daysFrom([d("2026-03-01"), d("2026-02-28")], today: "2026-02-28").map(\.date), ["2026-02-28", "2026-03-01"])
        XCTAssertTrue(Api.daysFrom([], today: "2026-10-10").isEmpty)
        XCTAssertTrue(Api.daysFrom([d("2026-10-10")], today: "not a date").isEmpty)
    }
}
