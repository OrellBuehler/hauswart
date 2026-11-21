import shared
import SwiftUI

/// One recurring cost: its rhythm, the next dates, the template, and pause, resume, "book now" and delete.
struct RecurringDetailScreen: View {
    @StateObject private var model: Observed<RecurringDetailStore, RecurringDetailState>
    @Environment(\.dismiss) private var dismiss
    @State private var editing = false
    @State private var confirmingDelete = false

    init(id: String) {
        _model = StateObject(wrappedValue: Observed(RecurringDetailStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(state.recurrence?.title ?? tr("recurrence_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if state.recurrence != nil {
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        Button {
                            editing = true
                        } label: {
                            Label(tr("common_edit"), systemImage: "pencil")
                        }
                        Button(role: .destructive) {
                            confirmingDelete = true
                        } label: {
                            Label(tr("common_delete"), systemImage: "trash")
                        }
                        .disabled(state.busyAction != nil)
                    }
                }
            }
            .sheet(isPresented: $editing) {
                RecurringEditScreen(id: state.recurrence?.id, book: nil)
            }
            .confirmDelete(
                tr("recurrence_delete_title"),
                message: model.store.deleteText(),
                isPresented: $confirmingDelete
            ) {
                model.store.delete()
            }
            .onChange(of: state.deleted) { _, deleted in
                if deleted { dismiss() }
            }
    }

    @ViewBuilder
    private func content(_ state: RecurringDetailState) -> some View {
        if let r = state.recurrence {
            detail(r, state)
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            LoadingView()
        }
    }

    private func detail(_ r: RecurringDetailView, _ state: RecurringDetailState) -> some View {
        let busy = state.busyAction != nil
        return List {
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
                VStack(alignment: .leading, spacing: 6) {
                    Text(r.categoryLine)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text(r.amount)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(r.refund ? Color.green : Color.primary)
                    HStack(spacing: 6) {
                        Badge(text: r.stateLabel, color: Tone.color(r.stateTone))
                        ForEach(r.tags, id: \.id) { tag in
                            Badge(text: tag.name)
                        }
                    }
                }
                if let error = r.error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
            if r.canPause || r.canResume || r.canRun {
                Section {
                    if r.canPause {
                        Button {
                            model.store.pause()
                        } label: {
                            Label(
                                tr(state.busyAction == RecurringStoresKt.RECURRING_ACTION_PAUSE ? "recurrence_pausing" : "recurrence_pause"),
                                systemImage: "pause"
                            )
                        }
                        .disabled(busy)
                    }
                    if r.canResume {
                        Button {
                            model.store.resume()
                        } label: {
                            Label(
                                tr(state.busyAction == RecurringStoresKt.RECURRING_ACTION_RESUME ? "recurrence_resuming" : "recurrence_resume"),
                                systemImage: "play"
                            )
                        }
                        .disabled(busy)
                    }
                    if r.canRun {
                        Button {
                            model.store.runNow()
                        } label: {
                            Label(
                                tr(state.busyAction == RecurringStoresKt.RECURRING_ACTION_RUN ? "recurrence_running" : "recurrence_run_now"),
                                systemImage: "checkmark.square"
                            )
                        }
                        .disabled(busy || !r.runEnabled)
                    }
                } footer: {
                    if r.canRun {
                        Text(tr("recurrence_run_hint"))
                    }
                }
            }
            Section {
                Text(r.ruleText)
                    .font(.headline)
                if let note = r.clampNote {
                    Text(note)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                ForEach(Array(r.facts.prefix(4)), id: \.label) { fact in
                    ValueRow(label: fact.label, value: fact.value)
                }
            } header: {
                Text(tr("recurrence_rule_label"))
            }
            Section {
                ForEach(r.upcoming, id: \.self) { date in
                    Text(date)
                }
                if let note = r.upcomingNote {
                    Text(note)
                        .font(.subheadline)
                }
            } header: {
                Text(tr("recurrence_upcoming"))
            } footer: {
                Text(tr("recurrence_entries_note"))
            }
            Section {
                ForEach(Array(r.facts.dropFirst(4)), id: \.label) { fact in
                    FactRow(fact: fact)
                }
                if let notes = r.notes {
                    ValueRow(label: tr("cost_notes"), value: notes)
                }
            } header: {
                Text(tr("recurrence_facts"))
            }
        }
        .refreshable { model.store.refresh() }
    }
}

private struct FactRow: View {
    let fact: CostFact

    var body: some View {
        if let id = fact.linkId, fact.linkKind == "asset" {
            NavigationLink(value: Route.asset(id)) {
                ValueRow(label: fact.label, value: fact.value)
            }
        } else if let id = fact.linkId, fact.linkKind == "room" {
            NavigationLink(value: Route.room(id)) {
                ValueRow(label: fact.label, value: fact.value)
            }
        } else {
            ValueRow(label: fact.label, value: fact.value)
        }
    }
}
