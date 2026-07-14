import SwiftUI

struct AboutView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Header
                HStack(spacing: 10) {
                    Text("\u{26A1}")
                        .font(.system(size: 32))
                    VStack(alignment: .leading) {
                        Text("Om Elpris")
                            .font(.title2.bold())
                        Text("elpriser.org")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.bottom, 8)

                InfoSection(title: "Hvad er spotpriser?") {
                    Text("Aktuelle elpriser (spotpriser) for Danmark hentet fra Energi Data Service. Priserne fastsættes dagen i forvejen p\u{00E5} den nordiske elb\u{00F8}rs Nord Pool.")
                }

                InfoSection(title: "Prisomr\u{00E5}der") {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("DK1 = Vestdanmark (Jylland og Fyn)", systemImage: "mappin.circle")
                        Label("DK2 = \u{00D8}stdanmark (Sj\u{00E6}lland, Bornholm)", systemImage: "mappin.circle")
                    }
                    .font(.subheadline)
                }

                InfoSection(title: "Pristyper") {
                    VStack(alignment: .leading, spacing: 6) {
                        PriceTypeRow(name: "Elspot inkl moms", desc: "Spotpris + 25% moms")
                        PriceTypeRow(name: "Inkl alt", desc: "Spot + moms + nettarif + system + transmission + elafgift")
                        PriceTypeRow(name: "Inkl alt minus afgift", desc: "Som ovenfor, uden elafgift")
                        PriceTypeRow(name: "Netselskab inkl alt", desc: "Med dit netselskabs tarif inkluderet")
                    }
                }

                InfoSection(title: "Faste afgifter (2025)") {
                    VStack(alignment: .leading, spacing: 4) {
                        ChargeInfo(label: "Systemtarif", value: "0,0720 DKK/kWh")
                        ChargeInfo(label: "Transmissions nettarif", value: "0,0430 DKK/kWh")
                        ChargeInfo(label: "Elafgift", value: "0,0080 DKK/kWh")
                    }
                }

                InfoSection(title: "Datakilder") {
                    VStack(alignment: .leading, spacing: 4) {
                        Link("Energi Data Service", destination: URL(string: "https://www.energidataservice.dk")!)
                        Link("Open-Meteo (vejrdata)", destination: URL(string: "https://open-meteo.com")!)
                        Link("DAWA (adresser)", destination: URL(string: "https://dawa.aws.dk")!)
                    }
                    .font(.subheadline)
                }

                Spacer(minLength: 20)

                Text("Version 1.0")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity)
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
    }
}

private struct InfoSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
            content
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

private struct PriceTypeRow: View {
    let name: String
    let desc: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(name).font(.subheadline.weight(.medium)).foregroundStyle(.primary)
            Text(desc).font(.caption).foregroundStyle(.secondary)
        }
    }
}

private struct ChargeInfo: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label).font(.subheadline)
            Spacer()
            Text(value).font(.system(.caption, design: .monospaced))
        }
    }
}
