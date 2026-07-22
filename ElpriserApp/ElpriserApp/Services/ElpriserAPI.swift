import Foundation

actor ElpriserAPI {
    static let shared = ElpriserAPI()
    private let baseURL = "https://elpriser.org/api"
    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        self.session = URLSession(configuration: config)
    }

    // MARK: - Prices

    func fetchPrices(area: Area, mode: PriceMode, date: String? = nil, gln: String? = nil) async throws -> PriceResponse {
        var params = ["area": area.rawValue, "mode": mode.rawValue]
        if let date { params["date"] = date }
        if let gln { params["gln"] = gln }
        return try await get("/prices", params: params)
    }

    // MARK: - Schedule

    func fetchSchedule(area: Area, mode: PriceMode, strategy: Strategy, param: Int, date: String? = nil, gln: String? = nil) async throws -> ScheduleResponse {
        var params = ["area": area.rawValue, "mode": mode.rawValue, "strategy": strategy.rawValue]
        params[strategy.paramKey] = String(param)
        if let date { params["date"] = date }
        if let gln { params["gln"] = gln }
        return try await get("/schedule", params: params)
    }

    // MARK: - Forecast

    func fetchForecast(area: Area, mode: PriceMode) async throws -> ForecastResponse {
        let params = ["area": area.rawValue, "mode": mode.rawValue]
        return try await get("/forecast", params: params)
    }

    // MARK: - Now (for automation status)

    func fetchNow(area: Area, mode: PriceMode, strategy: Strategy, hours: Int, gln: String? = nil) async throws -> NowResponse {
        var params = ["area": area.rawValue, "mode": mode.rawValue, "strategy": strategy.rawValue, "hours": String(hours)]
        if let gln { params["gln"] = gln }
        return try await get("/now", params: params)
    }

    // MARK: - Tariffs (all net companies) + Energinet charges

    func fetchAllTariffs() async throws -> TariffRawResponse {
        try await get("/raw/tariffs")
    }

    func fetchEnCharges() async throws -> EnChargesResponse {
        try await get("/raw/encharges")
    }

    // MARK: - Shelly Tariff

    func fetchShellyTariff(area: Area, mode: PriceMode, gln: String? = nil) async throws -> ShellyTariffResponse {
        var params = ["area": area.rawValue, "mode": mode.rawValue]
        if let gln { params["gln"] = gln }
        return try await get("/shelly/tariff", params: params)
    }

    // MARK: - Energi Data Service (direct)

    func fetchEnergyPrices(area: Area, start: String, end: String) async throws -> EnergyDataResponse {
        // Proxied through our own backend (not EDS directly) so this app tracks
        // the same schema/caching/backup guarantees as the web client, instead
        // of duplicating and re-breaking EDS's raw field names independently.
        let params = ["area": area.rawValue, "start": start, "end": end]
        return try await get("/raw/prices", params: params)
    }

    // MARK: - Private

    private func get<T: Decodable>(_ path: String, params: [String: String] = [:]) async throws -> T {
        var components = URLComponents(string: baseURL + path)!
        if !params.isEmpty {
            components.queryItems = params.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else { throw APIError.invalidURL }
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw APIError.serverError((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
}

enum APIError: LocalizedError {
    case invalidURL
    case serverError(Int)
    case decodingError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Ugyldig URL"
        case .serverError(let code): return "Serverfejl (\(code))"
        case .decodingError(let err): return "Data fejl: \(err.localizedDescription)"
        }
    }
}
