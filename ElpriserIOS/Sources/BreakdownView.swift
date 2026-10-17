import SwiftUI

extension BreakdownPart {
    var color: Color {
        switch self {
        case .spot: T.partSpot
        case .system, .transmission: T.partEnerginet
        case .grid: T.partGrid
        case .duty: T.partDuty
        case .vat: T.partVat
        }
    }
}

/// Teksten under Din pris | Spotpris. Med en prisopbygning er hele linjen én knap (tekst + vinkel), der folder opdelingen
/// af timens pris ud under sig; uden (fx et ældre svar uden afgifterne) er den bare tekst, uden vinkel.
struct CaptionDisclosure: View {
    let caption: String
    let breakdown: PriceBreakdown?
    @Binding var open: Bool
    /// "Tilbage til nu": slipper den valgte søjle.
    let onBack: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if let breakdown {
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.22)) { open.toggle() }
                } label: {
                    HStack(spacing: 5) {
                        Text(caption).font(.app(12, .semibold)).foregroundStyle(T.text2)
                            .multilineTextAlignment(.leading)
                        Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold)).foregroundStyle(T.text2)
                            .rotationEffect(.degrees(open ? 180 : 0))
                            .accessibilityHidden(true)
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(caption)
                .accessibilityValue(open ? "Udvidet" : "Skjult")
                .accessibilityHint(open ? "Skjuler, hvordan prisen er sammensat" : "Viser, hvordan prisen er sammensat")
                if open {
                    BreakdownPanel(breakdown: breakdown, onBack: onBack)
                        .transition(reduceMotion ? .identity : .opacity.combined(with: .move(edge: .top)))
                        .padding(.bottom, 2)
                }
            }
        } else {
            Text(caption).font(.app(12, .semibold)).foregroundStyle(T.text2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Overskrift, tynd søjle, rækker og total for én time.
private struct BreakdownPanel: View {
    let breakdown: PriceBreakdown
    let onBack: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 0) {
                Text(breakdown.heading).font(.app(13, .bold)).foregroundStyle(T.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if breakdown.isSelected {
                    Button(action: onBack) {
                        HStack(spacing: 5) {
                            Image(systemName: "arrow.uturn.backward").font(.system(size: 11, weight: .bold))
                            Text("Tilbage til nu").font(.app(12, .bold))
                        }
                        .foregroundStyle(T.brand)
                        .frame(minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            StackedBar(breakdown: breakdown).frame(height: 8).accessibilityHidden(true)
            VStack(spacing: 8) {
                ForEach(breakdown.rows) { row in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Circle().fill(row.part.color).frame(width: 8, height: 8).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                        Text(row.label).font(.app(13, .semibold)).foregroundStyle(T.text3)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 8)
                        Text(row.text).font(.app(13, .bold)).monospacedDigit().foregroundStyle(T.text)
                            .lineLimit(1).fixedSize()
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(row.spoken)
                }
                Rectangle().fill(T.hairline).frame(height: 1).accessibilityHidden(true)
                HStack(alignment: .firstTextBaseline) {
                    Text("I alt").font(.app(13, .heavy)).foregroundStyle(T.text)
                    Spacer(minLength: 8)
                    Text(breakdown.totalText).font(.app(13, .heavy)).monospacedDigit().foregroundStyle(T.text)
                        .lineLimit(1).fixedSize()
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("I alt, \(breakdown.totalText)")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(T.surface2, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}

/// Den tynde stablede søjle: ét stykke pr. række, bredde efter værdien.
private struct StackedBar: View {
    let breakdown: PriceBreakdown

    var body: some View {
        GeometryReader { g in
            let weights = breakdown.barWeights
            let shown = weights.filter { $0 > 0 }.count
            let room = Swift.max(g.size.width - CGFloat(Swift.max(shown - 1, 0)) * 2, 0)
            HStack(spacing: 2) {
                ForEach(Array(breakdown.rows.enumerated()), id: \.offset) { i, row in
                    if weights[i] > 0 {
                        Rectangle().fill(row.part.color).frame(width: room * CGFloat(weights[i]))
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        }
    }
}
