import SwiftUI

struct PriceDetailSheet: View {
    let detail: PriceDetail
    let mode: PriceMode
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(spacing: 4) {
                        Text("\(detail.date) kl. \(String(format: "%02d", detail.hour)):00\u{2013}\(String(format: "%02d", (detail.hour + 1) % 24)):00")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        Text(formatPrice(detail.price) + " DKK/kWh")
                            .font(.title.bold())
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .listRowBackground(Color.clear)
                }

                Section("Prisopbygning") {
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
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .foregroundStyle(.primary)
                .monospacedDigit()
        }
    }

    private func formatPrice(_ p: Double) -> String {
        String(format: "%.4f", p).replacingOccurrences(of: ".", with: ",")
    }
}
