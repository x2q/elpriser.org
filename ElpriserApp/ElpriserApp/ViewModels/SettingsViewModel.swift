import Foundation
import SwiftUI

@Observable
class SettingsViewModel {
    var area: Area {
        didSet { UserDefaults.standard.set(area.rawValue, forKey: "selectedArea") }
    }
    var mode: PriceMode {
        didSet { UserDefaults.standard.set(mode.rawValue, forKey: "selectedMode") }
    }
    var networkGLN: String? {
        didSet { UserDefaults.standard.set(networkGLN, forKey: "selectedGLN") }
    }

    var selectedNetwork: NetworkOperator? {
        guard let gln = networkGLN else { return nil }
        return NetworkOperators.forArea(area).first(where: { $0.gln == gln })
    }

    init() {
        let areaStr = UserDefaults.standard.string(forKey: "selectedArea") ?? "DK1"
        self.area = Area(rawValue: areaStr) ?? .dk1
        let modeStr = UserDefaults.standard.string(forKey: "selectedMode") ?? "inkl_alt"
        self.mode = PriceMode(rawValue: modeStr) ?? .inklAlt
        self.networkGLN = UserDefaults.standard.string(forKey: "selectedGLN")
    }
}
