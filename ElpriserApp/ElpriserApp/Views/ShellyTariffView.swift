import SwiftUI

struct ShellyTariffView: View {
    @State private var selectedArea: Area = .dk1
    @State private var selectedMode: PriceMode = .inklAlt
    @State private var selectedGLN: String?
    @State private var shellyCloudURL = ""
    @State private var tariffData: ShellyTariffResponse?
    @State private var isLoading = false

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                // Header
                VStack(alignment: .leading, spacing: 2) {
                    Text("Shelly Live Tariff")
                        .font(.headline)
                    Text("Vis aktuelle elpriser direkte p\u{00E5} din Shelly")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal)

                // Intro
                HStack(spacing: 8) {
                    Image(systemName: "info.circle.fill")
                        .foregroundStyle(.blue)
                    Text("Shelly giver dig en unik API-adresse. Et lille script p\u{00E5} din Shelly henter prisen fra elpriser.org \u{00E9}n gang i timen.")
                        .font(.caption)
                }
                .padding()
                .background(Color.blue.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal)

                // Step 1
                StepCard(number: 1, title: "Aktiv\u{00E9}r Live Tariff i Shelly-appen") {
                    VStack(alignment: .leading, spacing: 8) {
                        StepItem(n: 1, text: "\u{00C5}bn Shelly-appen \u{2192} v\u{00E6}lg din enhed")
                        StepItem(n: 2, text: "Tryk p\u{00E5} fanen Electricity Tariff")
                        StepItem(n: 3, text: "Under Tariff \u{2014} skift fra Default til Live")
                        StepItem(n: 4, text: "Kopi\u{00E9}r den lange API URL")
                    }
                }

                // Step 2
                StepCard(number: 2, title: "Lav scriptet") {
                    VStack(spacing: 12) {
                        HStack(spacing: 8) {
                            VStack(alignment: .leading) {
                                Text("Priszone").font(.caption).foregroundStyle(.secondary)
                                Picker("Zone", selection: $selectedArea) {
                                    ForEach(Area.allCases) { a in Text(a.displayName).tag(a) }
                                }
                                .pickerStyle(.menu)
                            }

                            VStack(alignment: .leading) {
                                Text("Pristype").font(.caption).foregroundStyle(.secondary)
                                Picker("Mode", selection: $selectedMode) {
                                    Text("Elspot inkl moms").tag(PriceMode.spotInkl)
                                    Text("Inkl alt").tag(PriceMode.inklAlt)
                                }
                                .pickerStyle(.menu)
                            }
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Din Shelly API URL (valgfri)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            TextField("https://shelly-11-eu.shelly.cloud/v2/...", text: $shellyCloudURL)
                                .font(.system(.caption, design: .monospaced))
                                .textFieldStyle(.roundedBorder)
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                        }

                        CodeBlock(code: generatedScript, language: "javascript")
                    }
                }

                // Step 3
                StepCard(number: 3, title: "Install\u{00E9}r scriptet") {
                    VStack(alignment: .leading, spacing: 8) {
                        StepItem(n: 1, text: "Shelly-appen \u{2192} din enhed \u{2192} Scripts \u{2192} Create Script")
                        StepItem(n: 2, text: "Inds\u{00E6}t scriptet og giv det et navn")
                        StepItem(n: 3, text: "Sl\u{00E5} Run on startup til og tryk Save")
                        StepItem(n: 4, text: "Tryk Start \u{2014} Live Tariff opdateres med det samme")
                    }
                }

                // Live preview
                VStack(alignment: .leading, spacing: 8) {
                    Text("Prisoversigt")
                        .font(.subheadline.weight(.semibold))

                    if isLoading {
                        HStack { Spacer(); ProgressView(); Spacer() }
                            .padding(.vertical, 16)
                    } else if let home = tariffData?.data.viewer.homes.first {
                        ShellyPriceList(entries: home.currentSubscription.priceInfo.today, label: "I dag")
                        if let tomorrow = home.currentSubscription.priceInfo.tomorrow, !tomorrow.isEmpty {
                            ShellyPriceList(entries: tomorrow, label: "I morgen")
                        }
                    }
                }
                .padding()
                .background(Color(.systemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal)
            }
            .padding(.vertical)
        }
        .background(Color(.systemGroupedBackground))
        .onAppear { loadTariff() }
        .onChange(of: selectedArea) { _, _ in loadTariff() }
        .onChange(of: selectedMode) { _, _ in loadTariff() }
    }

    private var generatedScript: String {
        let src = "https://elpriser.org/api/shelly/tariff?area=\(selectedArea.rawValue)&mode=\(selectedMode.rawValue)"
        let cloud = shellyCloudURL.isEmpty ? "INDSÆT_DIN_SHELLY_CLOUD_URL_HER" : shellyCloudURL
        return """
        // Shelly Live Tariff — elpriser.org
        let SRC = "\(src)";
        let DST = "\(cloud)";

        function update() {
          Shelly.call("HTTP.GET", { url: SRC }, function(res) {
            if (!res || res.code !== 200) return;
            Shelly.call("HTTP.POST", {
              url: DST,
              content_type: "application/json",
              body: res.body
            });
          });
        }

        Timer.set(3600000, true, update);
        update();
        """
    }

    private func loadTariff() {
        isLoading = true
        Task {
            do {
                let resp = try await ElpriserAPI.shared.fetchShellyTariff(area: selectedArea, mode: selectedMode, gln: selectedGLN)
                await MainActor.run {
                    self.tariffData = resp
                    self.isLoading = false
                }
            } catch {
                await MainActor.run { self.isLoading = false }
            }
        }
    }
}

private struct StepCard<Content: View>: View {
    let number: Int
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Trin \(number)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color.brand)
                Text(title)
                    .font(.subheadline.weight(.semibold))
            }
            content
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal)
    }
}

private struct StepItem: View {
    let n: Int
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text("\(n)")
                .font(.caption2.bold())
                .foregroundStyle(Color.brand)
                .frame(width: 20, height: 20)
                .background(Color.brand.opacity(0.1))
                .clipShape(Circle())
            Text(text)
                .font(.subheadline)
        }
    }
}

private struct ShellyPriceList: View {
    let entries: [ShellyPriceEntry]
    let label: String

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            let prices = entries.compactMap { $0.total }
            let mn = prices.min() ?? 0
            let mx = prices.max() ?? 1
            let range = (mx == mn) ? mx + 0.01 : mx

            ForEach(entries) { entry in
                HStack {
                    Text(String(format: "%02d:00", entry.hour))
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .frame(width: 44, alignment: .leading)

                    let bg = Color.forPrice(entry.total, min: mn, max: range, isDark: colorScheme == .dark)
                    Text(String(format: "%.2f", entry.total).replacingOccurrences(of: ".", with: ","))
                        .font(.system(.caption, design: .monospaced))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(bg)
                        .clipShape(RoundedRectangle(cornerRadius: 4))

                    if let level = entry.level {
                        Text(level)
                            .font(.system(size: 9))
                            .foregroundStyle(.secondary)
                    }

                    Spacer()
                }
            }
        }
    }
}
