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
            .font(.app(12, .heavy))
            .tracking(1)
            .foregroundStyle(T.text2)
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
                .font(.app(15.5, .heavy))
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
            Text(title).font(.app(15, .heavy)).foregroundStyle(color)
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
            Text(title).font(.app(13.5, .bold)).foregroundStyle(fg)
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
                    Text(options[i]).font(.app(13.5, .bold))
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

struct ScreenHeader<Trailing: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder var trailing: () -> Trailing
    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 0) {
                Text(title).font(.app(28, .heavy)).tracking(-0.5)
                Text(subtitle).font(.app(12.5, .semibold)).foregroundStyle(T.text2)
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
            Text(text).font(.app(14.5, .semibold)).lineSpacing(3)
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
