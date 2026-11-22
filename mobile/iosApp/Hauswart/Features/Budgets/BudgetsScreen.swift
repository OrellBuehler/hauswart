import shared
import SwiftUI

/// The budget form is opened for one of these: a new budget (in the period on screen) or an existing one.
private struct BudgetTarget: Identifiable {
    let id = UUID()
    var budgetId: String?
    var period: String?
}

/// The active budgets of a month or a year with how far each is used, and the paused ones.
struct BudgetsScreen: View {
    @StateObject private var model = Observed(BudgetsStore(app: AppEnv.app))
    @State private var target: BudgetTarget?
    @State private var deleteId: String?
    @State private var confirmingDelete = false

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("budgets_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        target = BudgetTarget(budgetId: nil, period: state.period)
                    } label: {
                        Label(tr("budgets_new"), systemImage: "plus")
                    }
                }
            }
            .sheet(item: $target) { item in
                BudgetEditScreen(id: item.budgetId, period: item.period)
            }
            .confirmDelete(
                tr("budget_delete_title"),
                message: deleteId.map { model.store.deleteText(id: $0) } ?? "",
                isPresented: $confirmingDelete
            ) {
                if let id = deleteId { model.store.delete(id: id) }
            }
    }

    @ViewBuilder
    private func content(_ state: BudgetsState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, !state.hasBudgets {
            ErrorView(error: error) { model.store.refresh() }
        } else if !state.hasBudgets {
            EmptyStateView(
                title: tr("budgets_empty_title"),
                message: tr("budgets_empty_body"),
                systemImage: "gauge.with.dots.needle.50percent"
            )
        } else {
            list(state)
        }
    }

    private func list(_ state: BudgetsState) -> some View {
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
                Picker(tr("budgets_view"), selection: periodBinding) {
                    ForEach(BudgetsStoresKt.BUDGET_PERIODS, id: \.self) { period in
                        Text(BudgetsStoresKt.budgetPeriodLabel(period: period)).tag(period)
                    }
                }
                .pickerStyle(.segmented)
                HStack {
                    Button {
                        model.store.previous()
                    } label: {
                        Image(systemName: "chevron.left")
                    }
                    .buttonStyle(.borderless)
                    .disabled(!state.canPrevious)
                    .accessibilityLabel(tr("budgets_period_nav"))
                    Spacer()
                    Text(state.periodLabel)
                        .font(.headline)
                    Spacer()
                    Button {
                        model.store.next()
                    } label: {
                        Image(systemName: "chevron.right")
                    }
                    .buttonStyle(.borderless)
                    .disabled(!state.canNext)
                    .accessibilityLabel(tr("budgets_period_nav"))
                }
                if !state.isCurrent {
                    Button(state.todayLabel) { model.store.goToToday() }
                        .buttonStyle(.borderless)
                }
            }
            if state.rows.isEmpty {
                Section {
                    EmptyStateView(
                        title: state.emptyTitle,
                        message: state.emptyBody,
                        systemImage: "gauge.with.dots.needle.50percent"
                    )
                }
            } else {
                Section {
                    ForEach(state.rows, id: \.id) { row in
                        BudgetRowLine(
                            row: row,
                            busy: state.busyId == row.id,
                            onEdit: { target = BudgetTarget(budgetId: row.id, period: nil) },
                            onPause: { model.store.pause(id: row.id) },
                            onDelete: {
                                deleteId = row.id
                                confirmingDelete = true
                            }
                        )
                    }
                } header: {
                    Text(state.countText)
                }
            }
            if !state.paused.isEmpty {
                Section {
                    ForEach(state.paused, id: \.id) { paused in
                        PausedBudgetLine(
                            row: paused,
                            busy: state.busyId == paused.id,
                            onResume: { model.store.resume(id: paused.id) },
                            onEdit: { target = BudgetTarget(budgetId: paused.id, period: nil) },
                            onDelete: {
                                deleteId = paused.id
                                confirmingDelete = true
                            }
                        )
                    }
                } header: {
                    Text(tr("budgets_inactive_title"))
                } footer: {
                    Text(tr("budgets_inactive_hint"))
                }
            }
            Section {
                Text(state.legend)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .refreshable { model.store.refresh() }
    }

    private var periodBinding: Binding<String> {
        Binding(
            get: { model.state.period },
            set: { model.store.selectPeriod(period: $0) }
        )
    }
}

private struct BudgetRowLine: View {
    let row: BudgetRowView
    let busy: Bool
    let onEdit: () -> Void
    let onPause: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.title)
                        .font(.headline)
                        .lineLimit(2)
                    Text(row.subtitle)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(row.spent)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    Text(row.amountOf)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Menu {
                    Button {
                        onEdit()
                    } label: {
                        Label(tr("common_edit"), systemImage: "pencil")
                    }
                    Button {
                        onPause()
                    } label: {
                        Label(tr("budgets_pause"), systemImage: "pause")
                    }
                    Button(role: .destructive) {
                        onDelete()
                    } label: {
                        Label(tr("common_delete"), systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .buttonStyle(.borderless)
                .disabled(busy)
                .accessibilityLabel(tr("budget_actions", ["name": row.name]))
            }
            ProgressView(value: Double(row.barPercent), total: 100)
                .tint(Tone.color(row.tone))
                .accessibilityValue(row.summary)
            HStack {
                Badge(text: row.stateLabel + " · " + row.percentText, color: Tone.color(row.tone))
                Spacer()
                Text(row.remaining)
                    .font(.footnote)
                    .lineLimit(1)
            }
            Text(row.entriesText)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

private struct PausedBudgetLine: View {
    let row: PausedBudgetView
    let busy: Bool
    let onResume: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .lineLimit(1)
                Text(row.subtitle)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(row.amount)
                .lineLimit(1)
            Menu {
                Button {
                    onResume()
                } label: {
                    Label(tr("budgets_resume"), systemImage: "play")
                }
                Button {
                    onEdit()
                } label: {
                    Label(tr("common_edit"), systemImage: "pencil")
                }
                Button(role: .destructive) {
                    onDelete()
                } label: {
                    Label(tr("common_delete"), systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .buttonStyle(.borderless)
            .disabled(busy)
            .accessibilityLabel(tr("budget_actions", ["name": row.name]))
        }
    }
}
