import SwiftUI

struct SettingsScreen: View {
    @Environment(AppModel.self) private var vm
    @Environment(\.openURL) private var openURL

    var body: some View {
        let s = vm.settings
        Adaptive { wide in
            VStack(spacing: 0) {
                ScreenHeader(title: "Indstillinger", subtitle: "Netselskab, prisvisning og udseende")
                if wide {
                    HStack(alignment: .top, spacing: 20) {
                        ScrollView { VStack(spacing: 12) { netCard(s); aboutCard() }.padding(.bottom, 20) }.frame(width: 520)
                        ScrollView { VStack(spacing: 12) { viewCard(s); lookCard(s) }.padding(.bottom, 20) }
                    }
                    .padding(.horizontal, 20)
                } else {
                    ScrollView { VStack(spacing: 10) { netCard(s); viewCard(s); lookCard(s); aboutCard() }.padding(.horizontal, 16).padding(.bottom, 16) }
                }
            }
        }
        .background(T.bg)
    }

    private func netCard(_ s: Settings) -> some View {
        let net = s.net
        return VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Netselskab")
            HStack(spacing: 12) {
                Image(systemName: "mappin.and.ellipse").font(.system(size: 22, weight: .semibold)).foregroundStyle(T.brand)
                    .frame(width: 48, height: 48).background(T.brandSoft, in: Circle())
                VStack(alignment: .leading, spacing: 0) {
                    Text(net.map { "\($0.name) · \($0.areaLabel)" } ?? "Intet netselskab valgt").font(.system(size: 17, weight: .heavy))
                    Text(net != nil ? (s.netHow == "gps" ? "Fundet med din position · gemt på enheden" : "Valgt af dig · gemt på enheden") : "Priserne vises uden nettarif")
                        .font(.system(size: 12.5, weight: .semibold)).foregroundStyle(T.text2)
                }
                Spacer()
                SoftButton(title: "Skift") { vm.openPicker() }
            }
            HStack(spacing: 8) {
                PrimaryButton(title: net != nil ? "Find mit netselskab igen" : "Find mit netselskab", height: 46) { vm.openWelcome() }
                if net != nil { SoftButton(title: "Glem", bg: T.badSoft, fg: T.bad, height: 46) { vm.forget() } }
            }
            if net == nil {
                SectionLabel(text: "Prisområde")
                Segmented(options: ["DK1 Vest", "DK2 Øst"], selected: s.area == "DK1" ? 0 : 1) { s.updateArea($0 == 0 ? "DK1" : "DK2") }
            }
            Text("Vi spørger kun om din position, når du trykker. Vi gemmer svaret — netselskabet — og aldrig koordinaterne.")
                .font(.system(size: 12.5)).lineSpacing(3).foregroundStyle(T.text2)
        }
        .card()
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
                            Text(defs[i].0).font(.system(size: 14.5, weight: .bold)).foregroundStyle(T.text)
                            Text(i == 0 && s.net == nil ? "\(defs[i].1) — vælg først et netselskab" : defs[i].1)
                                .font(.system(size: 12, weight: .semibold)).foregroundStyle(T.text2).multilineTextAlignment(.leading)
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
                .font(.system(size: 12.5, weight: .medium)).lineSpacing(3).foregroundStyle(T.text2)
            HStack(spacing: 8) {
                SoftButton(title: "Privatliv", bg: T.brandSoft, fg: T.brand) { openURL(URL(string: "https://elpriser.org/privatliv")!) }
                SoftButton(title: "elpriser.org", bg: T.brandSoft, fg: T.brand) { openURL(URL(string: "https://elpriser.org")!) }
            }
        }
        .card()
    }
}
