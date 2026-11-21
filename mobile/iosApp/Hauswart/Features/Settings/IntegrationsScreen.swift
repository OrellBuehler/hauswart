import shared
import SwiftUI

/// The connections to other systems and how they are doing; each opens its own screen.
struct IntegrationsScreen: View {
    @StateObject private var model = Observed(IntegrationsListStore(app: AppEnv.app))

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("settings_tab_integrations"))
            .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private func content(_ state: IntegrationsListState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.rows.isEmpty {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            List {
                Section {
                    Text(state.description_)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Section {
                    ForEach(state.rows, id: \.kind) { row in
                        NavigationLink(value: Route.settingsIntegration(row.kind)) {
                            IntegrationRowView(row: row)
                        }
                    }
                }
                Section {
                    BrowserRow(title: tr("settings_tab_integrations"), url: state.browserUrl)
                }
            }
            .refreshable { model.store.refresh() }
        }
    }
}

private struct IntegrationRowView: View {
    let row: IntegrationRow

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(row.name)
                    .font(.body)
                Spacer(minLength: 8)
                Badge(text: row.statusText, color: Tone.color(row.statusTone))
            }
            Text(row.description_)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(3)
            if let detail = row.detail {
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
