import SwiftUI

struct TariffView: View {
    @State private var tariffs: [TariffEntry] = []
    @State private var enCharges: EnCharges?
    @State private var isLoading = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Header
                VStack(alignment: .leading, spacing: 2) {
                    Text("Tariffer (Nettarif C)")
                        .font(.headline)
                    Text("Aktuelle tariffer (DKK/kWh ex moms)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal)

                if isLoading {
                    HStack {
                        Spacer()
                        ProgressView("Henter tariffer...")
                        Spacer()
                    }
                    .padding(.top, 40)
                } else {
                    // Tariff table
                    VStack(spacing: 0) {
                        // Header row
                        HStack {
                            Text("Netselskab")
                                .font(.caption.weight(.semibold))
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Text("Lav\n00-06")
                                .font(.caption2)
                                .multilineTextAlignment(.center)
                                .frame(width: 60)
                            Text("Mellem\n06-17")
                                .font(.caption2)
                                .multilineTextAlignment(.center)
                                .frame(width: 60)
                            Text("Spids\n17-21")
                                .font(.caption2)
                                .multilineTextAlignment(.center)
                                .frame(width: 60)
                        }
                        .padding(.horizontal)
                        .padding(.vertical, 8)
                        .background(Color(.systemGray6))

                        // DK1 section
                        SectionHeader(title: "DK1 Vest")
                        ForEach(tariffEntries(for: .dk1), id: \.gln) { entry in
                            TariffRow(entry: entry)
                        }

                        // DK2 section
                        SectionHeader(title: "DK2 Øst")
                        ForEach(tariffEntries(for: .dk2), id: \.gln) { entry in
                            TariffRow(entry: entry)
                        }

                        // Energinet charges
                        if let en = enCharges {
                            Divider().padding(.vertical, 4)
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Energinet (f\u{00E6}lles for alle)")
                                    .font(.subheadline.weight(.semibold))
                                ChargeRow(label: "Systemtarif", value: en.sys)
                                ChargeRow(label: "Transmissions nettarif", value: en.trans)
                                ChargeRow(label: "Elafgift", value: en.afg)
                            }
                            .padding(.horizontal)
                            .padding(.vertical, 8)
                        }
                    }
                    .background(Color(.systemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal)
                }
            }
            .padding(.vertical)
        }
        .background(Color(.systemGroupedBackground))
        .onAppear { loadTariffs() }
    }

    private func tariffEntries(for area: Area) -> [TariffEntry] {
        let nets = NetworkOperators.forArea(area)
        return nets.map { net in
            // Use placeholder values — would need API call for real tariffs
            TariffEntry(name: net.name, gln: net.gln, low: 0.1013, mid: 0.2211, peak: 0.5896)
        }
    }

    private func loadTariffs() {
        // Set default Energinet charges
        enCharges = EnCharges(sys: 0.072, trans: 0.043, afg: 0.008)
        isLoading = false
    }
}

private struct SectionHeader: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.caption.weight(.bold))
            .foregroundStyle(Color.brand)
            .padding(.horizontal)
            .padding(.top, 12)
            .padding(.bottom, 4)
    }
}

private struct TariffRow: View {
    let entry: TariffEntry

    var body: some View {
        HStack {
            Text(entry.name)
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(formatTariff(entry.low))
                .font(.system(.caption, design: .monospaced))
                .frame(width: 60)
            Text(formatTariff(entry.mid))
                .font(.system(.caption, design: .monospaced))
                .frame(width: 60)
            Text(formatTariff(entry.peak))
                .font(.system(.caption, design: .monospaced))
                .frame(width: 60)
        }
        .padding(.horizontal)
        .padding(.vertical, 6)
    }

    private func formatTariff(_ v: Double) -> String {
        String(format: "%.4f", v).replacingOccurrences(of: ".", with: ",")
    }
}

private struct ChargeRow: View {
    let label: String
    let value: Double

    var body: some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            Text("\(String(format: "%.4f", value).replacingOccurrences(of: ".", with: ",")) DKK/kWh")
                .font(.system(.caption, design: .monospaced))
        }
    }
}
