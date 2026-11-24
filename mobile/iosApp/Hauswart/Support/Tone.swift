import SwiftUI

/// The colour of a tone the shared module names: "overdue", "due", "ok", "muted", "normal".
enum Tone {
    static func color(_ tone: String) -> Color {
        switch tone {
        case "overdue": return .red
        case "due": return .orange
        case "ok": return .green
        case "muted": return .secondary
        default: return .primary
        }
    }
}
