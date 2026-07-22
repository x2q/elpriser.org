import SwiftUI
import Charts

/// Price level → color, shared by the day curve's gradient stops.
private func priceColor(_ t: Double) -> Color {
    switch t {
    case ..<0.25: return Color(red: 0.20, green: 0.78, blue: 0.35)
    case ..<0.50: return Color(red: 0.66, green: 0.85, blue: 0.29)
    case ..<0.75: return Color(red: 1.00, green: 0.80, blue: 0.00)
    case ..<0.90: return Color(red: 1.00, green: 0.58, blue: 0.00)
    default:      return Color(red: 1.00, green: 0.23, blue: 0.19)
    }
}

/// Today's 24 hours as one color-graded curve with a "now" marker —
/// the answer-first replacement for the hour-by-hour table.
struct DayCurveChart: View {
    let prices: [Double?]
    let currentHour: Int

    private var points: [(h: Int, p: Double)] {
        prices.enumerated().compactMap { h, p in p.map { (h, $0) } }
    }

    var body: some View {
        let pts = points
        if pts.isEmpty { EmptyView() } else {
            let lo = pts.map(\.p).min()!, hi = pts.map(\.p).max()!
            let range = max(hi - lo, 0.01)
            let stops = pts.map { pt in
                Gradient.Stop(color: priceColor((pt.p - lo) / range),
                              location: Double(pt.h) / 23.0)
            }
            let gradient = LinearGradient(stops: stops, startPoint: .leading, endPoint: .trailing)

            Chart {
                ForEach(pts, id: \.h) { pt in
                    AreaMark(x: .value("Time", pt.h), y: .value("Pris", pt.p))
                        .foregroundStyle(.linearGradient(
                            colors: [Color.brand.opacity(0.18), Color.brand.opacity(0.01)],
                            startPoint: .top, endPoint: .bottom))
                        .interpolationMethod(.catmullRom)
                    LineMark(x: .value("Time", pt.h), y: .value("Pris", pt.p))
                        .foregroundStyle(gradient)
                        .lineStyle(StrokeStyle(lineWidth: 3, lineCap: .round))
                        .interpolationMethod(.catmullRom)
                }
                if currentHour < prices.count, let nowP = prices[currentHour] {
                    RuleMark(x: .value("Nu", currentHour))
                        .foregroundStyle(.secondary.opacity(0.25))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 4]))
                    PointMark(x: .value("Nu", currentHour), y: .value("Pris", nowP))
                        .foregroundStyle(Color.brand)
                        .symbolSize(90)
                }
            }
            .chartXScale(domain: 0...23)
            .chartXAxis {
                AxisMarks(values: [0, 6, 12, 18, 23]) { v in
                    AxisValueLabel {
                        if let h = v.as(Int.self) {
                            Text(String(format: "%02d", h)).font(.caption2)
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { _ in
                    AxisGridLine().foregroundStyle(.secondary.opacity(0.12))
                    AxisValueLabel().font(.caption2)
                }
            }
        }
    }
}

/// Thin teal CO₂ strip shown under the price curve — same x-axis, so
/// price/CO₂ divergence (cheap ≠ green) is visible at a glance.
struct Co2StripChart: View {
    let co2: [Int?]
    let currentHour: Int

    private var points: [(h: Int, v: Int)] {
        co2.enumerated().compactMap { h, v in v.map { (h, $0) } }
    }

    var body: some View {
        let pts = points
        if pts.isEmpty { EmptyView() } else {
            Chart {
                ForEach(pts, id: \.h) { pt in
                    AreaMark(x: .value("Time", pt.h), y: .value("CO₂", pt.v))
                        .foregroundStyle(.linearGradient(
                            colors: [Color.co2.opacity(0.30), Color.co2.opacity(0.02)],
                            startPoint: .top, endPoint: .bottom))
                        .interpolationMethod(.catmullRom)
                    LineMark(x: .value("Time", pt.h), y: .value("CO₂", pt.v))
                        .foregroundStyle(Color.co2)
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                        .interpolationMethod(.catmullRom)
                }
                if currentHour < co2.count, let nowC = co2[currentHour] {
                    PointMark(x: .value("Nu", currentHour), y: .value("CO₂", nowC))
                        .foregroundStyle(Color.co2)
                        .symbolSize(50)
                }
            }
            .chartXScale(domain: 0...23)
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
        }
    }
}

/// Small bordered stat card (Billigst / Dyrest / Grønnest).
struct StatCard: View {
    let label: String
    let value: String
    let sub: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 18, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(tint)
            Text(sub)
                .font(.system(size: 10.5))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(Color(.separator).opacity(0.5))
        )
    }
}

/// Verdict pill ("Billig lige nu" / "38 g CO₂/kWh").
struct VerdictPill: View {
    let text: String
    let fg: Color
    let bg: Color

    var body: some View {
        Text(text)
            .font(.system(size: 12.5, weight: .semibold))
            .foregroundStyle(fg)
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(bg, in: Capsule())
    }
}
