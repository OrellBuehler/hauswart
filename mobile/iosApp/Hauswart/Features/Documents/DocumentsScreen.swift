import shared
import SwiftUI

struct DocumentsScreen: View {
    @StateObject private var model = Observed(DocumentsListStore(app: AppEnv.app))
    @State private var query = ""
    @State private var suggestionKind: String? = nil

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("nav_documents"))
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(item: $suggestionKind) { kind in
                DocumentSuggestionsScreen(kind: kind)
            }
            .toolbar {
                if state.connected?.boolValue == true {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button {
                                suggestionKind = DocumentsStoresKt.SUGGESTION_ASSET
                            } label: {
                                Label(tr("document_suggestions_asset_title"), systemImage: "shippingbox")
                            }
                            Button {
                                suggestionKind = DocumentsStoresKt.SUGGESTION_CONTACT
                            } label: {
                                Label(tr("document_suggestions_contact_title"), systemImage: "person.crop.circle.badge.plus")
                            }
                        } label: {
                            Label(tr("docs_actions"), systemImage: "ellipsis.circle")
                        }
                    }
                }
            }
    }

    @ViewBuilder
    private func content(_ state: DocumentsListState) -> some View {
        if state.connected?.boolValue == false {
            EmptyStateView(
                title: tr("documents_not_connected_title"),
                message: tr("documents_not_connected_body") + "\n" + tr("m_documents_connect_in_web"),
                systemImage: "doc.on.doc"
            )
        } else if state.connected == nil, state.loading {
            LoadingView()
        } else if let error = state.error, state.rows.isEmpty, state.connected?.boolValue != true {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            list(state)
                .searchable(text: $query, prompt: tr("documents_search_placeholder"))
                .onChange(of: query) { _, value in
                    model.store.setQuery(query: value)
                }
        }
    }

    private func list(_ state: DocumentsListState) -> some View {
        List {
            if !state.connectionWarning.isEmpty {
                Section {
                    Text(state.connectionWarning)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
            Section {
                Picker(tr("documents_filter_linked"), selection: linkedBinding) {
                    ForEach(DocumentsStoresKt.DOCUMENTS_LINKED_FILTERS, id: \.self) { filter in
                        Text(DocumentsStoresKt.documentsLinkedLabel(filter: filter)).tag(filter)
                    }
                }
                .pickerStyle(.segmented)
                Text(tr(query.trimmingCharacters(in: .whitespaces).isEmpty ? "document_link_search_hint" : "document_link_search_live"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if state.filtered {
                    Button(tr("documents_filter_reset")) {
                        query = ""
                        model.store.resetFilters()
                    }
                }
            }
            if state.loading {
                Section { ProgressView() }
            } else if let error = state.error {
                Section {
                    ErrorBanner(error: error)
                    Button(tr("common_retry")) { model.store.refresh() }
                }
            } else if state.rows.isEmpty {
                if state.filtered {
                    EmptyStateView(
                        title: tr("documents_no_match_title"),
                        message: tr("documents_no_match_body"),
                        systemImage: "magnifyingglass"
                    )
                } else {
                    EmptyStateView(
                        title: tr("documents_empty_title"),
                        message: tr("documents_empty_body"),
                        systemImage: "doc.on.doc"
                    )
                }
            }
            Section {
                ForEach(state.rows, id: \.id) { row in
                    NavigationLink {
                        DocumentDetailScreen(id: row.id)
                    } label: {
                        DocumentRowView(row: row, state: state, store: model.store)
                    }
                }
                if let error = state.moreError {
                    ErrorBanner(error: error)
                }
                if state.hasMore {
                    Button(state.loadingMore ? tr("common_loading") : tr("common_load_more")) {
                        model.store.loadMore()
                    }
                    .disabled(state.loadingMore)
                }
            }
        }
        .refreshable { model.store.refresh() }
    }

    private var linkedBinding: Binding<String> {
        Binding(
            get: { model.state.linked },
            set: { model.store.setLinked(filter: $0) }
        )
    }
}

private struct DocumentRowView: View {
    let row: DocumentRowItem
    let state: DocumentsListState
    let store: DocumentsListStore

    var body: some View {
        HStack(spacing: 12) {
            ThumbImage(
                version: state.thumbs,
                placeholder: "doc.text",
                width: 36,
                height: 48,
                request: { store.requestThumbnail(id: row.id) },
                load: { store.thumbnailBase64(id: row.id) }
            )
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .lineLimit(2)
                if !row.details.isEmpty {
                    Text(row.details)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if !row.tags.isEmpty {
                    Text((row.tags + (row.moreTags > 0 ? ["+" + String(row.moreTags)] : [])).joined(separator: ", "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if !row.warranty.isEmpty {
                    Text(row.warranty)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if row.unused {
                    Badge(text: tr("documents_unused"))
                } else {
                    Text(row.usedIn)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
    }
}
