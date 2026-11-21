import shared
import SwiftUI

/// One connection. Home Assistant is the household's and needs an administrator, so it is read-only;
/// the document system and the finance provider are personal and can be connected, tested, synced
/// and disconnected here.
struct IntegrationScreen: View {
    @StateObject private var model: Observed<IntegrationConnectionStore, IntegrationState>
    @State private var baseUrl = ""
    @State private var token = ""
    @State private var allowInsecureTls = false
    @State private var enabled = true
    @State private var filledVersion: Int32 = -1
    @State private var confirmingDisconnect = false
    @State private var notice: String?

    init(kind: String) {
        _model = StateObject(wrappedValue: Observed(IntegrationConnectionStore(app: AppEnv.app, kind: kind)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(state.name.isEmpty ? tr("settings_tab_integrations") : state.name)
            .navigationBarTitleDisplayMode(.inline)
            .onAppear { fill(state) }
            .onChange(of: state.formVersion) { _, _ in fill(model.state) }
            .onChange(of: state.notice) { _, text in
                if let text {
                    notice = text
                    model.store.consumeNotice()
                }
            }
            .noticeAlert($notice)
            .confirmationDialog(
                state.disconnectTitle,
                isPresented: $confirmingDisconnect,
                titleVisibility: .visible
            ) {
                Button(tr("integration_disconnect_confirm"), role: .destructive) {
                    model.store.disconnect()
                }
                Button(tr("common_cancel"), role: .cancel) {}
            } message: {
                Text(state.disconnectText)
            }
    }

    @ViewBuilder
    private func content(_ state: IntegrationState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            List {
                statusSection(state)
                if state.canEdit {
                    formSection(state)
                    actionsSection(state)
                } else {
                    Section {
                        if let note = state.readOnlyNote {
                            Text(note)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        if let message = state.actionError {
                            FieldError(text: message)
                        }
                    }
                }
                Section {
                    BrowserRow(title: tr("settings_tab_integrations"), url: state.browserUrl)
                }
            }
        }
    }

    private func statusSection(_ state: IntegrationState) -> some View {
        Section {
            Text(state.description_)
                .font(.footnote)
                .foregroundStyle(.secondary)
            HStack {
                Text(state.name)
                Spacer()
                Badge(text: state.statusText, color: Tone.color(state.statusTone))
            }
            if let errorText = state.errorText {
                VStack(alignment: .leading, spacing: 2) {
                    Text(tr("integration_error_title"))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.red)
                    FieldError(text: errorText)
                }
            }
            ForEach(state.details, id: \.label) { row in
                ValueRow(label: row.label, value: row.value)
            }
            if let test = state.test {
                OutcomeView(outcome: test)
            }
            if let sync = state.sync {
                OutcomeView(outcome: sync)
            }
        }
    }

    private func formSection(_ state: IntegrationState) -> some View {
        Section {
            TextEntry(
                label: tr("integration_ha_url"),
                text: $baseUrl,
                error: state.fieldErrors["baseUrl"],
                keyboard: .URL,
                capitalization: .never
            )
            Text(state.urlHint)
                .font(.footnote)
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 4) {
                Text(state.tokenLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                SecureField("", text: $token)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                FieldError(text: state.fieldErrors["token"])
            }
            Text(state.configured ? tr("integration_ha_token_stored_hint") : state.tokenHint)
                .font(.footnote)
                .foregroundStyle(.secondary)
            ToggleEntry(label: tr("integration_ha_insecure"), isOn: $allowInsecureTls, hint: state.insecureHint)
            ToggleEntry(label: tr("integration_ha_enabled"), isOn: $enabled, hint: state.enabledHint)
        }
    }

    private func actionsSection(_ state: IntegrationState) -> some View {
        Section {
            if let message = state.actionError {
                FieldError(text: message)
            }
            Button(state
                .saving ? tr("common_saving") : (state.configured ? tr("common_save") : tr("integration_connect")))
            {
                model.store.save(
                    form: IntegrationForm(
                        baseUrl: baseUrl,
                        token: token,
                        allowInsecureTls: allowInsecureTls,
                        enabled: enabled
                    )
                )
            }
            .disabled(state.saving || state.testing)
            if state.configured {
                Button(state.testing ? tr("integration_testing") : tr("integration_test")) {
                    model.store.test()
                }
                .disabled(state.testing || state.saving)
                if state.canSync {
                    Button(state.syncing ? tr("integration_kept_sync_running") : tr("integration_kept_sync_now")) {
                        model.store.syncNow()
                    }
                    .disabled(state.syncing)
                }
                Button(tr("integration_disconnect"), role: .destructive) {
                    confirmingDisconnect = true
                }
                .disabled(state.disconnecting)
            }
        }
    }

    private func fill(_ state: IntegrationState) {
        guard state.formVersion > 0, state.formVersion != filledVersion else { return }
        baseUrl = state.initial.baseUrl
        token = state.initial.token
        allowInsecureTls = state.initial.allowInsecureTls
        enabled = state.initial.enabled
        filledVersion = state.formVersion
    }
}
