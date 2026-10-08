import CoreLocation

/// Henter positionen én gang, når brugeren trykker. Intet kører i baggrunden, og intet gemmes.
@MainActor
final class PositionFinder: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var authContinuation: CheckedContinuation<Void, Never>?
    private var locationContinuation: CheckedContinuation<CLLocation?, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    private var allowed: Bool {
        manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways
    }

    /// Spørger om tilladelse første gang og returnerer så positionen — eller nil, hvis den afvises eller ikke kan findes.
    func current() async -> CLLocation? {
        if manager.authorizationStatus == .notDetermined {
            await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
                authContinuation = c
                manager.requestWhenInUseAuthorization()
            }
        }
        guard allowed else { return nil }
        return await withCheckedContinuation { (c: CheckedContinuation<CLLocation?, Never>) in
            locationContinuation = c
            manager.requestLocation()
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(12))
                self.finish(nil)
            }
        }
    }

    private func finish(_ loc: CLLocation?) {
        locationContinuation?.resume(returning: loc)
        locationContinuation = nil
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            if manager.authorizationStatus != .notDetermined {
                authContinuation?.resume()
                authContinuation = nil
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let first = locations.first
        Task { @MainActor in finish(first) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in finish(nil) }
    }
}
