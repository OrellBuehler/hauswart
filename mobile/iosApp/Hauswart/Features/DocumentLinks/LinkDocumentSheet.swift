import shared
import SwiftUI

/// Search the document system, choose a document, say what it is for and link it to the owner.
/// Presented as a sheet by `DocumentLinksSection`.
struct LinkDocumentSheet: View {
    @StateObject private var model: Observed<LinkDocumentStore, LinkDocumentState>
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var role: String
    @State private var label = ""

    init(ownerType: String, ownerId: String) {
        _model = StateObject(wrappedValue: Observed(LinkDocumentStore(
            app: AppEnv.app,
            ownerType: ownerType,
            ownerId: ownerId
        )))
        _role = State(initialValue: LinkDocumentStoreKt.defaultDocumentRole(ownerType: ownerType))
    }

    var body: some View {
        let state = model.state
        NavigationStack {
            content(state)
                .navigationTitle(tr("document_link_title"))
                .navigationBarTitleDisplayMode(.inline)
                .searchable(text: $query, prompt: tr("document_link_search_placeholder"))
                .onChange(of: query) { _, value in
                    model.store.setQuery(query: value)
                }
                .onChange(of: state.linked) { _, _ in
                    dismiss()
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(tr("common_cancel")) { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(state.submitting ? tr("common_saving") : tr("document_link_submit")) {
                            model.store.submit(form: LinkDocumentForm(role: role, label: label))
                        }
                        .disabled(state.submitting || state.selectedId.isEmpty)
                    }
                }
        }
    }

    private func content(_ state: LinkDocumentState) -> some View {
        List {
            Section {
                if let error = state.error {
                    ErrorView(error: error) { model.store.retry() }
                } else if state.loading, state.rows.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else if state.rows.isEmpty {
                    Text(blank(state) ? tr("document_link_none_synced") : tr("document_link_no_match"))
                        .foregroundStyle(.secondary)
                }
                ForEach(state.rows, id: \.id) { row in
                    resultRow(row, state)
                }
                if let moreError = state.moreError {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(moreError.message)
                            .foregroundStyle(.red)
                        Button(tr("common_retry")) { model.store.loadMore() }
                            .buttonStyle(.borderless)
                    }
                } else if state.hasMore {
                    Button(tr("common_load_more")) { model.store.loadMore() }
                        .buttonStyle(.borderless)
                        .disabled(state.loadingMore)
                }
            } header: {
                Text(blank(state) ? tr("document_link_search_hint") : tr("document_link_search_live"))
                    .textCase(nil)
            } footer: {
                if let title = state.selectedTitle {
                    Text(tr("document_link_selected", ["title": title]))
                } else {
                    Text(tr("document_link_none_selected"))
                }
            }
            Section {
                ChoiceEntry(
                    label: tr("document_link_role"),
                    selection: $role,
                    options: LinkDocumentStoreKt.DOCUMENT_LINK_ROLES.map { Choice(
                        value: $0,
                        label: LinkDocumentStoreKt.documentRoleLabel(role: $0)
                    ) }
                )
                TextEntry(label: tr("document_link_label"), text: $label)
                FieldError(text: state.submitError)
            }
        }
    }

    private func blank(_ state: LinkDocumentState) -> Bool {
        state.query.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func resultRow(_ row: DocumentChoiceRow, _ state: LinkDocumentState) -> some View {
        Button {
            model.store.select(id: row.id)
        } label: {
            HStack(spacing: 12) {
                ThumbImage(
                    version: state.thumbs,
                    placeholder: "doc.text",
                    width: 36,
                    height: 48,
                    request: { model.store.requestThumbnail(id: row.id) },
                    load: { model.store.thumbnailBase64(id: row.id) }
                )
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.title)
                        .lineLimit(2)
                        .foregroundStyle(Color.primary)
                    if !row.details.isEmpty {
                        Text(row.details)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    if !row.tags.isEmpty {
                        Text(row.tags)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    if row.linkedHere {
                        Badge(text: tr("document_link_already_here"))
                    } else if !row.usedIn.isEmpty {
                        Text(row.usedIn)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
                if state.selectedId == row.id {
                    Image(systemName: "checkmark")
                        .foregroundStyle(Color.accentColor)
                }
            }
        }
    }
}
