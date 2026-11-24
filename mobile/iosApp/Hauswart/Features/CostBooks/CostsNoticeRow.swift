import SwiftUI

/// A message after an action with an optional action of its own ("View"); put it in its own `Section` of a `List`.
struct CostsNoticeRow: View {
    let message: String
    var actionLabel: String? = nil
    var action: (() -> Void)? = nil
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text(message)
                .font(.footnote)
            Spacer()
            if let actionLabel, let action {
                Button(actionLabel) { action() }
                    .buttonStyle(.borderless)
            }
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
            }
            .buttonStyle(.borderless)
        }
    }
}
