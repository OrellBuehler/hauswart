import shared
import SwiftUI

/// What the quick form holds, as Swift values the fields bind to; `kotlin` is the form the store takes.
struct QuickFields {
    var amount = ""
    var category = ""
    var title = ""
    var payee = ""
    var date = ""
    var bookId = ""
    var paidByUserId = ""
    var participants: [String] = []
    var participantsTouched = false
    var notShared = false

    init() {}

    init(_ form: QuickForm) {
        amount = form.amount
        category = form.category
        title = form.title
        payee = form.payee
        date = form.date
        bookId = form.bookId
        paidByUserId = form.paidByUserId
        participants = form.participants
        participantsTouched = form.participantsTouched
        notShared = form.notShared
    }

    var kotlin: QuickForm {
        QuickForm(
            amount: amount,
            category: category,
            title: title,
            payee: payee,
            date: date,
            bookId: bookId,
            paidByUserId: paidByUserId,
            participants: participants,
            participantsTouched: participantsTouched,
            notShared: notShared
        )
    }
}

/// The fast entry: the amount, what it was for, who paid and who it is for. Presented as a sheet; `bookArg` is a
/// book id or `all`.
struct QuickEntryScreen: View {
    @StateObject private var model: Observed<QuickEntryStore, QuickEntryState>
    @Environment(\.dismiss) private var dismiss
    @FocusState private var amountFocused: Bool

    @State private var loaded = false
    @State private var fields = QuickFields()
    @State private var expanded = false
    @State private var more = false
    @State private var fullForm = false

    init(bookArg: String) {
        let requested = CostsSupportKt.bookOfArg(arg: bookArg)
        _model = StateObject(
            wrappedValue: Observed(QuickEntryStore(app: AppEnv.app, requestedBook: requested == "" ? nil : requested))
        )
    }

    var body: some View {
        let state = model.state
        NavigationStack {
            content(state)
                .navigationTitle(tr("quick_title"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(tr("common_cancel")) { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(state.saving ? tr("quick_saving") : saveLabel()) {
                            model.store.save(form: fields.kotlin)
                        }
                        .disabled(state.saving || !loaded)
                    }
                }
        }
        .onAppear { fill(state.initial) }
        .onChange(of: state.initial) { _, initial in
            fill(initial)
        }
        .onChange(of: state.savedId) { _, savedId in
            if savedId != nil { dismiss() }
        }
        .onChange(of: matchKey) { _, _ in
            if loaded { model.store.matchesFor(form: fields.kotlin) }
        }
        .sheet(isPresented: $fullForm) {
            CostEditScreen(id: nil, bookArg: fields.bookId.isEmpty ? nil : fields.bookId, assetId: nil)
        }
    }

    private func saveLabel() -> String {
        loaded ? model.store.view(form: fields.kotlin, expanded: expanded).saveLabel : tr("quick_save")
    }

    @ViewBuilder
    private func content(_ state: QuickEntryState) -> some View {
        if let error = state.loadError {
            ErrorView(error: error) { model.store.retry() }
        } else if !loaded {
            LoadingView()
        } else {
            form(state)
        }
    }

    private func form(_ state: QuickEntryState) -> some View {
        let view = model.store.view(form: fields.kotlin, expanded: expanded)
        return Form {
            if state.error != nil {
                Section {
                    ErrorBanner(error: state.error)
                }
            }
            Section {
                HStack {
                    TextField(tr("cost_amount"), text: $fields.amount)
                        .keyboardType(.decimalPad)
                        .font(.title2)
                        .focused($amountFocused)
                        .onAppear { amountFocused = true }
                    Text(state.currency)
                        .foregroundStyle(.secondary)
                }
                FieldError(text: state.fieldErrors["amountMinor"])
            }
            Section {
                CostChipGrid(
                    options: view.categoryChips.map { Choice(value: $0.value, label: $0.label) },
                    isSelected: { $0 == fields.category },
                    onTap: { fields.category = $0 }
                )
                if view.canExpand {
                    Button(view.expandLabel) { expanded.toggle() }
                        .buttonStyle(.borderless)
                }
                FieldError(text: state.fieldErrors["category"])
            } header: {
                FormHeading(text: tr("cost_category"))
            }
            Section {
                CostChipGrid(
                    options: state.payers.map { Choice(value: $0.value, label: $0.label) },
                    isSelected: { $0 == fields.paidByUserId },
                    onTap: { fields.paidByUserId = $0 }
                )
            } header: {
                FormHeading(text: tr("cost_paid_by"))
            }
            Section {
                CostChipGrid(
                    options: whoOptions(state),
                    isSelected: { value in
                        value == QuickEntryScreen.notSharedValue ? view.notSharedOn : fields.participants
                            .contains(value)
                    },
                    onTap: { value in
                        if value == QuickEntryScreen.notSharedValue {
                            fields = QuickFields(model.store.chooseNotShared(form: fields.kotlin))
                        } else {
                            fields = QuickFields(model.store.toggleParticipant(form: fields.kotlin, userId: value))
                        }
                    }
                )
                Text(view.splitText)
                    .font(.footnote)
                    .foregroundStyle(view.unchosen ? Color.red : Color.secondary)
                FieldError(text: state.fieldErrors["participants"])
            } header: {
                FormHeading(text: tr("cost_for_whom"))
            }
            if !view.bookChips.isEmpty {
                Section {
                    CostChipGrid(
                        options: view.bookChips.map { Choice(value: $0.value, label: $0.label) },
                        isSelected: { $0 == fields.bookId },
                        onTap: { fields = QuickFields(model.store.withBook(form: fields.kotlin, bookId: $0)) }
                    )
                } header: {
                    FormHeading(text: tr("cost_book"))
                }
            }
            Section {
                Button(tr("quick_more")) { more.toggle() }
                    .buttonStyle(.borderless)
                if more {
                    DateEntry(
                        label: tr("cost_date"),
                        value: $fields.date,
                        error: state.fieldErrors["date"],
                        clearable: false
                    )
                    TextEntry(
                        label: tr("cost_payee"),
                        text: $fields.payee,
                        error: state.fieldErrors["payee"],
                        capitalization: .words
                    )
                    TextEntry(label: tr("cost_title"), text: $fields.title, error: state.fieldErrors["title"])
                    Text(tr("quick_title_hint"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            Section {
                Button(tr("quick_full_form")) { fullForm = true }
            } footer: {
                Text(tr("quick_full_form_hint"))
            }
            BankMatchesSection(
                matches: state.matches,
                onChoose: { model.store.chooseMatch(id: $0) },
                onRetry: { model.store.matchesFor(form: fields.kotlin) }
            )
        }
    }

    private var matchKey: String {
        fields.amount + "|" + fields.date
    }

    private static let notSharedValue = "__not_shared"

    private func whoOptions(_ state: QuickEntryState) -> [Choice] {
        state.people.map { Choice(value: $0.id, label: $0.name) }
            + [Choice(value: QuickEntryScreen.notSharedValue, label: tr("quick_split_not_shared"))]
    }

    private func fill(_ initial: QuickForm?) {
        guard !loaded, let initial else { return }
        fields = QuickFields(initial)
        loaded = true
        model.store.matchesFor(form: fields.kotlin)
    }
}
