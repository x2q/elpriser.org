import Foundation

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
        c.httpAdditionalHeaders = ["User-Agent": "ElpriserIOS/1.0 (+https://elpriser.org)", "Accept": "application/json"]
        return URLSession(configuration: c)
    }()

    private static func get(_ path: String, _ params: [String: String]) async throws -> [String: Any] {
        var comps = URLComponents(string: base + path)!
        comps.queryItems = params.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        let (data, resp) = try await session.data(from: comps.url!)
        guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
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
