import shared
import SwiftUI

/// What the tag form holds, as Swift values the fields bind to; `kotlin` is the form the store takes.
struct TagFields {
    var name = ""
    var color = "gray"

    init() {}

    init(_ form: TagForm) {
        name = form.name
        color = form.color
    }

    var kotlin: TagForm {
        TagForm(name: name, color: color)
    }
}

/// Makes a cost tag (`id` nil) or renames and recolours one. Presented as a sheet.
struct TagEditScreen: View {
    @StateObject private var model: Observed<TagEditStore, TagEditState>
    @Environment(\.dismiss) private var dismiss

    @State private var loaded = false
    @State private var fields = TagFields()

    init(id: String?) {
        _model = StateObject(wrappedValue: Observed(TagEditStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        NavigationStack {
            content(state)
                .navigationTitle(state.isNew ? tr("costtag_create_title") : tr("costtag_edit_title"))
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
    private func content(_ state: TagEditState) -> some View {
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
                        label: tr("costtag_name"),
                        text: $fields.name,
                        error: state.fieldErrors["name"],
                        capitalization: .words
                    )
                }
                Section {
                    ForEach(state.colors, id: \.value) { option in
                        Button {
                            fields.color = option.value
                        } label: {
                            HStack(spacing: 12) {
                                Circle()
                                    .fill(tagColor(option.value))
                                    .frame(width: 24, height: 24)
                                Text(option.label)
                                    .foregroundStyle(Color.primary)
                                Spacer()
                                if fields.color == option.value {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(Color.accentColor)
                                }
                            }
                        }
                    }
                } header: {
                    Text(tr("costtag_color"))
                }
            }
        }
    }

    private func fill(_ initial: TagForm?) {
        guard !loaded, let initial else { return }
        fields = TagFields(initial)
        loaded = true
    }
}
