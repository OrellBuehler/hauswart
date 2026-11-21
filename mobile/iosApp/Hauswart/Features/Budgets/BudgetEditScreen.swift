import shared
import SwiftUI

/// What the budget form holds, as Swift values the fields bind to; `kotlin` is the form the store takes.
struct BudgetFormFields {
    var bookId = ""
    var category = ""
    var period = "month"
    var amount = ""
    var active = true

    init() {}

    init(_ form: BudgetForm) {
        bookId = form.bookId
        category = form.category
        period = form.period
        amount = form.amount
        active = form.active
    }

    var kotlin: BudgetForm {
        BudgetForm(bookId: bookId, category: category, period: period, amount: amount, active: active)
    }
}

/// Makes a budget (`id` nil) or changes one. Presented as a sheet. `period` is what a new budget starts with.
struct BudgetEditScreen: View {
    @StateObject private var model: Observed<BudgetEditStore, BudgetEditState>
    @Environment(\.dismiss) private var dismiss

    @State private var loaded = false
    @State private var fields = BudgetFormFields()

    init(id: String?, period: String?) {
        _model = StateObject(
            wrappedValue: Observed(BudgetEditStore(app: AppEnv.app, id: id, requestedPeriod: period))
        )
    }

    var body: some View {
        let state = model.state
        NavigationStack {
            content(state)
                .navigationTitle(state.isNew ? tr("budget_create_title") : tr("budget_edit_title"))
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
    private func content(_ state: BudgetEditState) -> some View {
        if let error = state.loadError {
            ErrorView(error: error) { model.store.retry() }
        } else if !loaded {
            LoadingView()
        } else {
            let errors = state.fieldErrors
            Form {
                if state.error != nil {
                    Section {
                        ErrorBanner(error: state.error)
                    }
                }
                Section {
                    ChoiceEntry(
                        label: tr("budget_book"),
                        selection: $fields.bookId,
                        options: state.books.map { Choice(value: $0.value, label: $0.label) }
                    )
                    FieldError(text: errors["bookId"])
                    ChoiceEntry(
                        label: tr("budget_category"),
                        selection: $fields.category,
                        options: state.categories.map { Choice(value: $0.value, label: $0.label) }
                    )
                    FieldError(text: errors["category"])
                    ChoiceEntry(
                        label: tr("budget_period"),
                        selection: $fields.period,
                        options: state.periods.map { Choice(value: $0.value, label: $0.label) }
                    )
                    MoneyEntry(
                        label: tr("budget_amount"),
                        text: $fields.amount,
                        currency: state.currency,
                        error: errors["amountMinor"]
                    )
                } footer: {
                    Text(tr("budget_scope_hint"))
                }
                if !state.isNew {
                    Section {
                        ToggleEntry(label: tr("budget_active"), isOn: $fields.active, hint: tr("budget_active_hint"))
                    }
                }
            }
        }
    }

    private func fill(_ initial: BudgetForm?) {
        guard !loaded, let initial else { return }
        fields = BudgetFormFields(initial)
        loaded = true
    }
}
