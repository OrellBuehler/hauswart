import shared
import SwiftUI

/// The calendars hauswart writes into and their health; switching and "sync now" only where the token may.
struct CalendarTargetsScreen: View {
    @StateObject private var model = Observed(CalendarTargetsStore(app: AppEnv.app))
    @State private var notice: String?

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("settings_tab_calendar"))
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: state.notice) { _, text in
                if let text {
                    notice = text
                    model.store.dismissMessages()
                }
            }
            .onChange(of: state.actionError) { _, text in
                if let text {
                    notice = text
                    model.store.dismissMessages()
                }
            }
            .noticeAlert($notice)
    }

    @ViewBuilder
    private func content(_ state: CalendarTargetsState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.rows.isEmpty {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            List {
                Section {
                    Text(tr("m_settings_calendar_intro"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if state.rows.isEmpty {
                    EmptyStateView(
                        title: tr("caltargets_empty_title"),
                        message: tr("caltargets_empty_body_member"),
                        systemImage: "calendar"
                    )
                }
                ForEach(state.rows, id: \.id) { row in
                    targetSection(row)
                }
                Section {
                    Text(state.readOnlyNote)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    BrowserRow(title: tr("settings_tab_calendar"), url: state.browserUrl)
                }
            }
            .refreshable { model.store.refresh() }
        }
    }

    private func targetSection(_ row: CalendarTargetRow) -> some View {
        Section(row.name) {
            HStack {
                Badge(text: row.stateText, color: Tone.color(row.stateTone))
                Badge(text: row.level)
            }
            Text(row.place)
                .font(.footnote)
                .foregroundStyle(.secondary)
            Text(row.kinds.joined(separator: ", "))
                .font(.footnote)
                .foregroundStyle(.secondary)
            if let errorText = row.errorText {
                FieldError(text: errorText)
            }
            ForEach(row.details, id: \.label) { detail in
                ValueRow(label: detail.label, value: detail.value)
            }
            if let lastRun = row.lastRun {
                ValueRow(label: tr("caltargets_last_run"), value: lastRun)
            }
            if row.canManage {
                ToggleEntry(
                    label: tr("caltargets_enabled"),
                    isOn: Binding(
                        get: { row.enabled },
                        set: { model.store.setEnabled(id: row.id, enabled: $0) }
                    )
                )
                .disabled(row.busy)
                Button(row.busy ? tr("caltargets_syncing") : tr("caltargets_sync_now")) {
                    model.store.syncNow(id: row.id)
                }
                .disabled(!row.enabled || row.busy)
            }
        }
    }
}
