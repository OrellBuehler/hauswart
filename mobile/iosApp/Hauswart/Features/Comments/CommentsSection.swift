import shared
import SwiftUI

/// The comments of one entity as a section of a `List` (or `Form`): the thread, edit and delete on
/// the person's own comments, and a field to write a new one.
///
///     CommentsSection(ownerType: "task", ownerId: task.id)
///
/// `ownerType` is the comments registry's entity type: task, defect, asset, room, part, contact,
/// service_log, asset_hint, doc_page, cost, insurance_policy or appointment. It loads and refreshes
/// itself and reports `comments` changes through the app.
struct CommentsSection: View {
    @StateObject private var model: Observed<CommentsStore, CommentsState>
    @State private var draft = ""
    @State private var editingId: String? = nil
    @State private var editDraft = ""
    @State private var deleteId: String? = nil
    @State private var confirmingDelete = false

    init(ownerType: String, ownerId: String) {
        _model = StateObject(wrappedValue: Observed(CommentsStore(app: AppEnv.app, ownerType: ownerType, ownerId: ownerId)))
    }

    var body: some View {
        let state = model.state
        Section {
            VStack(alignment: .leading, spacing: 16) {
                content(state)
            }
            .padding(.vertical, 4)
            .onChange(of: state.added) { _, _ in
                draft = ""
            }
            .onChange(of: state.edited) { _, _ in
                editingId = nil
            }
            .confirmDelete(
                tr("comments_delete_title"),
                message: tr("comments_delete_description"),
                isPresented: $confirmingDelete
            ) {
                if let id = deleteId { model.store.delete(id: id) }
            }
        } header: {
            Text(title(state))
        }
    }

    private func title(_ state: CommentsState) -> String {
        state.count > 0 ? tr("comments_title") + " · " + String(state.count) : tr("comments_title")
    }

    @ViewBuilder
    private func content(_ state: CommentsState) -> some View {
        if state.loading {
            ProgressView()
                .frame(maxWidth: .infinity)
        } else if let error = state.error, state.rows.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(error.message)
                    .foregroundStyle(.red)
                Button(tr("common_retry")) { model.store.refresh() }
                    .buttonStyle(.borderless)
            }
        } else {
            if state.rows.isEmpty {
                Text(tr("comments_empty"))
                    .foregroundStyle(.secondary)
            }
            ForEach(state.rows, id: \.id) { row in
                commentView(row, state)
            }
            ErrorBanner(error: state.actionError)
            composer(state)
        }
    }

    @ViewBuilder
    private func commentView(_ row: CommentRow, _ state: CommentsState) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.author)
                        .font(.subheadline.weight(.semibold))
                    Text(row.edited ? row.whenText + " (" + tr("comments_edited") + ")" : row.whenText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if editingId != row.id && row.canEdit {
                    Button {
                        editDraft = row.body
                        editingId = row.id
                        model.store.dismissEditError()
                    } label: {
                        Image(systemName: "pencil")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(tr("comments_edit"))
                }
                if editingId != row.id && row.canDelete {
                    Button {
                        deleteId = row.id
                        confirmingDelete = true
                    } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(tr("comments_delete"))
                }
            }
            if row.deleted {
                Text(tr("comments_deleted"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else if editingId == row.id {
                editor(row, state)
            } else {
                Text(attributed(row))
                    .font(.subheadline)
            }
        }
    }

    @ViewBuilder
    private func editor(_ row: CommentRow, _ state: CommentsState) -> some View {
        let saving = state.savingId == row.id
        VStack(alignment: .leading, spacing: 8) {
            TextField(tr("comments_edit_label"), text: $editDraft, axis: .vertical)
                .lineLimit(3 ... 10)
                .textFieldStyle(.roundedBorder)
                .disabled(saving)
            FieldError(text: state.editError?.message)
            HStack {
                Spacer()
                Button(tr("common_cancel")) {
                    editingId = nil
                    model.store.dismissEditError()
                }
                .buttonStyle(.bordered)
                .disabled(saving)
                Button(saving ? tr("common_saving") : tr("common_save")) {
                    model.store.edit(id: row.id, text: editDraft)
                }
                .buttonStyle(.borderedProminent)
                .disabled(saving || editDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    @ViewBuilder
    private func composer(_ state: CommentsState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField(tr("comments_composer_placeholder"), text: $draft, axis: .vertical)
                .lineLimit(2 ... 8)
                .textFieldStyle(.roundedBorder)
                .disabled(state.adding)
            FieldError(text: state.addError?.message)
            HStack {
                Spacer()
                Button(state.adding ? tr("comments_sending") : tr("comments_send")) {
                    model.store.add(text: draft)
                }
                .buttonStyle(.borderedProminent)
                .disabled(state.adding || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private func attributed(_ row: CommentRow) -> AttributedString {
        var result = AttributedString()
        for segment in row.segments {
            var part = AttributedString(segment.text)
            if let href = segment.href, let url = URL(string: href) {
                part.link = url
            }
            result.append(part)
        }
        return result
    }
}
