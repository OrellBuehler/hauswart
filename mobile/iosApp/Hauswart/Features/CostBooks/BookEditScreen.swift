import shared
import SwiftUI

/// What the book form holds, as Swift values the fields bind to; `kotlin` is the form the store takes.
struct BookFields {
    var name = ""
    var icon = ""
    var defaultSplitMode = "ownership"
    var taxRelevant = false

    init() {}

    init(_ form: BookForm) {
        name = form.name
        icon = form.icon
        defaultSplitMode = form.defaultSplitMode
        taxRelevant = form.taxRelevant
    }

    var kotlin: BookForm {
        BookForm(name: name, icon: icon, defaultSplitMode: defaultSplitMode, taxRelevant: taxRelevant)
    }
}

/// Makes a cost book (`id` nil) or changes one. Presented as a sheet.
struct BookEditScreen: View {
    @StateObject private var model: Observed<BookEditStore, BookEditState>
    @Environment(\.dismiss) private var dismiss

    @State private var loaded = false
    @State private var fields = BookFields()

    init(id: String?) {
        _model = StateObject(wrappedValue: Observed(BookEditStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        NavigationStack {
            content(state)
                .navigationTitle(state.isNew ? tr("costbook_create_title") : tr("costbook_edit_title"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(tr("common_cancel")) { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(state.saving ? tr("common_saving") : tr("common_save")) {
                            model.store.save(form: fields.kotlin)
                        }
                        .disabled(state.saving || !loaded)
                    }
                }
        }
        .onAppear { fill(state.initial) }
        .onChange(of: state.initial) { _, initial in
            fill(initial)
        }
        .onChange(of: state.savedId) { _, savedId in
            if savedId != nil { dismiss() }
        }
    }

    @ViewBuilder
    private func content(_ state: BookEditState) -> some View {
        if let error = state.loadError {
            ErrorView(error: error) { model.store.retry() }
        } else if !loaded {
            LoadingView()
        } else {
            Form {
                if state.error != nil {
                    Section {
                        ErrorBanner(error: state.error)
                    }
                }
                Section {
                    TextEntry(
                        label: tr("costbook_name"),
                        text: $fields.name,
                        error: state.fieldErrors["name"],
                        capitalization: .words
                    )
                    Picker(tr("costbook_icon"), selection: $fields.icon) {
                        Text(tr("m_costbooks_icon_none")).tag("")
                        ForEach(state.icons, id: \.value) { icon in
                            Text(icon.label).tag(icon.value)
                        }
                    }
                } footer: {
                    Text(tr(state.isNew ? "costbook_create_description" : "costbook_edit_description"))
                }
                Section {
                    Picker(tr("costbook_default_split"), selection: $fields.defaultSplitMode) {
                        ForEach(state.splits, id: \.value) { split in
                            Text(split.label).tag(split.value)
                        }
                    }
                } footer: {
                    Text(model.store.splitHint(mode: fields.defaultSplitMode))
                }
                Section {
                    ToggleEntry(
                        label: tr("costbook_tax_relevant"),
                        isOn: $fields.taxRelevant,
                        hint: tr("costbook_tax_relevant_hint")
                    )
                }
            }
        }
    }

    private func fill(_ initial: BookForm?) {
        guard !loaded, let initial else { return }
        fields = BookFields(initial)
        loaded = true
    }
}
