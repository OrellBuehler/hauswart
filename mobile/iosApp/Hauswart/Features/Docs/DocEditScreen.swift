import shared
import SwiftUI

/// Creates a page (`slug` nil) or edits one: the fields of the web form and a plain Markdown text,
/// with a rendered preview. Presented as a sheet; `onSaved` gets the address of the saved page.
struct DocEditScreen: View {
    @StateObject private var model: Observed<DocEditStore, DocEditState>
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    private let onSaved: (String) -> Void

    @State private var shownVersion: Int32 = 0
    @State private var loaded = false
    @State private var title = ""
    @State private var section = "general"
    @State private var assetId = ""
    @State private var roomId = ""
    @State private var pinned = false
    @State private var guestVisible = false
    @State private var text = ""
    @State private var previewing = false
    @State private var confirmingLeave = false
    @State private var inserting = false

    init(
        slug: String?,
        section: String,
        assetId: String,
        roomId: String,
        title: String,
        onSaved: @escaping (String) -> Void
    ) {
        self.onSaved = onSaved
        _model = StateObject(wrappedValue: Observed(DocEditStore(
            app: AppEnv.app,
            slug: slug,
            section: section,
            assetId: assetId,
            roomId: roomId,
            title: title
        )))
    }

    var body: some View {
        let state = model.state
        NavigationStack {
            content(state)
                .navigationTitle(tr(state.isNew ? "editor_new_title" : "editor_edit_title"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(tr("common_cancel")) {
                            if dirty(state) { confirmingLeave = true } else { dismiss() }
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(state.saving ? tr("common_saving") : tr("common_save")) {
                            model.store.save(form: form)
                        }
                        .disabled(state.saving || !loaded)
                    }
                }
        }
        .interactiveDismissDisabled(dirty(state))
        .onAppear { fill(state) }
        .onChange(of: state.initialVersion) { _, _ in
            fill(model.state)
        }
        .onChange(of: state.savedSlug) { _, slug in
            if let slug {
                onSaved(slug)
                dismiss()
            }
        }
        .confirmationDialog(tr("editor_leave_title"), isPresented: $confirmingLeave, titleVisibility: .visible) {
            Button(tr("editor_leave_confirm"), role: .destructive) { dismiss() }
            Button(tr("common_cancel"), role: .cancel) {}
        } message: {
            Text(tr("editor_leave_description"))
        }
        .alert(tr("editor_conflict_title"), isPresented: conflictBinding) {
            Button(tr("editor_conflict_keep")) { model.store.keepMine(form: form) }
            Button(tr("editor_conflict_reload"), role: .destructive) { model.store.reloadTheirs() }
            Button(tr("editor_conflict_close"), role: .cancel) {}
        } message: {
            Text(state.conflictMessage + "\n" + tr("editor_conflict_keep_hint"))
        }
        .sheet(isPresented: $inserting) {
            InsertAttachmentSheet(pageId: state.pageId) { markdown in
                text = (text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : text + "\n\n") + markdown + "\n"
            }
        }
    }

    @ViewBuilder
    private func content(_ state: DocEditState) -> some View {
        if let error = state.loadError {
            ErrorView(error: error) { model.store.retry() }
        } else if !loaded {
            LoadingView()
        } else {
            VStack(spacing: 0) {
                Picker("", selection: $previewing) {
                    Text(tr("editor_tab_write")).tag(false)
                    Text(tr("editor_tab_preview")).tag(true)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.vertical, 8)
                .onChange(of: previewing) { _, on in
                    if on { model.store.preview(body: text) }
                }
                if previewing {
                    previewView(state)
                } else {
                    formView(state)
                }
            }
        }
    }

    private func previewView(_ state: DocEditState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error = state.previewError {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding(.horizontal)
            }
            if state.previewLoading {
                ProgressView()
                    .padding(.horizontal)
            }
            if state.previewHtml.isEmpty, !state.previewLoading, state.previewError == nil {
                Text(tr("editor_preview_empty"))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)
            }
            if !state.previewHtml.isEmpty {
                DocWebView(bodyHtml: state.previewHtml, dark: colorScheme == .dark) { _ in true }
            }
            Spacer(minLength: 0)
        }
    }

    private func formView(_ state: DocEditState) -> some View {
        Form {
            if state.error != nil {
                Section {
                    ErrorBanner(error: state.error)
                }
            }
            Section {
                TextEntry(label: tr("docs_field_title"), text: $title, error: state.fieldErrors["title"])
                ChoiceEntry(label: tr("docs_field_section"), selection: $section, options: sections)
                PickEntry(
                    label: tr("docs_field_asset"),
                    noneLabel: tr("docs_field_none"),
                    options: state.assets.map { PickChoice(id: $0.id, label: $0.label, detail: "") },
                    selection: $assetId,
                    error: state.fieldErrors["assetId"]
                )
                PickEntry(
                    label: tr("docs_field_room"),
                    noneLabel: tr("docs_field_none"),
                    options: state.rooms.map { PickChoice(id: $0.id, label: $0.label, detail: "") },
                    selection: $roomId,
                    error: state.fieldErrors["roomId"]
                )
                ToggleEntry(label: tr("docs_field_pinned"), isOn: $pinned, hint: tr("docs_field_pinned_hint"))
                ToggleEntry(label: tr("docs_field_guest"), isOn: $guestVisible, hint: tr("docs_field_guest_hint"))
            }
            Section(tr("editor_text")) {
                TextField(tr("editor_placeholder"), text: $text, axis: .vertical)
                    .lineLimit(10 ... 60)
                    .font(.system(.body, design: .monospaced))
                    .textInputAutocapitalization(.sentences)
                FieldError(text: state.fieldErrors["bodyMd"])
                Text(DocsStoresKt.docSizeText(body: text))
                    .font(.footnote)
                    .foregroundStyle(DocsStoresKt.docSizeWarning(body: text) ? Color.red : Color.secondary)
                if !state.pageId.isEmpty {
                    Button(tr("editor_insert_attachment")) { inserting = true }
                        .buttonStyle(.borderless)
                }
            }
            if state.pageId.isEmpty {
                Section {
                    Text(tr("editor_new_uploads_hint"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } else {
                AttachmentsSection(ownerType: "page", ownerId: state.pageId)
            }
        }
    }

    private var sections: [Choice] {
        DocsStoresKt.DOC_SECTIONS.map { Choice(value: $0, label: DocsStoresKt.docSectionLabel(section: $0)) }
    }

    private var conflictBinding: Binding<Bool> {
        Binding(
            get: { model.state.conflict },
            set: { if !$0 { model.store.dismissConflict() } }
        )
    }

    private var form: DocForm {
        DocForm(
            title: title,
            section: section,
            assetId: assetId,
            roomId: roomId,
            pinned: pinned,
            guestVisible: guestVisible,
            body: text
        )
    }

    private func dirty(_ state: DocEditState) -> Bool {
        guard loaded, let initial = state.initial else { return false }
        return title != initial.title || section != initial.section || assetId != initial.assetId
            || roomId != initial.roomId || pinned != initial.pinned || guestVisible != initial.guestVisible
            || text != initial.body
    }

    private func fill(_ state: DocEditState) {
        guard let initial = state.initial, !loaded || shownVersion != state.initialVersion else { return }
        title = initial.title
        section = initial.section
        assetId = initial.assetId
        roomId = initial.roomId
        pinned = initial.pinned
        guestVisible = initial.guestVisible
        text = initial.body
        shownVersion = state.initialVersion
        loaded = true
    }
}

private struct InsertAttachmentSheet: View {
    let onPick: (String) -> Void
    @StateObject private var model: Observed<AttachmentsStore, AttachmentsState>
    @Environment(\.dismiss) private var dismiss

    init(pageId: String, onPick: @escaping (String) -> Void) {
        self.onPick = onPick
        _model = StateObject(wrappedValue: Observed(AttachmentsStore(app: AppEnv.app, ownerType: "page", ownerId: pageId)))
    }

    var body: some View {
        NavigationStack {
            List {
                if model.state.rows.isEmpty {
                    Text(tr("editor_attachment_empty"))
                        .foregroundStyle(.secondary)
                }
                ForEach(model.state.rows, id: \.id) { row in
                    Button {
                        onPick(DocsStoresKt.docAttachmentMarkdown(
                            id: row.id,
                            filename: row.filename,
                            caption: row.caption,
                            isImage: row.kind == "image"
                        ))
                        dismiss()
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.label)
                                .foregroundStyle(Color.primary)
                            Text(row.sizeText)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationTitle(tr("editor_attachment_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(tr("common_cancel")) { dismiss() }
                }
            }
        }
    }
}
