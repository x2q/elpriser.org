import Foundation

/// A non-2xx answer. 404 from /api/nordic means the zone has no prices (yet).
enum ApiError: Error, Equatable { case status(Int) }

/// Klient til elpriser.org's åbne API (samme endpoints som Android-appen).
enum Api {
    #if DEBUG
    /// Kun til skærmbilleder: -debugApiBase http://127.0.0.1:8787/api peger på en lokal kopi af API'et.
    private static let base = UserDefaults.standard.string(forKey: "debugApiBase") ?? "https://elpriser.org/api"
    #else
    private static let base = "https://elpriser.org/api"
    #endif
    private static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 25
        // Versionen står i User-Agent, så serveren kan tælle kald pr. version (ingen id, se functions/_usage.js).
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "0"
        c.httpAdditionalHeaders = ["User-Agent": "ElpriserIOS/\(version) (\(build)) (+https://elpriser.org)", "Accept": "application/json"]
        return URLSession(configuration: c)
    }()

    private static func get(_ path: String, _ params: [String: String]) async throws -> [String: Any] {
        var comps = URLComponents(string: base + path)!
        comps.queryItems = params.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        let (data, resp) = try await session.data(from: comps.url!)
        guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            if let http = resp as? HTTPURLResponse { throw ApiError.status(http.statusCode) }
            throw URLError(.badServerResponse)
        }
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw URLError(.cannotParseResponse) }
        return obj
    }

    /// 10 døgn: faktiske børspriser, og så prognosen med P10/P90 på de døgn, der ikke er offentliggjort.
    static func forecast(area: String, mode: String, gln: String?) async throws -> Forecast {
        var params = ["area": area, "mode": mode]
        if let gln, mode.hasPrefix("net_") { params["gln"] = gln }
        return parseForecast(try await get("/forecast", params), area: area, mode: mode)
    }

    /// A zone outside Denmark: the day-ahead price per hour (EUR/MWh) with the zone's currency rate, settled days first, then the
    /// model forecast where the zone has one. Prices come back in the zone's sub-unit per kWh.
    static func zone(_ zone: Zone) async throws -> Forecast {
        parseZone(try await get("/nordic", ["zone": zone.key]), zone: zone)
    }

    /// /api/nordic -> Forecast. Only complete days count (24 hours with a price); prices are EUR/MWh x rate / 10, the zone's
    /// sub-unit per kWh; the rate is zoneInfo.rate when it is above zero, else the ECB fallback for the currency; the band comes
    /// from min_eur_mwh / max_eur_mwh when both are there; `actual` from the day's type. Same rules as tests/golden/zones.mjs.
    static func parseZone(_ j: [String: Any], zone: Zone) -> Forecast {
        let info = j["zoneInfo"] as? [String: Any]
        let currency = (info?["currency"] as? String) ?? zone.currency
        let given = (info?["rate"] as? NSNumber)?.doubleValue ?? 0
        let rate = given > 0 ? given : (Zones.fxFallback[currency] ?? 1)
        var out: [Day] = []
        for d in (j["days"] as? [[String: Any]]) ?? [] {
            guard let date = d["date"] as? String, let type = d["type"] as? String else { continue }
            var price = [Double](repeating: .nan, count: 24)
            var lo = [Double](repeating: .nan, count: 24)
            var hi = [Double](repeating: .nan, count: 24)
            var band = false
            for p in (d["prices"] as? [[String: Any]]) ?? [] {
                guard let h = (p["hour"] as? NSNumber)?.intValue, (0..<24).contains(h),
                      let v = (p["eur_mwh"] as? NSNumber)?.doubleValue else { continue }
                price[h] = v * rate / 10
                if let a = (p["min_eur_mwh"] as? NSNumber)?.doubleValue, let b = (p["max_eur_mwh"] as? NSNumber)?.doubleValue {
                    lo[h] = a * rate / 10; hi[h] = b * rate / 10; band = true
                }
            }
            if price.contains(where: { $0.isNaN }) { continue }
            out.append(Day(date: date, actual: type == "actual", price: price, lo: band ? lo : nil, hi: band ? hi : nil))
        }
        return Forecast(area: zone.key.uppercased(), mode: "zone", days: out, model: nil, charges: nil)
    }

    /// The days from `today` on, consecutive: the feed opens on yesterday, and a hole must not close up (that would put
    /// "tomorrow" on the wrong date). No `today` in the feed gives nothing.
    static func daysFrom(_ days: [Day], today: String) -> [Day] {
        var out: [Day] = []
        guard let base = dayNumber(today) else { return [] }
        for d in days.filter({ $0.date >= today }).sorted(by: { $0.date < $1.date }) {
            guard dayNumber(d.date) == base + out.count else { break }
            out.append(d)
        }
        return out
    }

    /// Calendar days since 1970-01-01 of a "YYYY-MM-DD" date, independent of any time zone.
    private static func dayNumber(_ s: String) -> Int? {
        let p = s.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        guard let d = c.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12)) else { return nil }
        return Int((d.timeIntervalSince1970 / 86400).rounded(.down))
    }

    /// Kun hele døgn (24 timepriser) tæller; båndet P10/P90 er valgfrit. Adskilt fra netværket, så det kan enhedstestes.
    static func parseForecast(_ j: [String: Any], area: String, mode: String) -> Forecast {
        var out: [Day] = []
        for d in (j["days"] as? [[String: Any]]) ?? [] {
            guard let date = d["date"] as? String, let type = d["type"] as? String else { continue }
            var price = [Double](repeating: .nan, count: 24)
            var lo = [Double](repeating: .nan, count: 24)
            var hi = [Double](repeating: .nan, count: 24)
            var band = false
            for p in (d["prices"] as? [[String: Any]]) ?? [] {
                guard let h = p["hour"] as? Int, (0..<24).contains(h), let v = (p["price"] as? NSNumber)?.doubleValue else { continue }
                price[h] = v
                if let a = (p["min"] as? NSNumber)?.doubleValue, let b = (p["max"] as? NSNumber)?.doubleValue {
                    lo[h] = a; hi[h] = b; band = true
                }
            }
            if price.contains(where: { $0.isNaN }) { continue }
            out.append(Day(date: date, actual: type == "actual", price: price, lo: band ? lo : nil, hi: band ? hi : nil,
                           gridTariff: parseGridTariff(d["grid_tariff"])))
        }
        let model = (j["model"] as? [String: Any])?["name"] as? String
        return Forecast(area: area, mode: mode, days: out, model: model, charges: parseCharges(j["charges"]))
    }

    /// `charges {sys, trans, afg, vat}` øverst i svaret. Mangler et af tallene (eller er svaret ældre), er der ingen afgifter.
    static func parseCharges(_ v: Any?) -> Charges? {
        guard let o = v as? [String: Any],
              let sys = (o["sys"] as? NSNumber)?.doubleValue, let trans = (o["trans"] as? NSNumber)?.doubleValue,
              let afg = (o["afg"] as? NSNumber)?.doubleValue, let vat = (o["vat"] as? NSNumber)?.doubleValue,
              [sys, trans, afg, vat].allSatisfy({ $0.isFinite }), vat >= 0 else { return nil }
        return Charges(sys: sys, trans: trans, afg: afg, vat: vat)
    }

    /// `days[].grid_tariff`: præcis 24 tal, ellers ingen.
    static func parseGridTariff(_ v: Any?) -> [Double]? {
        guard let a = v as? [Any], a.count == 24 else { return nil }
        let nums = a.compactMap { ($0 as? NSNumber)?.doubleValue }
        return nums.count == 24 && nums.allSatisfy({ $0.isFinite }) ? nums : nil
    }

    /// CO₂ i g/kWh pr. time, pr. dato.
    static func co2(area: String) async throws -> [String: [Int]] {
        parseCo2(try await get("/raw/co2", ["area": area]))
    }

    /// Kun datoer med alle 24 timer.
    static func parseCo2(_ j: [String: Any]) -> [String: [Int]] {
        var byDate: [String: [Int]] = [:]
        for r in (j["records"] as? [[String: Any]]) ?? [] {
            guard let date = r["date"] as? String, let h = r["hour"] as? Int, (0..<24).contains(h),
                  let g = (r["co2"] as? NSNumber)?.intValue else { continue }
            var arr = byDate[date] ?? [Int](repeating: -1, count: 24)
            arr[h] = g
            byDate[date] = arr
        }
        return byDate.filter { !$0.value.contains(-1) }
    }

    /// Netselskabet for en position. Positionen sendes kun hertil og gemmes hverken her eller i appen.
    static func lookup(lat: Double, lng: Double) async throws -> LookupResult {
        let j = try await get("/supplierlookup", ["lat": String(format: "%.5f", lat), "lng": String(format: "%.5f", lng)])
        return LookupResult(name: j["name"] as? String, error: j["error"] as? String)
    }
}
