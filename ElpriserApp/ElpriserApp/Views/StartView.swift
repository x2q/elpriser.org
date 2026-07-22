import SwiftUI

struct StartView: View {
    @Bindable var settings: SettingsViewModel
    @State private var locationService = LocationService()
    var onNavigatePrices: ((Area, PriceMode, String?) -> Void)?

    var body: some View {
        ScrollView {
            // Hero header
            VStack(spacing: 12) {
                HStack(spacing: 10) {
                    Text("\u{26A1}")
                        .font(.system(size: 36))
                    Text("Elpris")
                        .font(.system(size: 32, weight: .black))
                        .foregroundStyle(.white)
                }

                Text("Aktuelle elpriser for Danmark — opdateret dagligt fra Energi Data Service")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                // GPS bar
                GPSBar(locationService: locationService) {
                    if let area = locationService.detectedArea {
                        let gln = locationService.detectedNetwork?.gln
                        let mode: PriceMode = gln != nil ? .netInklAlt : .inklAlt
                        settings.area = area
                        settings.mode = mode
                        if let gln { settings.networkGLN = gln }
                        onNavigatePrices?(area, mode, gln)
                    }
                }
                .padding(.top, 8)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 32)
            .background(
                LinearGradient(
                    colors: [Color.brand, Color.brandDark],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )

            VStack(spacing: 20) {
                // Zone cards
                HStack(spacing: 12) {
                    ZoneCard(area: .dk1, onSelect: { mode in
                        onNavigatePrices?(.dk1, mode, nil)
                    })
                    ZoneCard(area: .dk2, onSelect: { mode in
                        onNavigatePrices?(.dk2, mode, nil)
                    })
                }
                .padding(.horizontal)

                // Quick links
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 110))], spacing: 8) {
                    QuickLink(title: "DK1 Vest", icon: "mappin") {
                        onNavigatePrices?(.dk1, .spotInkl, nil)
                    }
                    QuickLink(title: "DK2 Øst", icon: "mappin") {
                        onNavigatePrices?(.dk2, .spotInkl, nil)
                    }
                    QuickLink(title: "Prognose", icon: "chart.line.uptrend.xyaxis") {}
                    QuickLink(title: "Tariffer", icon: "list.bullet") {}
                    QuickLink(title: "Automation", icon: "clock") {}
                }
                .padding(.horizontal)

                // Denmark map
                DenmarkMap()
                    .frame(height: 120)
                    .opacity(0.3)

                // FAQ
                FAQSection()
                    .padding(.horizontal)
            }
            .padding(.top, 16)
            .padding(.bottom, 32)
        }
        .background(Color(.systemGroupedBackground))
    }
}

// MARK: - GPS Bar

private struct GPSBar: View {
    let locationService: LocationService
    let onFound: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "location.fill")
                .font(.subheadline)

            switch locationService.status {
            case .idle:
                Text("Find dit netselskab automatisk")
                    .font(.subheadline)
            case .locating:
                ProgressView()
                    .tint(.white)
                Text("Finder din position...")
                    .font(.subheadline)
            case .lookingUp:
                ProgressView()
                    .tint(.white)
                Text("Slår adresse op...")
                    .font(.subheadline)
            case .found:
                Text(locationService.detectedNetworkName ?? "Fundet")
                    .font(.subheadline)
            case .error:
                Text(locationService.errorMessage ?? "Fejl")
                    .font(.subheadline)
            }

            Spacer()

            if locationService.status == .idle || locationService.status == .error {
                Button("Find mig") {
                    locationService.detect()
                }
                .font(.caption.bold())
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Color.brandAccent)
                .foregroundStyle(.white)
                .clipShape(Capsule())
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.white.opacity(0.15))
        .clipShape(Capsule())
        .foregroundStyle(.white.opacity(0.9))
        .padding(.horizontal)
        .onChange(of: locationService.status) { _, newValue in
            if newValue == .found {
                onFound()
            }
        }
    }
}

// MARK: - Zone Card

private struct ZoneCard: View {
    let area: Area
    let onSelect: (PriceMode) -> Void

    var body: some View {
        VStack(spacing: 10) {
            Text(area.displayName)
                .font(.headline)
                .foregroundStyle(Color.brand)

            VStack(spacing: 6) {
                Button("Elspot inkl moms") { onSelect(.spotInkl) }
                    .buttonStyle(ZoneButtonStyle(isPrimary: true))

                Button("Inkl alt") { onSelect(.inklAlt) }
                    .buttonStyle(ZoneButtonStyle(isAccent: true))

                Button("Spot ex moms") { onSelect(.spotEx) }
                    .buttonStyle(ZoneButtonStyle())
            }
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
    }
}

private struct ZoneButtonStyle: ButtonStyle {
    var isPrimary = false
    var isAccent = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.caption.weight(.medium))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(
                isPrimary ? AnyShapeStyle(Color.brand) :
                isAccent ? AnyShapeStyle(Color.brandAccent) :
                AnyShapeStyle(Color(.systemGray5))
            )
            .foregroundStyle(isPrimary || isAccent ? .white : .primary)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

// MARK: - Quick Link

private struct QuickLink: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.caption)
                Text(title)
                    .font(.caption)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            .overlay(
                RoundedRectangle(cornerRadius: 20)
                    .stroke(Color(.systemGray3), lineWidth: 1)
            )
        }
        .foregroundStyle(.secondary)
    }
}

// MARK: - Denmark Map (simplified SVG-like)

private struct DenmarkMap: View {
    var body: some View {
        HStack(spacing: 20) {
            VStack {
                Circle()
                    .fill(Color.brand.opacity(0.3))
                    .frame(width: 60, height: 80)
                    .overlay(Text("DK1").font(.caption.bold()).foregroundStyle(.white))
            }
            VStack {
                Circle()
                    .fill(Color.brandAccent.opacity(0.3))
                    .frame(width: 40, height: 50)
                    .overlay(Text("DK2").font(.caption.bold()).foregroundStyle(.white))
            }
        }
    }
}

// MARK: - FAQ

private struct FAQSection: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Ofte stillede spørgsmål")
                .font(.headline)

            FAQItem(
                question: "Hvad er elprisen i dag?",
                answer: "Elprisen skifter time for time og fastsættes dagen i forvejen på den nordiske elbørs Nord Pool. Prisen kaldes spotprisen."
            )
            FAQItem(
                question: "Hvad er forskellen på DK1 og DK2?",
                answer: "DK1 dækker Vestdanmark (Jylland og Fyn), DK2 dækker Østdanmark (Sjælland, Lolland-Falster og Bornholm)."
            )
            FAQItem(
                question: "Hvornår er strømmen billigst?",
                answer: "Typisk billigst om natten kl. 00-06 og dyrest kl. 17-21. Den faktiske pris afhænger af vejr, vind og forbrug."
            )
            FAQItem(
                question: "Hvad indgår i den samlede elpris?",
                answer: "Spotpris, nettariffer, systemtarif, transmissionstarif, elafgift og 25% moms."
            )
        }
    }
}

private struct FAQItem: View {
    let question: String
    let answer: String
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack {
                    Text(question)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.primary)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }

            if isExpanded {
                Text(answer)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
            }
        }
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
