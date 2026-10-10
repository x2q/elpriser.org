import XCTest
@testable import Elpriser

/// Checks this app's copies of the shared logic against tests/golden/app-contract.json,
/// the same file the web test and the Android test read. If one of them drifts, its own
/// suite goes red instead of the apps quietly disagreeing about a price or a net.
final class ContractTests: XCTestCase {
    private static let golden: [String: Any] = {
        // …/ElpriserIOS/Tests/ContractTests.swift → …/tests/golden/app-contract.json
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("tests/golden/app-contract.json")
        let data = try! Data(contentsOf: url)
        return try! JSONSerialization.jsonObject(with: data) as! [String: Any]
    }()

    private var g: [String: Any] { Self.golden }
    private func doubles(_ a: Any?) -> [Double] { (a as! [NSNumber]).map(\.doubleValue) }
    private func nullable(_ a: Any?) -> [Double?]? {
        guard let arr = a as? [Any] else { return nil }
        return arr.map { ($0 as? NSNumber)?.doubleValue }
    }

    func testNetListMatchesTheWebList() {
        let nets = g["nets"] as! [[String: Any]]
        XCTAssertEqual(nets.count, Nets.all.count)
        for (n, mine) in zip(nets, Nets.all) {
            XCTAssertEqual(n["name"] as? String, mine.name)
            XCTAssertEqual(n["gln"] as? String, mine.gln)
            XCTAssertEqual(n["area"] as? String, mine.area)
            XCTAssertEqual(n["match"] as? [String], mine.match)
        }
    }

    func testGridCompanyNamesResolveToTheSameNet() {
        for c in g["matchCases"] as! [[String: Any]] {
            let input = c["input"] as? String
            let expect = c["expect"] as? String
            XCTAssertEqual(Nets.match(input)?.name, expect, "match(\(input ?? "nil"))")
        }
    }

    func testCheapestWindowAgrees() {
        for (i, c) in (g["cheapestWindow"] as! [[String: Any]]).enumerated() {
            let w = cheapestWindow(doubles(c["vals"]), c["n"] as! Int, highest: c["highest"] as! Bool)
            let e = c["expect"] as! [String: Any]
            XCTAssertEqual(w.s, e["s"] as? Int, "case \(i) start")
            XCTAssertEqual(w.e, e["e"] as? Int, "case \(i) end")
            XCTAssertEqual(w.avg, (e["avg"] as! NSNumber).doubleValue, accuracy: 1e-9, "case \(i) avg")
            XCTAssertEqual(w.label, e["label"] as? String, "case \(i) label")
        }
    }

    func testVerdictAgrees() {
        for (i, c) in (g["verdict"] as! [[String: Any]]).enumerated() {
            let v = verdict((c["price"] as! NSNumber).doubleValue, doubles(c["vals"]))
            let e = c["expect"] as! [String: Any]
            XCTAssertEqual(v.kind, e["kind"] as? Int, "case \(i) kind")
            XCTAssertEqual(v.label, e["label"] as? String, "case \(i) label")
        }
    }

    func testDayNamesAgree() {
        for c in g["dayNames"] as! [[String: Any]] {
            let d = Day(date: c["date"] as! String, actual: true, price: Array(repeating: 1, count: 24), lo: nil, hi: nil)
            XCTAssertEqual(dayShort(d), c["short"] as? String, c["date"] as! String)
            XCTAssertEqual(dayMonth(d), c["month"] as? String, c["date"] as! String)
            XCTAssertEqual(dayLong(d), c["long"] as? String, c["date"] as! String)
        }
    }

    func testForecastParsingAgrees() {
        let f = g["forecast"] as! [String: Any]
        let parsed = Api.parseForecast(f["response"] as! [String: Any], area: "DK1", mode: "net_inkl_alt")
        let expect = f["expect"] as! [String: Any]
        let days = expect["days"] as! [[String: Any]]
        XCTAssertEqual(parsed.days.count, days.count, "days kept")
        for (e, d) in zip(days, parsed.days) {
            XCTAssertEqual(d.date, e["date"] as? String)
            XCTAssertEqual(d.actual, e["actual"] as? Bool)
            XCTAssertEqual(d.price, doubles(e["price"]))
            if e["lo"] is NSNull {
                XCTAssertNil(d.lo); XCTAssertNil(d.hi)
            } else {
                // The app keeps NaN where the API gave no band for an hour; the contract says null.
                XCTAssertEqual(d.lo?.map { $0.isNaN ? nil : $0 }, nullable(e["lo"]))
                XCTAssertEqual(d.hi?.map { $0.isNaN ? nil : $0 }, nullable(e["hi"]))
            }
        }
        XCTAssertEqual(parsed.model, expect["model"] as? String)
    }

    func testCo2ParsingAgrees() {
        let c = g["co2"] as! [String: Any]
        let parsed = Api.parseCo2(c["response"] as! [String: Any])
        let expect = c["expect"] as! [String: [Int]]
        XCTAssertEqual(Set(parsed.keys), Set(expect.keys))
        for (k, v) in expect { XCTAssertEqual(parsed[k], v, k) }
    }
}
