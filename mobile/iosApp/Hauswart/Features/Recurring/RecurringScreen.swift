import shared
import SwiftUI

/// The recurring costs: the ones that book, the paused ones and the finished ones.
struct RecurringScreen: View {
    @StateObject private var model = Observed(RecurringListStore(app: AppEnv.app))
    @State private var editing: RecurringEditTarget?
    @State private var deleteId: String?
    @State private var confirmingDelete = false

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("recurrence_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        editing = RecurringEditTarget(recurringId: nil)
                    } label: {
                        Label(tr("recurrence_new"), systemImage: "plus")
                    }
                }
            }
            .sheet(item: $editing) { item in
                RecurringEditScreen(id: item.recurringId, book: nil)
            }
            .confirmDelete(
                tr("recurrence_delete_title"),
                message: deleteId.map { model.store.deleteText(id: $0) } ?? "",
                isPresented: $confirmingDelete
            ) {
                if let id = deleteId { model.store.delete(id: id) }
            }
    }

    @ViewBuilder
    private func content(_ state: RecurringListState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.total == 0 {
            ErrorView(error: error) { model.store.refresh() }
        } else if state.total == 0 {
            EmptyStateView(
                title: tr("recurrence_empty_title"),
                message: tr("recurrence_empty_body"),
                systemImage: "repeat"
            )
        } else {
            list(state)
        }
    }

    private func list(_ state: RecurringListState) -> some View {
        List {
            if let notice = state.notice {
                Section {
                    if let entryId = notice.entryId {
                        NavigationLink(value: Route.cost(entryId)) {
                            Text(notice.message)
                                .font(.footnote)
                        }
                    } else {
                        CostsNoticeRow(message: notice.message) { model.store.dismissNotice() }
                    }
                }
            }
            if state.actionError != nil {
                Section {
                    ErrorBanner(error: state.actionError)
                }
            }
            Section {
                Text(state.countText)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .listRowBackground(Color.clear)
            ForEach(state.sections, id: \.state) { section in
                Section {
                    ForEach(section.rows, id: \.id) { row in
                        NavigationLink(value: Route.recurringDetail(row.id)) {
                            RecurringRowLine(row: row, busy: state.busyId == row.id)
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                deleteId = row.id
                                confirmingDelete = true
                            } label: {
                                Label(tr("common_delete"), systemImage: "trash")
                            }
                            Button {
                                editing = RecurringEditTarget(recurringId: row.id)
                            } label: {
                                Label(tr("common_edit"), systemImage: "pencil")
                            }
                            .tint(.blue)
                        }
                        .contextMenu {
                            Button {
                                editing = RecurringEditTarget(recurringId: row.id)
                            } label: {
                                Label(tr("common_edit"), systemImage: "pencil")
                            }
                            if row.due {
                                Button {
                                    model.store.runNow(id: row.id)
                                } label: {
                                    Label(tr("recurrence_run_now"), systemImage: "checkmark.square")
                                }
                            }
                            if row.state == "active" {
                                Button {
                                    model.store.pause(id: row.id)
                                } label: {
                                    Label(tr("recurrence_pause"), systemImage: "pause")
                                }
                            }
                            if row.state == "paused" {
                                Button {
                                    model.store.resume(id: row.id)
                                } label: {
                                    Label(tr("recurrence_resume"), systemImage: "play")
                                }
                            }
                            Button(role: .destructive) {
                                deleteId = row.id
                                confirmingDelete = true
                            } label: {
                                Label(tr("common_delete"), systemImage: "trash")
                            }
                        }
                    }
                } header: {
                    Text(section.title)
                }
            }
        }
        .refreshable { model.store.refresh() }
    }
}

/// The recurring cost form is opened for one of these: a new one or an existing one.
struct RecurringEditTarget: Identifiable {
    let id = UUID()
    var recurringId: String?
}

private struct RecurringRowLine: View {
    let row: RecurringRowView
    let busy: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.title)
                        .lineLimit(2)
                    Text(row.subtitle)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                if busy {
                    ProgressView()
                } else {
                    Text(row.amount)
                        .foregroundStyle(row.refund ? Color.green : Color.primary)
                        .lineLimit(1)
                }
            }
            HStack(spacing: 8) {
                Badge(text: row.stateLabel, color: Tone.color(row.stateTone))
                Text(row.nextText)
                    .font(.footnote)
                    .lineLimit(1)
            }
            Text(row.lastText)
                .font(.footnote)
                .foregroundStyle(.secondary)
            if let note = row.clampNote {
                Text(note)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let error = row.error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
        .padding(.vertical, 2)
    }
}
