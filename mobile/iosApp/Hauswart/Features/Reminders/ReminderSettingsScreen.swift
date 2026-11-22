import shared
import SwiftUI

/// Local reminders: on or off, when, how far ahead, and the system permission that lets them show.
struct ReminderSettingsScreen: View {
    @StateObject private var model = Observed(ReminderSettingsStore(app: AppEnv.app))
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        let state = model.state
        List {
            Section {
                Text(tr("m_reminders_description"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                ToggleEntry(
                    label: tr("m_reminders_enabled"),
                    isOn: Binding(
                        get: { model.state.enabled },
                        set: { model.store.setEnabled(value: $0) }
                    )
                )
            }
            if state.permissionBlocked {
                Section {
                    Text(tr("m_reminders_permission_blocked"))
                        .font(.footnote)
                        .foregroundStyle(.red)
                    Button(tr("m_reminders_open_system")) {
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    }
                }
            }
            if state.enabled {
                Section {
                    ChoiceEntry(
                        label: tr("m_reminders_time"),
                        selection: Binding(
                            get: { model.state.timeOfDay },
                            set: { model.store.setTimeOfDay(value: $0) }
                        ),
                        options: settingsChoices(state.timeOptions)
                    )
                    Text(tr("m_reminders_time_hint"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    ToggleEntry(
                        label: tr("m_reminders_due_soon"),
                        isOn: Binding(
                            get: { model.state.dueSoon },
                            set: { model.store.setDueSoon(value: $0) }
                        ),
                        hint: tr("m_reminders_due_soon_hint")
                    )
                    ChoiceEntry(
                        label: tr("m_reminders_lead"),
                        selection: Binding(
                            get: { String(model.state.leadMinutes) },
                            set: { model.store.setLeadMinutes(value: Int32($0) ?? 60) }
                        ),
                        options: settingsChoices(state.leadOptions)
                    )
                }
            }
        }
        .navigationTitle(tr("m_reminders_title"))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { refreshPermission() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { refreshPermission() }
        }
        .onChange(of: state.requestPermission) { _, request in
            if request {
                ReminderCenter.requestPermission { refreshPermission() }
            }
        }
        .onChange(of: state.revision) { _, _ in
            ReminderRunner.syncNow()
        }
    }

    private func refreshPermission() {
        ReminderCenter.permission(
            granted: ReminderSettingsStoreKt.REMINDER_PERMISSION_GRANTED,
            denied: ReminderSettingsStoreKt.REMINDER_PERMISSION_DENIED,
            undetermined: ReminderSettingsStoreKt.REMINDER_PERMISSION_UNDETERMINED
        ) { value in
            model.store.setPermission(value: value)
        }
    }
}
