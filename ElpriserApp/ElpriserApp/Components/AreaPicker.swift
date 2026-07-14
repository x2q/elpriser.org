import SwiftUI

struct AreaPicker: View {
    @Binding var area: Area

    var body: some View {
        Picker("Priszone", selection: $area) {
            ForEach(Area.allCases) { a in
                Text(a.displayName).tag(a)
            }
        }
    }
}

struct ModePicker: View {
    @Binding var mode: PriceMode
    var showNetworkModes: Bool = true

    var body: some View {
        Picker("Pristype", selection: $mode) {
            ForEach(PriceMode.allCases) { m in
                if showNetworkModes || !m.requiresNetwork {
                    Text(m.displayName).tag(m)
                }
            }
        }
    }
}

struct NetworkPicker: View {
    let area: Area
    @Binding var selectedGLN: String?

    var body: some View {
        let nets = NetworkOperators.forArea(area)
        Picker("Netselskab", selection: $selectedGLN) {
            Text("Vælg netselskab").tag(nil as String?)
            ForEach(nets) { net in
                Text(net.name).tag(net.gln as String?)
            }
        }
    }
}
