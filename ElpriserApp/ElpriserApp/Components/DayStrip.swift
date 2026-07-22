import SwiftUI

/// 24 thin cells showing a day's on/off schedule as one full-width band —
/// the device card's "døgnrytme" visual. Never needs sideways scrolling.
struct HourBand: View {
    let onHours: Set<Int>
    let currentHour: Int?

    var body: some View {
        VStack(spacing: 3) {
            HStack(spacing: 2) {
                ForEach(0..<24, id: \.self) { h in
                    RoundedRectangle(cornerRadius: 2.5)
                        .fill(onHours.contains(h) ? Color.brand : Color(.systemGray5))
                        .frame(height: 22)
                        .overlay {
                            if h == currentHour {
                                RoundedRectangle(cornerRadius: 2.5)
                                    .strokeBorder(Color.primary, lineWidth: 1.5)
                            }
                        }
                }
            }
            HStack {
                Text("00")
                Spacer(); Text("06")
                Spacer(); Text("12")
                Spacer(); Text("18")
                Spacer(); Text("24")
            }
            .font(.system(size: 8.5, design: .monospaced))
            .foregroundStyle(.secondary)
        }
    }
}
