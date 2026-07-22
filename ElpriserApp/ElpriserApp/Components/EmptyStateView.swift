import SwiftUI

/// Shared error/empty state for data screens — replaces hand-rolled
/// exclamationmark+text+button stacks with the native construct built
/// exactly for this.
struct ErrorStateView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("Kunne ikke hente data", systemImage: "wifi.slash")
        } description: {
            Text(message)
        } actions: {
            Button("Prøv igen", action: retry)
                .buttonStyle(.borderedProminent)
                .tint(Color.brand)
        }
    }
}
