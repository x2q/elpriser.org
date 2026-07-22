import SwiftUI

struct TariffView: View {
    @State private var tariffs: [TariffEntry] = []
    @State private var enCharges: EnCharges?
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Henter tariffer...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error {
                ErrorStateView(message: error, retry: loadTariffs)
            } else {
                List {
                    Section {
                        HStack {
                            Text("Netselskab")
                            Spacer()
                            Text("Lav").frame(width: 56, alignment: .trailing)
                            Text("Mellem").frame(width: 56, alignment: .trailing)
                            Text("Spids").frame(width: 56, alignment: .trailing)
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }

                    Section("DK1 Vest") {
                        ForEach(tariffs.filter { entry in NetworkOperators.dk1.contains { $0.gln == entry.gln } }, id: \.gln) { entry in
                            TariffRow(entry: entry)
                        }
                    }

                    Section("DK2 \u{00D8}st") {
                        ForEach(tariffs.filter { entry in NetworkOperators.dk2.contains { $0.gln == entry.gln } }, id: \.gln) { entry in
                            TariffRow(entry: entry)
                        }
                    }

                    if let en = enCharges {
                        Section {
                            ChargeRow(label: "Systemtarif", value: en.sys)
                            ChargeRow(label: "Transmissions nettarif", value: en.trans)
                            ChargeRow(label: "Elafgift", value: en.afg)
                        } header: {
                            Text("Energinet (f\u{00E6}lles for alle)")
                        } footer: {
                            Text("Nettarif C, DKK/kWh ekskl. moms. Lav = 00-06, Mellem = 06-17, Spids = 17-21.")
                        }
                    }
                }
            }
        }
        .onAppear { loadTariffs() }
    }

    private func loadTariffs() {
        isLoading = true
        error = nil
        Task {
            do {
                async let tariffsResp = ElpriserAPI.shared.fetchAllTariffs()
                async let chargesResp = ElpriserAPI.shared.fetchEnCharges()
                let (t, c) = try await (tariffsResp, chargesResp)

                let today = Date().dateString
                var entries: [TariffEntry] = []
                for net in NetworkOperators.dk1 + NetworkOperators.dk2 {
                    guard let record = t.records
                        .filter({ $0.glnNumber == net.gln && $0.resolutionDuration == "PT1H" })
                        .filter({ $0.validFrom.prefix(10) <= today && ($0.validTo.map { $0.prefix(10) > today } ?? true) })
                        .first
                    else { continue }

                    let low = Array(record.hourly[0..<6]).reduce(0, +) / 6
                    let mid = Array(record.hourly[6..<17]).reduce(0, +) / 11
                    let peak = Array(record.hourly[17..<21]).reduce(0, +) / 4
                    entries.append(TariffEntry(name: net.name, gln: net.gln, low: low, mid: mid, peak: peak))
                }

                await MainActor.run {
                    self.tariffs = entries
                    self.enCharges = c.resolved()
                    self.isLoading = false
                }
            } catch {
                await MainActor.run {
                    self.error = error.localizedDescription
                    self.isLoading = false
                }
            }
        }
    }
}

private struct TariffRow: View {
    let entry: TariffEntry

    var body: some View {
        HStack {
            Text(entry.name)
            Spacer()
            Text(formatTariff(entry.low)).frame(width: 56, alignment: .trailing)
            Text(formatTariff(entry.mid)).frame(width: 56, alignment: .trailing)
            Text(formatTariff(entry.peak)).frame(width: 56, alignment: .trailing)
        }
        .font(.system(.subheadline, design: .monospaced))
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
            Spacer()
            Text("\(String(format: "%.4f", value).replacingOccurrences(of: ".", with: ",")) DKK/kWh")
                .font(.system(.subheadline, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }
}
