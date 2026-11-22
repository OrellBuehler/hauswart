import shared
import SwiftUI

/// Tells that the sign-in of this device ends soon, with a button that signs out to the sign-in
/// screen (server address and user name are kept, so it takes one password entry). Shows nothing
/// until it is time. Place it once as a section of a `List`:
///
///     SessionExpiryNotice()
struct SessionExpiryNotice: View {
    @StateObject private var model = Observed(SessionNoticeStore(app: AppEnv.app))

    var body: some View {
        let state = model.state
        if let message = state.message {
            Section {
                Label(message, systemImage: "info.circle")
                    .font(.footnote)
                Button(state.actionLabel) {
                    model.store.signInAgain()
                }
                .disabled(state.signingOut)
            }
        }
    }
}
