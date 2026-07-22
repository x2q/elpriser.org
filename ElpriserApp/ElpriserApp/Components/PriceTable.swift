import SwiftUI

struct PriceTable: View {
    let days: [PriceDay]
    let priceRange: (min: Double, max: Double)
    let currentHour: Int
    var onCellTap: ((String, Int, Double) -> Void)?

    @State private var selectedDate: String?

    private var selectedDay: PriceDay? {
        days.first { $0.date == selectedDate } ?? days.first { $0.isToday } ?? days.last
    }

    var body: some View {
        VStack(spacing: 0) {
            DayStrip(
                days: days,
                selectedID: $selectedDate,
                label: { $0.isToday ? "I dag" : $0.weekday },
                number: { "\($0.dayNumber)" },
                isHighlighted: { $0.isToday }
            )

            Divider()

            if let day = selectedDay {
                List {
                    ForEach(0..<24, id: \.self) { hour in
                        if let price = day.prices[hour] {
                            HourPriceRow(
                                hour: hour,
                                price: price,
                                priceRange: priceRange,
                                isCurrentHour: day.isToday && hour == currentHour
                            )
                            .listRowInsets(EdgeInsets())
                            .listRowSeparator(.hidden)
                            .contentShape(Rectangle())
                            .onTapGesture { onCellTap?(day.date, hour, price) }
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .onAppear { syncSelection() }
        .onChange(of: days.map(\.date)) { _, _ in syncSelection() }
    }

    private func syncSelection() {
        if selectedDate == nil || !days.contains(where: { $0.date == selectedDate }) {
            selectedDate = days.first(where: { $0.isToday })?.date ?? days.last?.date
        }
    }
}

private struct HourPriceRow: View {
    let hour: Int
    let price: Double
    let priceRange: (min: Double, max: Double)
    let isCurrentHour: Bool

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack {
            Text(String(format: "%02d:00\u{2013}%02d:00", hour, (hour + 1) % 24))
                .font(.subheadline)
            Spacer()
            Text(String(format: "%.2f", price).replacingOccurrences(of: ".", with: ","))
                .font(.system(.subheadline, design: .monospaced))
        }
        .fontWeight(isCurrentHour ? .bold : .regular)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color.forPrice(price, min: priceRange.min, max: priceRange.max, isDark: colorScheme == .dark))
    }
}
