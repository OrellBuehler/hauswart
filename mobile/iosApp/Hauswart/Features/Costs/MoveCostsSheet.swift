import shared
import SwiftUI

/// Moves the entries picked in the costs list into another book; `onDone` gets what the move did in one line.
struct MoveCostsSheet: View {
    @StateObject private var model: Observed<MoveCostsStore, MoveCostsState>
    @Environment(\.dismiss) private var dismiss
    private let onDone: (String) -> Void

    init(pick: MovePick, onDone: @escaping (String) -> Void) {
        self.onDone = onDone
        _model = StateObject(wrappedValue: Observed(MoveCostsStore(app: AppEnv.app, pick: pick)))
    }

    var body: some View {
        let state = model.state
        SheetForm(
            title: tr("costs_move_title"),
            saveLabel: tr("costs_move_submit"),
            saving: state.moving,
            onSave: { model.store.move() }
        ) {
            Section {
                Text(state.description_)
                    .font(.subheadline)
            }
            if let error = state.loadError {
                Section {
                    ErrorBanner(error: error)
                    Button(tr("common_retry")) { model.store.retry() }
                }
            } else {
                Section {
                    Picker(tr("costs_move_to"), selection: bookBinding) {
                        ForEach(state.books, id: \.id) { book in
                            Text(book.name).tag(book.id)
                        }
                    }
                    FieldError(text: state.bookError)
                    if let note = state.taxNote {
                        Text(note)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            if state.error != nil {
                Section {
                    ErrorBanner(error: state.error)
                }
            }
        }
        .onChange(of: state.doneText) { _, text in
            if let text {
                onDone(text)
                dismiss()
            }
        }
    }

    private var bookBinding: Binding<String> {
        Binding(
            get: { model.state.bookId },
            set: { model.store.chooseBook(id: $0) }
        )
    }
}
