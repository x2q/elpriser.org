import Foundation
import CoreLocation

@Observable
class LocationService: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()

    var status: LocationStatus = .idle
    var detectedArea: Area?
    var detectedNetwork: NetworkOperator?
    var detectedNetworkName: String?
    var errorMessage: String?

    enum LocationStatus {
        case idle, locating, lookingUp, found, error
    }

    override init() {
        super.init()
        manager.delegate = self
    }

    func detect() {
        status = .locating
        errorMessage = nil
        detectedArea = nil
        detectedNetwork = nil
        manager.requestWhenInUseAuthorization()
        manager.requestLocation()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.first else { return }
        Task {
            await lookupNetwork(lat: loc.coordinate.latitude, lng: loc.coordinate.longitude)
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let clError = error as? CLError
        status = .error
        if clError?.code == .denied {
            errorMessage = "Lokation nægtet"
        } else if clError?.code == .locationUnknown {
            errorMessage = "Position ikke tilgængelig"
        } else {
            errorMessage = error.localizedDescription
        }
    }

    private func lookupNetwork(lat: Double, lng: Double) async {
        status = .lookingUp
        do {
            // Step 1: Reverse geocode via DAWA
            let dawaURL = URL(string: "https://dawa.aws.dk/adgangsadresser/reverse?x=\(lng)&y=\(lat)&srid=4326")!
            let (dawaData, _) = try await URLSession.shared.data(from: dawaURL)
            let dawa = try JSONDecoder().decode(DAWAResponse.self, from: dawaData)
            let address = dawa.adressebetegnelse

            // Step 2: Lookup network operator
            let netURL = URL(string: "https://api.elnet.greenpowerdenmark.dk/api/supplierlookup/\(address.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? address)")!
            let (netData, _) = try await URLSession.shared.data(from: netURL)
            let netResult = try JSONDecoder().decode(SupplierLookup.self, from: netData)

            // Step 3: Match to known network
            let matched = matchNetwork(name: netResult.name)
            await MainActor.run {
                if let matched {
                    self.detectedArea = matched.area
                    self.detectedNetwork = matched.net
                    self.detectedNetworkName = matched.net.name
                } else {
                    // Fallback: determine area by longitude
                    self.detectedArea = lng > 11.0 ? .dk2 : .dk1
                    self.detectedNetworkName = netResult.name
                }
                self.status = .found
            }
        } catch {
            await MainActor.run {
                self.status = .error
                self.errorMessage = "Kunne ikke finde netselskab"
            }
        }
    }

    private func matchNetwork(name: String) -> (area: Area, net: NetworkOperator)? {
        let lower = name.lowercased()
        let allNets: [(Area, [NetworkOperator])] = [(.dk1, NetworkOperators.dk1), (.dk2, NetworkOperators.dk2)]
        for (area, nets) in allNets {
            for net in nets {
                if lower.contains(net.name.lowercased()) {
                    return (area, net)
                }
            }
        }
        return nil
    }
}

private struct DAWAResponse: Codable {
    let adressebetegnelse: String
}

private struct SupplierLookup: Codable {
    let name: String
}
