import shared
import SwiftUI

/// What the payment form holds, as Swift values the fields bind to; `kotlin` is the form the store takes.
struct SettlementFields {
    var fromUserId = ""
    var toUserId = ""
    var amount = ""
    var currency = ""
    var date = ""
    var bookId = ""
    var note = ""

    init() {}

    init(_ form: SettlementForm) {
        fromUserId = form.fromUserId
        toUserId = form.toUserId
        amount = form.amount
        currency = form.currency
        date = form.date
        bookId = form.bookId
        note = form.note
    }

    var kotlin: SettlementForm {
        SettlementForm(
            fromUserId: fromUserId,
            toUserId: toUserId,
            amount: amount,
            currency: currency,
            date: date,
            bookId: bookId,
            note: note
        )
    }
}

/// Records a payment between two people (`id` nil) or edits one. Presented as a sheet. A suggested payment arrives as
/// `from`, `to` and `amount`; `bookArg` is a book id or `all`.
struct SettlementEditScreen: View {
    @StateObject private var model: Observed<SettlementEditStore, SettlementEditState>
    @Environment(\.dismiss) private var dismiss

    @State private var loaded = false
    @State private var fields = SettlementFields()

    init(id: String?, from: String?, to: String?, amount: String?, bookArg: String?) {
        _model = StateObject(
            wrappedValue: Observed(
                SettlementEditStore(
                    app: AppEnv.app,
                    id: id,
                    fromUserId: from,
                    toUserId: to,
                    amount: amount,
                    requestedBook: bookArg
                )
            )
        )
    }

    var body: some View {
        let state = model.state
        NavigationStack {
            content(state)
                .navigationTitle(state.isNew ? tr("settlement_create_title") : tr("settlement_edit_title"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(tr("common_cancel")) { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(state.saving ? tr("common_saving") : tr("common_save")) {
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
    }

    @ViewBuilder
    private func content(_ state: SettlementEditState) -> some View {
        if let error = state.loadError {
            ErrorView(error: error) { model.store.retry() }
        } else if !loaded {
            LoadingView()
        } else {
            form(state)
        }
    }

    private func form(_ state: SettlementEditState) -> some View {
        let errors = state.fieldErrors
        let people = state.people.map { Choice(value: $0.value, label: $0.label) }
        return Form {
            if state.error != nil {
                Section {
                    ErrorBanner(error: state.error)
                }
            }
            Section {
                ChoiceEntry(label: tr("settlement_from"), selection: $fields.fromUserId, options: people)
                FieldError(text: errors["fromUserId"])
                Button {
                    fields = SettlementFields(model.store.swap(form: fields.kotlin))
                } label: {
                    Label(tr("settlement_swap"), systemImage: "arrow.up.arrow.down")
                }
                .buttonStyle(.borderless)
                ChoiceEntry(label: tr("settlement_to"), selection: $fields.toUserId, options: people)
                FieldError(text: errors["toUserId"])
            }
            Section {
                MoneyEntry(
                    label: tr("cost_amount"),
                    text: $fields.amount,
                    currency: fields.currency,
                    error: errors["amountMinor"]
                )
                TextEntry(
                    label: tr("cost_currency"),
                    text: currencyBinding,
                    error: errors["currency"],
                    capitalization: .characters
                )
                DateEntry(label: tr("cost_date"), value: $fields.date, error: errors["date"], clearable: false)
                ChoiceEntry(
                    label: tr("cost_book"),
                    selection: $fields.bookId,
                    options: state.books.map { Choice(value: $0.value, label: $0.label) }
                )
                FieldError(text: errors["bookId"])
                TextEntry(label: tr("settlement_note"), text: $fields.note, error: errors["note"])
            } footer: {
                Text(tr("settlement_book_hint"))
            }
        }
    }

    private var currencyBinding: Binding<String> {
        Binding(
            get: { fields.currency },
            set: { fields = SettlementFields(model.store.withCurrency(form: fields.kotlin, text: $0)) }
        )
    }

    private func fill(_ initial: SettlementForm?) {
        guard !loaded, let initial else { return }
        fields = SettlementFields(initial)
        loaded = true
    }
}
