import shared
import SwiftUI

/// The payment form is opened for one of these: a new payment (maybe from a suggestion) or an existing one.
struct SettlementTarget: Identifiable {
    let id = UUID()
    var settlementId: String?
    var from: String?
    var to: String?
    var amount: String?
    var bookArg: String?
}

/// Who owes whom, the payments that square it, and the recorded payments. `bookArg` is a book id or `all`.
struct BalancesScreen: View {
    private let bookArg: String
    @StateObject private var model: Observed<BalancesStore, BalancesState>
    @State private var target: SettlementTarget?
    @State private var deleteId: String?
    @State private var confirmingDelete = false

    init(bookArg: String) {
        self.bookArg = bookArg
        _model = StateObject(wrappedValue: Observed(BalancesStore(app: AppEnv.app, requestedBook: bookArg)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("balances_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        target = SettlementTarget(bookArg: CostsSupportKt.bookArgOf(bookId: state.bookId))
                    } label: {
                        Label(tr("balances_record_new"), systemImage: "plus")
                    }
                }
            }
            .sheet(item: $target) { item in
                SettlementEditScreen(
                    id: item.settlementId,
                    from: item.from,
                    to: item.to,
                    amount: item.amount,
                    bookArg: item.bookArg
                )
            }
            .confirmDelete(
                tr("settlement_delete_title"),
                message: deleteId.map { model.store.deleteText(id: $0) } ?? "",
                isPresented: $confirmingDelete
            ) {
                if let id = deleteId { model.store.deleteSettlement(id: id) }
            }
    }

    @ViewBuilder
    private func content(_ state: BalancesState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.people.isEmpty {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            list(state)
        }
    }

    private func list(_ state: BalancesState) -> some View {
        List {
            if state.actionError != nil {
                Section {
                    ErrorBanner(error: state.actionError)
                }
            }
            if state.showSwitcher {
                Section {
                    BookChips(options: bookChoices(state.books), selected: state.bookId) { id in
                        model.store.selectBook(bookId: id)
                    }
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
            if let note = state.scopeNote {
                Section {
                    Text(note)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            Section(tr("balances_people_title")) {
                if let you = state.you {
                    ToneLabel(text: you.text, tone: you.tone, font: .headline)
                }
                if state.isNothingYet {
                    Text(tr("balances_nothing"))
                        .font(.subheadline)
                } else {
                    ForEach(state.people, id: \.userId) { person in
                        PersonBalanceLine(person: person)
                    }
                    Text(tr("balances_formula"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                ForEach(state.notes, id: \.self) { note in
                    Text(note)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            if !state.isNothingYet {
                Section(tr("balances_suggested_title")) {
                    if state.isOpen {
                        ForEach(state.payments, id: \.sentence) { payment in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(payment.sentence)
                                    Text(payment.amount)
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button(tr("balances_record")) {
                                    target = SettlementTarget(
                                        settlementId: nil,
                                        from: payment.fromUserId,
                                        to: payment.toUserId,
                                        amount: payment.amountInput,
                                        bookArg: CostsSupportKt.bookArgOf(bookId: state.bookId)
                                    )
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                    } else {
                        Text(tr("balances_square"))
                            .font(.subheadline)
                    }
                }
            }
            Section {
                Picker(tr("settlements_filter_year"), selection: yearBinding) {
                    ForEach(state.years, id: \.value) { option in
                        Text(option.label).tag(option.value)
                    }
                }
                Picker(tr("settlements_filter_person"), selection: personBinding) {
                    ForEach(state.persons, id: \.value) { option in
                        Text(option.label).tag(option.value)
                    }
                }
                if state.settlementsFiltered {
                    Button(tr("tasks_filter_reset")) { model.store.resetFilters() }
                }
                Text(state.settlementsCount)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } header: {
                Text(tr("settlements_title"))
            }
            if state.settlements.isEmpty {
                Section {
                    EmptyStateView(
                        title: state
                            .settlementsFiltered ? tr("settlements_empty_filtered_title") :
                            tr("settlements_empty_title"),
                        message: state
                            .settlementsFiltered ? tr("costs_empty_filtered_body") : tr("settlements_empty_body"),
                        systemImage: "arrow.left.arrow.right"
                    )
                }
            } else {
                Section {
                    ForEach(state.settlements, id: \.id) { row in
                        SettlementLine(row: row)
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    deleteId = row.id
                                    confirmingDelete = true
                                } label: {
                                    Label(tr("common_delete"), systemImage: "trash")
                                }
                                Button {
                                    target = SettlementTarget(settlementId: row.id)
                                } label: {
                                    Label(tr("common_edit"), systemImage: "pencil")
                                }
                                .tint(.blue)
                            }
                            .contextMenu {
                                Button {
                                    target = SettlementTarget(settlementId: row.id)
                                } label: {
                                    Label(tr("common_edit"), systemImage: "pencil")
                                }
                                Button(role: .destructive) {
                                    deleteId = row.id
                                    confirmingDelete = true
                                } label: {
                                    Label(tr("common_delete"), systemImage: "trash")
                                }
                            }
                    }
                }
            }
        }
        .refreshable { model.store.refresh() }
    }

    private var yearBinding: Binding<String> {
        Binding(
            get: { String(model.state.year) },
            set: { model.store.setYear(value: $0) }
        )
    }

    private var personBinding: Binding<String> {
        Binding(
            get: { model.state.person },
            set: { model.store.setPerson(userId: $0) }
        )
    }
}

private struct PersonBalanceLine: View {
    let person: PersonBalanceView

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(person.name)
                    .font(.headline)
                if person.isYou {
                    Badge(text: tr("balances_you_badge"))
                }
            }
            ToneLabel(text: person.balance.text, tone: person.balance.tone)
            Text(tr("balances_paid") + " " + person.paid + " · " + tr("balances_share") + " " + person.share)
                .font(.footnote)
                .foregroundStyle(.secondary)
            Text(tr("balances_sent") + " " + person.sent + " · " + tr("balances_received") + " " + person.received)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}

private struct SettlementLine: View {
    let row: SettlementRowView

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                Text(row.meta)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            Text(row.amount)
                .lineLimit(1)
        }
    }
}
