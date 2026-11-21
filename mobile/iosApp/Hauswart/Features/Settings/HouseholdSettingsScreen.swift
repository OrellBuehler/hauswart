import shared
import SwiftUI

/// The household's settings, read-only: changing them needs the administrator scope that a device token never has.
struct HouseholdSettingsScreen: View {
    @StateObject private var model = Observed(HouseholdSettingsStore(app: AppEnv.app))

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("settings_tab_household"))
            .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private func content(_ state: HouseholdSettingsState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.rows.isEmpty {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            List {
                Section {
                    Text(state.readOnlyNote)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Section(tr("household_title")) {
                    ForEach(state.rows, id: \.label) { row in
                        ValueRow(label: row.label, value: row.value)
                    }
                }
                if !state.allowedHosts.isEmpty {
                    Section(tr("household_host_allowlist")) {
                        ForEach(state.allowedHosts, id: \.self) { host in
                            Text(host)
                        }
                    }
                }
                Section {
                    BrowserRow(title: tr("settings_tab_household"), url: state.browserUrl)
                }
            }
            .refreshable { model.store.refresh() }
        }
    }
}
