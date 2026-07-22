import SwiftUI

/// A fixed-width row of day chips that always fits the screen — used
/// instead of a horizontally-scrolling multi-day grid, so picking a day
/// never requires sideways scrolling. Pair with a full-width vertical list
/// of that day's 24 hours below it.
struct DayStrip<Day: Identifiable>: View {
    let days: [Day]
    @Binding var selectedID: Day.ID?
    let label: (Day) -> String
    let number: (Day) -> String
    let isHighlighted: (Day) -> Bool

    var body: some View {
        HStack(spacing: 4) {
            ForEach(days) { day in
                let isSelected = selectedID == day.id
                Button {
                    selectedID = day.id
                } label: {
                    VStack(spacing: 2) {
                        Text(label(day))
                            .font(.system(size: 9))
                        Text(number(day))
                            .font(.caption.weight(isSelected ? .bold : .medium))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .foregroundStyle(isSelected ? .white : (isHighlighted(day) ? Color.brand : .primary))
                    .background(isSelected ? Color.brand : Color.clear)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}
