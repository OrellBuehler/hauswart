import shared
import SwiftUI

/// Which contacts this device keeps in the phone's address book.
struct PhoneContactsScreen: View {
    @StateObject private var model = Observed(PhoneContactsStore(app: AppEnv.app))
    @ObservedObject private var status = PhoneContactStatus.shared
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var confirmingRemove = false

    var body: some View {
        let state = model.state
        List {
            Section {
                Text(tr("m_contact_sync_description"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if state.accessBlocked {
                Section {
                    Text(tr("m_contact_sync_blocked"))
                        .font(.footnote)
                        .foregroundStyle(.red)
                    Button(tr("m_reminders_open_system")) {
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    }
                }
            }
            if state.accessLimited || state.listMissing || state.writeFailed {
                Section {
                    if state.accessLimited { notice(tr("m_contact_sync_limited")) }
                    if state.listMissing { notice(tr("m_contact_sync_list_missing")) }
                    if state.writeFailed { notice(tr("m_contact_sync_write_failed")) }
                }
            }
            Section(tr("nav_contacts")) {
                if state.loading {
                    ProgressView()
                } else if state.error != nil {
                    ErrorBanner(error: state.error)
                } else if state.choices.isEmpty {
                    Text(tr("contacts_empty_title"))
                        .foregroundStyle(.secondary)
                }
                ForEach(state.choices, id: \.id) { choice in
                    ToggleEntry(
                        label: choice.name,
                        isOn: Binding(
                            get: { choice.chosen },
                            set: { model.store.setChosen(id: choice.id, value: $0) }
                        ),
                        hint: choice.detail
                    )
                    .disabled(!choice.possible)
                }
            }
            if state.chosenCount > 0 {
                Section {
                    Button(tr("m_contact_sync_now")) {
                        PhoneContactRunner.syncNow()
                    }
                    Button(tr("m_contact_sync_remove_all"), role: .destructive) {
                        confirmingRemove = true
                    }
                }
            }
        }
        .navigationTitle(tr("m_contact_sync_title"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { model.store.refresh() }
        .confirmDelete(
            tr("m_contact_sync_remove_all_title"),
            message: tr("m_contact_sync_remove_all_message"),
            isPresented: $confirmingRemove
        ) {
            model.store.chooseNone()
        }
        .onAppear {
            status.refresh()
            model.store.setAccess(value: status.access)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { status.refresh() }
        }
        .onChange(of: status.access) { _, access in
            model.store.setAccess(value: access)
        }
    }

    private func notice(_ text: String) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(.secondary)
    }
}
