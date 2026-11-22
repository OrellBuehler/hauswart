import shared

/// The text of a message key in the app's language. The keys are the web app's
/// (`messages/de.json`) plus the mobile ones (`mobile/messages`); a test fails on a literal key
/// that does not exist.
func tr(_ key: String) -> String {
    I18n.shared.t(key: key)
}

func tr(_ key: String, _ args: [String: Any]) -> String {
    I18n.shared.t(key: key, args: args)
}
