import SwiftUI

/// Navigationsskinnen på iPad og store skærme: samme opbygning som i Android-tabletudgaven — logoet øverst,
/// så fanerne med ikon over teksten og den valgte som en udfyldt pille.
struct SideRail: View {
    @Binding var selected: AppTab

    private struct Item: Identifiable {
        let tab: AppTab, title: String, symbol: String, key: KeyEquivalent
        var id: AppTab { tab }
    }
    private let items = [
        Item(tab: .pris, title: "Pris", symbol: "bolt", key: "1"),
        Item(tab: .smartHjem, title: "Smart hjem", symbol: "slider.horizontal.3", key: "2"),
    ]

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 26, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 56, height: 56)
                .background(T.brandSolid, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .padding(.top, 20).padding(.bottom, 26)
                .accessibilityHidden(true)

            ForEach(items) { item in
                let on = item.tab == selected
                Button { selected = item.tab } label: {
                    VStack(spacing: 6) {
                        Image(systemName: item.symbol)
                            .font(.system(size: 20, weight: on ? .bold : .medium))
                            .foregroundStyle(on ? Color.white : T.text2)
                            .frame(width: 60, height: 38)
                            .background(on ? T.brandSolid : Color.clear, in: Capsule())
                        Text(item.title)
                            .font(.app(12.5, on ? .bold : .semibold))
                            .foregroundStyle(on ? T.text : T.text2)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .keyboardShortcut(item.key, modifiers: .command)
                .accessibilityLabel(item.title)
                .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
            }
            Spacer(minLength: 0)
        }
        .frame(width: 100)
        .frame(maxHeight: .infinity)
        .background(T.nav.ignoresSafeArea())
    }
}
