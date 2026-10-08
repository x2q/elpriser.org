import SwiftUI

extension View {
    /// Kort med samme udseende som i Android-appen.
    func card(padding: CGFloat = 16) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(T.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(T.outline, lineWidth: 1))
    }
}

struct SectionLabel: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .heavy))
            .tracking(1)
            .foregroundStyle(T.text2)
    }
}

struct Pill: View {
    let text: String, bg: Color, fg: Color
    var body: some View {
        Text(text)
            .font(.system(size: 13.5, weight: .bold))
            .foregroundStyle(fg)
            .padding(.horizontal, 14).padding(.vertical, 7)
            .background(bg, in: Capsule())
    }
}

struct PrimaryButton: View {
    let title: String
    var enabled = true
    var height: CGFloat = 52
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15.5, weight: .heavy))
                .foregroundStyle(enabled ? Color.white : T.text2)
                .frame(maxWidth: .infinity, minHeight: height)
                .background(enabled ? T.brandSolid : T.surface2, in: Capsule())
        }
        .disabled(!enabled)
        .buttonStyle(.plain)
    }
}

struct TextAction: View {
    let title: String
    var color: Color = T.brand
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 15, weight: .heavy)).foregroundStyle(color)
                .frame(maxWidth: .infinity, minHeight: 48)
        }
        .buttonStyle(.plain)
    }
}

struct SoftButton: View {
    let title: String
    var bg: Color = T.surface2
    var fg: Color = T.text
    var height: CGFloat = 44
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 13.5, weight: .bold)).foregroundStyle(fg)
                .padding(.horizontal, 18).frame(minHeight: height)
                .background(bg, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

/// Segmenteret valg (faner).
struct Segmented: View {
    let options: [String]
    let selected: Int
    let onSelect: (Int) -> Void
    var body: some View {
        HStack(spacing: 2) {
            ForEach(options.indices, id: \.self) { i in
                let on = i == selected
                Button { onSelect(i) } label: {
                    Text(options[i]).font(.system(size: 13.5, weight: .bold))
                        .foregroundStyle(on ? Color.white : T.text2)
                        .frame(maxWidth: .infinity, minHeight: 38)
                        .background(on ? T.brandSolid : Color.clear, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(3)
        .background(T.surface2, in: Capsule())
    }
}

struct StatTile: View {
    let label: String, value: String, sub: String, color: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label.uppercased()).font(.system(size: 11, weight: .bold)).tracking(0.6).foregroundStyle(T.text2)
            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text(value).font(.system(size: 19, weight: .heavy)).foregroundStyle(color)
                Text(sub).font(.system(size: 12, weight: .semibold)).foregroundStyle(T.text2)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(T.surface2, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct ScreenHeader<Trailing: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder var trailing: () -> Trailing
    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 0) {
                Text(title).font(.system(size: 28, weight: .heavy)).tracking(-0.5)
                Text(subtitle).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(T.text2)
            }
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, 20).padding(.vertical, 8)
        .frame(minHeight: 64)
    }
}

extension ScreenHeader where Trailing == EmptyView {
    init(title: String, subtitle: String) { self.init(title: title, subtitle: subtitle) { EmptyView() } }
}

struct LoadingView: View {
    var body: some View {
        ProgressView().controlSize(.large).tint(T.brandSolid)
            .frame(maxWidth: .infinity).padding(48)
    }
}

struct ErrorCard: View {
    let text: String
    var onRetry: (() -> Void)?
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(text).font(.system(size: 14.5, weight: .semibold)).lineSpacing(3)
            if let onRetry { SoftButton(title: "Prøv igen", bg: T.brandSoft, fg: T.brand, action: onRetry) }
        }
        .card()
    }
}

struct RadioMark: View {
    let selected: Bool
    var body: some View {
        ZStack {
            Circle().stroke(selected ? T.brandSolid : T.text2, lineWidth: 2).frame(width: 24, height: 24)
            if selected { Circle().fill(T.brandSolid).frame(width: 11, height: 11) }
        }
    }
}

/// Dag-rækkens spændbjælke: laveste til højeste pris, farvet efter niveau.
struct RangeBar: View {
    let min: Double, max: Double, lo: Double, hi: Double
    var body: some View {
        GeometryReader { g in
            let span = (hi - lo) > 0 ? (hi - lo) : 1
            let a = (min - lo) / span, b = (max - lo) / span
            let w = Swift.max((b - a) * g.size.width, 10)
            let x = Swift.min(a * g.size.width, g.size.width - w)
            ZStack(alignment: .leading) {
                Capsule().fill(T.surface2)
                Capsule().fill(LinearGradient(colors: [ramp(a), ramp(b)], startPoint: .leading, endPoint: .trailing))
                    .frame(width: w).offset(x: x)
            }
        }
        .frame(height: 10)
    }
}

/// Tilbage-knap til skærme uden for fanerne.
struct HourTag: View {
    let text: String, color: Color
    var body: some View {
        Text(text).font(.system(size: 11, weight: .bold)).foregroundStyle(color).frame(height: 15)
    }
}
