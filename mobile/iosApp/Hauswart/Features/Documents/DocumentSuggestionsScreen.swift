import shared
import SwiftUI

/// Receipts that no device stands for (kind `asset`) or correspondents that no contact stands for (`contact`).
struct DocumentSuggestionsScreen: View {
    private let kind: String
    @StateObject private var model: Observed<DocumentSuggestionsStore, DocumentSuggestionsState>
    @State private var showIgnored = false
    @State private var pushed: Route? = nil

    init(kind: String) {
        self.kind = kind
        _model = StateObject(wrappedValue: Observed(DocumentSuggestionsStore(app: AppEnv.app, kind: kind)))
    }

    private var isAsset: Bool {
        kind == DocumentsStoresKt.SUGGESTION_ASSET
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr(isAsset ? "document_suggestions_asset_title" : "document_suggestions_contact_title"))
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(item: $pushed) { route in
                destination(for: route)
            }
            .safeAreaInset(edge: .bottom) {
                if let text = state.notice {
                    HStack {
                        KnowledgeNoticeBar(text: text) { model.store.dismissNotice() }
                        if let link = state.createdLink, let route = Route.from(link: link) {
                            Button(tr("document_suggestion_open")) {
                                pushed = route
                                model.store.dismissNotice()
                            }
                            .padding(.trailing, 16)
                        }
                    }
                }
            }
    }

    @ViewBuilder
    private func content(_ state: DocumentSuggestionsState) -> some View {
        if state.loading, state.visible.isEmpty, state.ignored.isEmpty {
            LoadingView()
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else if state.none {
            EmptyStateView(
                title: tr("document_suggestions_empty_title"),
                message: tr(isAsset ? "document_suggestions_asset_empty_body" : "document_suggestions_contact_empty_body"),
                systemImage: "doc.text.magnifyingglass"
            )
        } else {
            List {
                Section {
                    Text(tr(isAsset ? "document_suggestions_asset_description" : "document_suggestions_contact_description"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if state.visible.isEmpty {
                    Text(tr("document_suggestions_all_handled"))
                }
                ForEach(state.visible, id: \.key) { row in
                    suggestion(row, state)
                }
                if !state.ignored.isEmpty {
                    Section {
                        Button(tr("document_suggestions_ignored", ["count": state.ignored.count])) {
                            showIgnored.toggle()
                        }
                        if showIgnored {
                            ForEach(state.ignored, id: \.key) { row in
                                HStack {
                                    Text(row.title)
                                    Spacer()
                                    Button(tr("device_suggestions_restore")) { model.store.restore(key: row.key) }
                                        .buttonStyle(.borderless)
                                }
                            }
                        }
                    }
                }
            }
            .refreshable { model.store.refresh() }
        }
    }

    private func suggestion(_ row: SuggestionRow, _ state: DocumentSuggestionsState) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(row.title)
                .font(.headline)
            if !row.subtitle.isEmpty {
                Text(row.subtitle)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if !row.warranty.isEmpty {
                Text(row.warranty)
                    .font(.footnote)
            }
            if let message = state.rowErrors[row.key] {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
            HStack {
                Button {
                    model.store.adopt(key: row.key)
                } label: {
                    Label(
                        tr(isAsset ? "document_suggestion_asset_create" : "document_suggestion_contact_create"),
                        systemImage: "checkmark"
                    )
                }
                .buttonStyle(.borderedProminent)
                Button(tr("device_suggestions_ignore")) { model.store.dismiss(key: row.key) }
                    .buttonStyle(.bordered)
            }
            .disabled(state.busyKey != nil)
        }
    }
}
