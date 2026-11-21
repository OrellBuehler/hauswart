import shared
import SwiftUI

/// The book form is opened for one of these: a new book or an existing one.
private struct BookTarget: Identifiable {
    let id = UUID()
    var bookId: String?
}

/// The cost books: the ones that take entries in their order, and the archived ones.
struct CostBooksScreen: View {
    @StateObject private var model = Observed(CostBooksStore(app: AppEnv.app))
    @State private var target: BookTarget?
    @State private var deleteId: String?
    @State private var confirmingDelete = false

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("costbook_settings_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        target = BookTarget(bookId: nil)
                    } label: {
                        Label(tr("costbook_new"), systemImage: "plus")
                    }
                }
            }
            .sheet(item: $target) { item in
                BookEditScreen(id: item.bookId)
            }
            .confirmDelete(
                tr("costbook_delete_title"),
                message: deleteId.map { model.store.deleteText(id: $0) } ?? "",
                isPresented: $confirmingDelete
            ) {
                if let id = deleteId { model.store.delete(id: id) }
            }
    }

    @ViewBuilder
    private func content(_ state: CostBooksState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.total == 0 {
            ErrorView(error: error) { model.store.refresh() }
        } else if state.total == 0 {
            EmptyStateView(title: tr("costbook_empty_title"), message: tr("costbook_empty_body"), systemImage: "books.vertical")
        } else {
            list(state)
        }
    }

    private func list(_ state: CostBooksState) -> some View {
        List {
            if let notice = state.notice {
                Section {
                    CostsNoticeRow(message: notice) { model.store.dismissNotice() }
                }
            }
            if state.actionError != nil {
                Section {
                    ErrorBanner(error: state.actionError)
                }
            }
            Section {
                Text(tr("costbook_settings_description"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Section {
                ForEach(state.open, id: \.id) { book in
                    bookRow(book, busy: state.busyId == book.id)
                }
            } header: {
                Text(tr("costbook_open_section"))
            }
            if !state.archived.isEmpty {
                Section {
                    ForEach(state.archived, id: \.id) { book in
                        bookRow(book, busy: state.busyId == book.id)
                    }
                } header: {
                    Text(tr("costbook_archived_section"))
                } footer: {
                    Text(tr("costbook_archived_section_hint"))
                }
            }
        }
        .refreshable { model.store.refresh() }
    }

    private func bookRow(_ book: BookRowView, busy: Bool) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(book.name)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    if book.isDefault {
                        Badge(text: tr("costbook_default_badge"), color: .green)
                    }
                    if book.archived {
                        Badge(text: tr("costbook_archived_badge"))
                    }
                    if book.taxRelevant {
                        Badge(text: tr("costbook_tax_badge"))
                    }
                }
                Text(book.meta)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if busy {
                ProgressView()
            } else {
                Menu {
                    Button {
                        target = BookTarget(bookId: book.id)
                    } label: {
                        Label(tr("common_edit"), systemImage: "pencil")
                    }
                    if book.canMakeDefault {
                        Button {
                            model.store.makeDefault(id: book.id)
                        } label: {
                            Label(tr("costbook_make_default"), systemImage: "star")
                        }
                    }
                    if book.canMoveUp {
                        Button {
                            model.store.move(id: book.id, delta: -1)
                        } label: {
                            Label(tr("costbook_move_up"), systemImage: "arrow.up")
                        }
                    }
                    if book.canMoveDown {
                        Button {
                            model.store.move(id: book.id, delta: 1)
                        } label: {
                            Label(tr("costbook_move_down"), systemImage: "arrow.down")
                        }
                    }
                    if book.archived {
                        Button {
                            model.store.restore(id: book.id)
                        } label: {
                            Label(tr("costbook_restore"), systemImage: "arrow.uturn.backward")
                        }
                    } else {
                        Button {
                            model.store.archive(id: book.id)
                        } label: {
                            Label(tr("costbook_archive"), systemImage: "archivebox")
                        }
                    }
                    Button(role: .destructive) {
                        deleteId = book.id
                        confirmingDelete = true
                    } label: {
                        Label(tr("common_delete"), systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(tr("costbook_actions", ["name": book.name]))
            }
        }
    }
}
