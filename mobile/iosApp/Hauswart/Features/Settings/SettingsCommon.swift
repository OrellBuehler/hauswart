import shared
import SwiftUI

/// The route of the settings sub-screen a `SettingsEntry.id` names; nil for one this build does not know.
enum SettingsRoutes {
    static func route(for id: String) -> Route? {
        switch id {
        case "notifications": .settingsNotifications
        case "reminders": .settingsReminders
        case "contact_sync": .settingsContactSync
        case "household": .settingsHousehold
        case "integrations": .settingsIntegrations
        case "calendar": .settingsCalendar
        default: nil
        }
    }
}

/// A row that hands `url` to the system browser: what a device token cannot do stays in the web app.
struct BrowserRow: View {
    let title: String
    let url: String
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            if let target = URL(string: url) { openURL(target) }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .foregroundStyle(.primary)
                    Text(tr("m_settings_open_browser"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Image(systemName: "arrow.up.right.square")
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// The answer of a test or a sync: the result and its detail lines.
struct OutcomeView: View {
    let outcome: IntegrationOutcome

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(outcome.title, systemImage: outcome.ok ? "checkmark.circle" : "exclamationmark.triangle")
                .foregroundStyle(outcome.ok ? Color.green : Color.red)
            ForEach(outcome.lines, id: \.self) { line in
                Text(line)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

extension View {
    /// Shows a one-shot message from a store; clears it when dismissed.
    func noticeAlert(_ text: Binding<String?>) -> some View {
        alert(
            text.wrappedValue ?? "",
            isPresented: Binding(
                get: { text.wrappedValue != nil },
                set: { if !$0 { text.wrappedValue = nil } }
            )
        ) {
            Button(tr("m_common_ok")) {}
        }
    }
}

func settingsChoices(_ options: [SettingsOption]) -> [Choice] {
    options.map { Choice(value: $0.value, label: $0.label) }
}
