import shared
import SwiftUI

struct SettingsScreen: View {
    @StateObject private var model = Observed(SettingsStore(app: AppEnv.app))
    @State private var confirmingSignOut = false

    var body: some View {
        let state = model.state
        List {
            if state.error != nil {
                Section {
                    ErrorBanner(error: state.error)
                }
            }
            Section(tr("account_title")) {
                ValueRow(label: tr("auth_display_name"), value: state.userName)
                ValueRow(label: tr("account_username"), value: state.username)
                Picker(tr("language_label"), selection: language) {
                    ForEach(state.languages, id: \.code) { option in
                        Text(option.label).tag(option.code)
                    }
                }
            }
            Section(tr("m_settings_section_system")) {
                ForEach(state.entries, id: \.id) { entry in
                    if let route = SettingsRoutes.route(for: entry.id) {
                        NavigationLink(value: route) {
                            Text(entry.title)
                        }
                    }
                }
            }
            if !state.browserLinks.isEmpty {
                Section(tr("m_settings_section_browser")) {
                    ForEach(state.browserLinks, id: \.id) { link in
                        BrowserRow(title: link.title, url: link.url)
                    }
                }
            }
            Section(tr("m_settings_server")) {
                ValueRow(label: tr("m_settings_server"), value: state.serverUrl)
                ValueRow(label: tr("m_settings_server_version"), value: state.serverVersion)
                ValueRow(label: tr("m_settings_signed_in_until"), value: state.signedInUntil)
            }
            Section(tr("m_settings_about")) {
                ValueRow(label: tr("m_settings_app_version"), value: SettingsScreen.appVersion)
            }
            Section {
                Button(tr("auth_logout"), role: .destructive) {
                    confirmingSignOut = true
                }
                .disabled(state.signingOut)
            }
        }
        .navigationTitle(tr("settings_title"))
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            tr("m_settings_signout_title"),
            isPresented: $confirmingSignOut,
            titleVisibility: .visible
        ) {
            Button(tr("auth_logout"), role: .destructive) {
                model.store.signOut()
            }
            Button(tr("common_cancel"), role: .cancel) {}
        } message: {
            Text(tr("m_settings_signout_text"))
        }
    }

    private var language: Binding<String> {
        Binding(
            get: { model.state.language },
            set: { model.store.setLanguage(code: $0) }
        )
    }

    private static var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    }
}
