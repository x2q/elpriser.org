import SwiftUI

struct AutomationExportView: View {
    let vm: AutomationViewModel
    @State private var selectedTab = 0
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Tab selector
                Picker("Export", selection: $selectedTab) {
                    Text("Home Assistant").tag(0)
                    Text("Shelly").tag(1)
                }
                .pickerStyle(.segmented)
                .padding()

                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if selectedTab == 0 {
                            Text("REST-sensor og template-automation til Home Assistant.")
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            CodeBlock(code: vm.homeAssistantYAML, language: "yaml")
                        } else {
                            Text("Shelly Plus/Pro script \u{2014} kalder API hvert minut og s\u{00E6}tter output til ON/OFF.")
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            CodeBlock(code: vm.shellyScript, language: "javascript")
                        }
                    }
                    .padding()
                }
            }
            .navigationTitle("Eksport kode")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Luk") { dismiss() }
                }
            }
        }
    }
}

struct CodeBlock: View {
    let code: String
    let language: String

    var body: some View {
        VStack(alignment: .trailing, spacing: 0) {
            HStack {
                Spacer()
                Button {
                    UIPasteboard.general.string = code
                } label: {
                    Label("Kopi\u{00E9}r", systemImage: "doc.on.doc")
                        .font(.caption)
                }
                .buttonStyle(.bordered)
                .controlSize(.mini)
            }
            .padding(.bottom, 4)

            ScrollView(.horizontal, showsIndicators: true) {
                Text(code)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(language == "javascript" ? .green : Color(.label))
                    .padding(12)
            }
            .background(Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }
}
