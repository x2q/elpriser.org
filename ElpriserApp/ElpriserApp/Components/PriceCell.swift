import SwiftUI

struct PriceCell: View {
    let price: Double?
    let priceMin: Double
    let priceMax: Double
    let isCurrentHour: Bool
    let onTap: (() -> Void)?

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        if let price {
            let isDark = colorScheme == .dark
            let bg = Color.forPrice(price, min: priceMin, max: priceMax, isDark: isDark)
            let formatted = String(format: "%.2f", price).replacingOccurrences(of: ".", with: ",")

            Text(formatted)
                .font(.system(.caption2, design: .monospaced))
                .fontWeight(isCurrentHour ? .bold : .regular)
                .frame(minWidth: 38)
                .padding(.horizontal, 2)
                .padding(.vertical, 3)
                .background(bg)
                .foregroundStyle(isDark ? .white.opacity(0.85) : .black)
                .clipShape(RoundedRectangle(cornerRadius: 3))
                .overlay(
                    isCurrentHour ?
                    RoundedRectangle(cornerRadius: 3)
                        .strokeBorder(isDark ? .white.opacity(0.5) : .black.opacity(0.4), lineWidth: 1.5)
                    : nil
                )
                .onTapGesture { onTap?() }
        } else {
            Rectangle()
                .fill(Color(.systemGray5))
                .frame(minWidth: 38, minHeight: 22)
                .clipShape(RoundedRectangle(cornerRadius: 3))
        }
    }
}
