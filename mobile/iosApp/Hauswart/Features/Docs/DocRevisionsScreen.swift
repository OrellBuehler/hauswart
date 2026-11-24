import shared
import SwiftUI

struct DocRevisionsScreen: View {
    private let slug: String
    @StateObject private var model: Observed<DocRevisionsStore, DocRevisionsState>
    @Environment(\.dismiss) private var dismiss
    @State private var confirmingRestore = false

    init(slug: String) {
        self.slug = slug
        _model = StateObject(wrappedValue: Observed(DocRevisionsStore(app: AppEnv.app, slug: slug)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("docs_history_title"))
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: openedBinding) {
                if let opened = model.state.opened {
                    revisionSheet(opened, model.state)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let error = state.actionError {
                    KnowledgeNoticeBar(text: error.message) { model.store.dismissActionError() }
                }
            }
            .onChange(of: state.restored) { _, restored in
                if restored { dismiss() }
            }
    }

    @ViewBuilder
    private func content(_ state: DocRevisionsState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.rows.isEmpty {
            ErrorView(error: error) { model.store.refresh() }
        } else if state.rows.isEmpty {
            EmptyStateView(
                title: tr("docs_history_title"),
                message: tr("docs_history_description"),
                systemImage: "clock.arrow.circlepath"
            )
        } else {
            List {
                Section {
                    ForEach(state.rows, id: \.rev) { row in
                        Button {
                            model.store.open(rev: row.rev)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(tr("docs_revision_label", ["rev": row.rev]) + " · " + row.title)
                                        .foregroundStyle(Color.primary)
                                        .lineLimit(1)
                                    Text(row.details)
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                Spacer()
                                if state.opening == row.rev {
                                    ProgressView()
                                } else if row.current {
                                    Badge(text: tr("docs_revision_current"))
                                }
                            }
                        }
                    }
                } footer: {
                    Text(tr("docs_history_description"))
                }
            }
            .refreshable { model.store.refresh() }
        }
    }

    private func revisionSheet(_ opened: DocRevisionView, _ state: DocRevisionsState) -> some View {
        NavigationStack {
            List {
                Section {
                    Text(opened.markdown.isEmpty ? tr("docs_revision_empty") : opened.markdown)
                        .font(.system(.footnote, design: .monospaced))
                        .textSelection(.enabled)
                } header: {
                    Text(opened.title + " · " + tr("docs_revision_source"))
                }
                if opened.current {
                    Section {
                        Text(tr("docs_revision_is_current"))
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Section {
                        Button(state.restoring ? tr("docs_restoring") : tr("docs_restore")) {
                            confirmingRestore = true
                        }
                        .disabled(state.restoring)
                    }
                }
            }
            .navigationTitle(tr("docs_revision_label", ["rev": opened.rev]))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(tr("docs_history_back")) { model.store.closeOpened() }
                }
            }
            .confirmationDialog(
                tr("docs_restore_title", ["rev": opened.rev]),
                isPresented: $confirmingRestore,
                titleVisibility: .visible
            ) {
                Button(tr("docs_restore")) { model.store.restore(rev: opened.rev) }
                Button(tr("common_cancel"), role: .cancel) {}
            } message: {
                Text(tr("docs_restore_description"))
            }
        }
    }

    private var openedBinding: Binding<Bool> {
        Binding(
            get: { model.state.opened != nil },
            set: { if !$0 { model.store.closeOpened() } }
        )
    }
}
