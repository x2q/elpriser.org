import SwiftUI

struct PriceDetailSheet: View {
    let detail: PriceDetail
    let mode: PriceMode
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Header
                VStack(spacing: 4) {
                    Text("\(detail.date) kl. \(String(format: "%02d", detail.hour)):00-\(String(format: "%02d", (detail.hour + 1) % 24)):00")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Text(formatPrice(detail.price) + " DKK/kWh")
                        .font(.title2.bold())
                }
                .padding()

                Divider()

                // Breakdown
                VStack(spacing: 0) {
                    if mode != .spotEx {
                        breakdownRow("Spotpris", value: "Variabel")
                        if mode != .spotInkl {
                            breakdownRow("Systemtarif", value: "0,0720")
                            breakdownRow("Transmission", value: "0,0430")
                            if mode == .inklAlt || mode == .netInklAlt {
                                breakdownRow("Elafgift", value: "0,0080")
                            }
                            if mode.requiresNetwork {
                                breakdownRow("Nettarif", value: "Variabel")
                            }
                        }
                        breakdownRow("Moms (25%)", value: "Inkluderet")
                    } else {
                        breakdownRow("Spotpris (ex moms)", value: formatPrice(detail.price))
                    }
                }
                .padding()

                Spacer()
            }
            .navigationTitle("Prisdetaljer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func breakdownRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.subheadline.weight(.medium))
                .monospacedDigit()
        }
        .padding(.vertical, 6)
    }

    private func formatPrice(_ p: Double) -> String {
        String(format: "%.4f", p).replacingOccurrences(of: ".", with: ",")
    }
}
