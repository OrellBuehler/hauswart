import shared
import SwiftUI

/// First start and signed-out state: choose the server, then sign in.
struct ConnectScreen: View {
    @StateObject private var model = Observed(ConnectStore(app: AppEnv.app))
    @State private var server = ""
    @State private var username = ""
    @State private var password = ""

    var body: some View {
        let state = model.state
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(tr("app_name"))
                            .font(.largeTitle.weight(.bold))
                        Text(tr("app_tagline"))
                            .foregroundStyle(.secondary)
                    }
                    .listRowBackground(Color.clear)
                }
                if state.step == "server" {
                    serverStep(state)
                } else {
                    loginStep(state)
                }
            }
        }
        .onAppear {
            if server.isEmpty { server = state.serverUrl }
            if username.isEmpty { username = state.username }
        }
    }

    @ViewBuilder
    private func serverStep(_ state: ConnectState) -> some View {
        Section {
            TextField(tr("m_connect_server_label"), text: $server)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.continue)
                .onSubmit { model.store.checkServer(input: server) }
            FieldError(text: state.error)
        } header: {
            Text(tr("m_connect_title"))
        } footer: {
            Text(tr("m_connect_explain"))
        }
        Section {
            Button(state.busy ? tr("m_connect_checking") : tr("m_connect_continue")) {
                model.store.checkServer(input: server)
            }
            .disabled(state.busy || server.isEmpty)
        }
    }

    @ViewBuilder
    private func loginStep(_ state: ConnectState) -> some View {
        Section(tr("m_connect_server")) {
            HStack {
                Text(state.serverUrl)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                Button(tr("m_connect_change_server")) {
                    model.store.changeServer()
                }
                .buttonStyle(.borderless)
            }
        }
        if state.needsSetup {
            Section {
                Label(tr("m_connect_setup_needed"), systemImage: "info.circle")
                    .font(.footnote)
            }
        }
        Section(tr("auth_login_title")) {
            TextField(tr("auth_username"), text: $username)
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            SecureField(tr("auth_password"), text: $password)
                .textContentType(.password)
                .onSubmit { model.store.signIn(username: username, password: password) }
            FieldError(text: state.error)
        }
        Section {
            Button(state.busy ? tr("auth_login_pending") : tr("auth_login_submit")) {
                model.store.signIn(username: username, password: password)
            }
            .disabled(state.busy)
        }
    }
}
