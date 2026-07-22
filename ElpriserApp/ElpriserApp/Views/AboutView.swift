import SwiftUI

struct AboutView: View {
    var body: some View {
        List {
            Section {
                HStack(spacing: 10) {
                    Text("\u{26A1}")
                        .font(.system(size: 32))
                    VStack(alignment: .leading) {
                        Text("Elpris")
                            .font(.title2.bold())
                        Text("elpriser.org")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
                .listRowBackground(Color.clear)
            }

            Section("Hvad er spotpriser?") {
                Text("Aktuelle elpriser (spotpriser) for Danmark hentet fra Energi Data Service. Priserne fastsættes dagen i forvejen p\u{00E5} den nordiske elb\u{00F8}rs Nord Pool.")
                    .foregroundStyle(.secondary)
            }

            Section("Prisomr\u{00E5}der") {
                Label("DK1 = Vestdanmark (Jylland og Fyn)", systemImage: "mappin.circle")
                Label("DK2 = \u{00D8}stdanmark (Sj\u{00E6}lland, Bornholm)", systemImage: "mappin.circle")
            }

            Section("Pristyper") {
                PriceTypeRow(name: "Elspot inkl moms", desc: "Spotpris + 25% moms")
                PriceTypeRow(name: "Inkl alt", desc: "Spot + moms + nettarif + system + transmission + elafgift")
                PriceTypeRow(name: "Inkl alt minus afgift", desc: "Som ovenfor, uden elafgift")
                PriceTypeRow(name: "Netselskab inkl alt", desc: "Med dit netselskabs tarif inkluderet")
            }

            Section("Faste afgifter (2026–2027)") {
                ChargeInfo(label: "Systemtarif", value: "0,0720 DKK/kWh")
                ChargeInfo(label: "Transmissions nettarif", value: "0,0430 DKK/kWh")
                ChargeInfo(label: "Elafgift", value: "0,0080 DKK/kWh")
            }

            Section("Datakilder") {
                Link("Energi Data Service", destination: URL(string: "https://www.energidataservice.dk")!)
                Link("Open-Meteo (vejrdata)", destination: URL(string: "https://open-meteo.com")!)
                Link("DAWA (adresser)", destination: URL(string: "https://dawa.aws.dk")!)
            }

            Section {
                Text("Version 1.0")
                    .foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity)
            }
            .listRowBackground(Color.clear)
        }
    }
}

private struct PriceTypeRow: View {
    let name: String
    let desc: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(name)
            Text(desc).font(.caption).foregroundStyle(.secondary)
        }
    }
}

private struct ChargeInfo: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
            Spacer()
            Text(value)
                .font(.system(.subheadline, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }
}
