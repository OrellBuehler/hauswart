import shared
import SwiftUI

/// The caller's push preferences: whether, which kinds, quiet hours and the services that receive them.
struct NotificationSettingsScreen: View {
    @StateObject private var model = Observed(NotificationSettingsStore(app: AppEnv.app))
    @State private var manual = ""
    @State private var notice: String?

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("settings_tab_notifications"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(state.saving ? tr("common_saving") : tr("common_save")) {
                        model.store.save()
                    }
                    .disabled(!state.dirty || state.saving || state.loading)
                }
            }
            .onChange(of: state.justSaved) { _, saved in
                if saved {
                    notice = tr("notify_saved")
                    model.store.consumeSaved()
                }
            }
            .noticeAlert($notice)
    }

    @ViewBuilder
    private func content(_ state: NotificationSettingsState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            List {
                Section {
                    Text(tr("notify_description"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    ToggleEntry(
                        label: tr("notify_push_enabled"),
                        isOn: binding(state.pushEnabled) { model.store.setPushEnabled(value: $0) },
                        hint: tr("notify_push_enabled_hint")
                    )
                }
                targetsSection(state)
                Section(tr("notify_stages_title")) {
                    Text(tr("notify_stages_hint"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    ForEach(state.stages, id: \.stage) { row in
                        ToggleEntry(
                            label: row.title,
                            isOn: binding(row.enabled) { model.store.setStage(stage: row.stage, enabled: $0) },
                            hint: row.hint
                        )
                    }
                }
                Section {
                    ToggleEntry(
                        label: tr("notify_quiet_title"),
                        isOn: binding(state.quietOn) { model.store.setQuietOn(value: $0) },
                        hint: state.quietHint
                    )
                    if state.quietOn {
                        ChoiceEntry(
                            label: tr("notify_quiet_start"),
                            selection: stringBinding(state.quietStart) { model.store.setQuietStart(value: $0) },
                            options: settingsChoices(state.timeOptions)
                        )
                        ChoiceEntry(
                            label: tr("notify_quiet_end"),
                            selection: stringBinding(state.quietEnd) { model.store.setQuietEnd(value: $0) },
                            options: settingsChoices(state.timeOptions)
                        )
                    }
                }
                if let saveError = state.saveError {
                    Section {
                        FieldError(text: saveError)
                    }
                }
            }
        }
    }

    private func targetsSection(_ state: NotificationSettingsState) -> some View {
        Section(tr("notify_targets_title")) {
            Text(tr("notify_targets_hint"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            if !state.connected {
                VStack(alignment: .leading, spacing: 4) {
                    Text(tr("notify_not_connected_title"))
                        .font(.subheadline.weight(.semibold))
                    Text(tr("notify_not_connected_body"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            if let servicesError = state.servicesError {
                FieldError(text: servicesError + " " + tr("notify_services_failed"))
            }
            if state.connected, state.servicesError == nil, state.targets.isEmpty {
                Text(tr("notify_services_empty"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(state.targets, id: \.target) { row in
                ToggleEntry(
                    label: row.title,
                    isOn: binding(row.enabled) { model.store.setTarget(target: row.target, enabled: $0) },
                    hint: row.missing ? row.service + " · " + tr("notify_target_missing") : row.service
                )
            }
            HStack(alignment: .top) {
                TextEntry(
                    label: tr("notify_manual_label"),
                    text: $manual,
                    error: state.manualError,
                    capitalization: .never
                )
                Button(tr("common_add")) {
                    model.store.addManual(name: manual)
                    manual = ""
                }
                .buttonStyle(.bordered)
            }
            Text(tr("notify_manual_hint"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            if state.noTarget {
                Text(tr("notify_no_target"))
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
    }

    private func binding(_ value: Bool, set: @escaping (Bool) -> Void) -> Binding<Bool> {
        Binding(get: { value }, set: set)
    }

    private func stringBinding(_ value: String, set: @escaping (String) -> Void) -> Binding<String> {
        Binding(get: { value }, set: set)
    }
}
