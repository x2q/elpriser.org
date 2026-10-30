import SwiftUI

struct SettingsScreen: View {
    @Environment(AppModel.self) private var vm
    @Environment(\.openURL) private var openURL

    var body: some View {
        let s = vm.settings
        Adaptive { wide in
            VStack(spacing: 0) {
                if wide {
                    HStack(alignment: .top, spacing: 20) {
                        ScrollView { VStack(spacing: 12) { viewCard(s); aboutCard() }.padding(.bottom, 20) }.frame(width: 520)
                        ScrollView { VStack(spacing: 12) { lookCard(s) }.padding(.bottom, 20) }
                    }
                    .padding(.horizontal, 20)
                } else {
                    ScrollView { VStack(spacing: 10) { viewCard(s); lookCard(s); aboutCard() }.padding(.horizontal, 16).padding(.bottom, 16) }
                }
            }
        }
        .background(T.bg)
        // Åbnes fra stedsarket, så den har en almindelig navigationslinje med tilbage-knap.
        .navigationTitle("Indstillinger")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
    }

    private func viewCard(_ s: Settings) -> some View {
        let defs = [
            ("Samlet pris med netselskab", "Spot, nettarif, afgifter og moms"),
            ("Uden netselskab", "Energinets tariffer, elafgift og moms"),
            ("Spotpris inkl. moms", "Børsprisen, som den er"),
            ("Spotpris ekskl. moms", "Til beregninger og fakturaer"),
        ]
        return VStack(alignment: .leading, spacing: 2) {
            SectionLabel(text: "Prisvisning").padding(.horizontal, 8).padding(.top, 8)
            ForEach(defs.indices, id: \.self) { i in
                Button { s.updateView(i) } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(defs[i].0).font(.app(14.5, .bold)).foregroundStyle(T.text)
                            Text(i == 0 && s.net == nil ? "\(defs[i].1) — vælg først et netselskab" : defs[i].1)
                                .font(.app(12, .semibold)).foregroundStyle(T.text2).multilineTextAlignment(.leading)
                        }
                        Spacer()
                        RadioMark(selected: s.view == i)
                    }
                    .padding(.horizontal, 8).padding(.vertical, 8).frame(minHeight: 54)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(s.view == i ? .isSelected : [])
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(T.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(T.outline, lineWidth: 1))
    }

    private func lookCard(_ s: Settings) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Udseende")
            Segmented(options: ["System", "Lys", "Mørk"], selected: s.theme == "light" ? 1 : s.theme == "dark" ? 2 : 0) {
                s.updateTheme(["system", "light", "dark"][$0])
            }
        }
        .card()
    }

    private func aboutCard() -> some View {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        return VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Om appen")
            Text("Priser fra Energi Data Service og ENTSO-E · prognosen kommer fra en åben model på Hugging Face · elpriser \(v)")
                .font(.app(12.5, .medium)).lineSpacing(3).foregroundStyle(T.text2)
            HStack(spacing: 8) {
                SoftButton(title: "Privatliv", bg: T.brandSoft, fg: T.brand) { openURL(URL(string: "https://elpriser.org/privatliv")!) }
                SoftButton(title: "elpriser.org", bg: T.brandSoft, fg: T.brand) { openURL(URL(string: "https://elpriser.org")!) }
            }
        }
        .card()
    }
}
