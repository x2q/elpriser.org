import SwiftUI

struct PriceTable: View {
    let days: [PriceDay]
    let priceRange: (min: Double, max: Double)
    let currentHour: Int
    var onCellTap: ((String, Int, Double) -> Void)?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyVStack(spacing: 0) {
                // Header: day numbers
                HStack(spacing: 2) {
                    Text("Time")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .frame(width: 36, alignment: .trailing)

                    ForEach(days) { day in
                        VStack(spacing: 1) {
                            Text("\(day.dayNumber)")
                                .font(.caption)
                                .fontWeight(day.isToday ? .bold : .medium)
                                .foregroundStyle(day.isToday ? Color.brand : .primary)
                            Text(day.isToday ? "I dag" : day.weekday)
                                .font(.system(size: 9))
                                .foregroundStyle(day.isToday ? .primary : .secondary)
                        }
                        .frame(minWidth: 38)
                    }
                }
                .padding(.bottom, 4)

                Divider()

                // Price rows
                ForEach(0..<24, id: \.self) { hour in
                    HStack(spacing: 2) {
                        Text(String(format: "%02d", hour))
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .frame(width: 36, alignment: .trailing)

                        ForEach(days) { day in
                            let isNow = day.isToday && hour == currentHour
                            PriceCell(
                                price: day.prices[hour],
                                priceMin: priceRange.min,
                                priceMax: priceRange.max,
                                isCurrentHour: isNow,
                                onTap: {
                                    if let p = day.prices[hour] {
                                        onCellTap?(day.date, hour, p)
                                    }
                                }
                            )
                        }
                    }
                    .padding(.vertical, 0.5)
                }
            }
            .padding(.horizontal, 4)
        }
    }
}
