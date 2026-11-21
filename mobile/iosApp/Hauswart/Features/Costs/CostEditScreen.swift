import shared
import SwiftUI

/// What the full entry form holds, as Swift values the fields bind to; `kotlin` is the form the store takes.
struct CostFields {
    var bookId = ""
    var title = ""
    var amount = ""
    var refund = false
    var currency = ""
    var date = ""
    var category = "other"
    var assetId = ""
    var payee = ""
    var notes = ""
    var paidByUserId = ""
    var splitMode = "ownership"
    var splitTouched = false
    var participants: [String] = []
    var shares: [String: String] = [:]
    var countsAsExpense = true
    var countsTouched = false
    var deductible = "unknown"
    var tagIds: [String] = []

    init() {}

    init(_ form: CostForm) {
        bookId = form.bookId
        title = form.title
        amount = form.amount
        refund = form.refund
        currency = form.currency
        date = form.date
        category = form.category
        assetId = form.assetId
        payee = form.payee
        notes = form.notes
        paidByUserId = form.paidByUserId
        splitMode = form.splitMode
        splitTouched = form.splitTouched
        participants = form.participants
        shares = form.shares
        countsAsExpense = form.countsAsExpense
        countsTouched = form.countsTouched
        deductible = form.deductible
        tagIds = form.tagIds
    }

    var kotlin: CostForm {
        CostForm(
            bookId: bookId,
            title: title,
            amount: amount,
            refund: refund,
            currency: currency,
            date: date,
            category: category,
            assetId: assetId,
            payee: payee,
            notes: notes,
            paidByUserId: paidByUserId,
            splitMode: splitMode,
            splitTouched: splitTouched,
            participants: participants,
            shares: shares,
            countsAsExpense: countsAsExpense,
            countsTouched: countsTouched,
            deductible: deductible,
            tagIds: tagIds
        )
    }
}

/// Books an entry (`id` nil) or edits one. Presented as a sheet. `bookArg` is a book id or `all`; `assetId` ties a new
/// entry to a device.
struct CostEditScreen: View {
    @StateObject private var model: Observed<CostEditStore, CostEditState>
    @Environment(\.dismiss) private var dismiss

    @State private var loaded = false
    @State private var fields = CostFields()

    init(id: String?, bookArg: String?, assetId: String?) {
        var requested: String?
        if let bookArg {
            let book = CostsSupportKt.bookOfArg(arg: bookArg)
            requested = (book == nil || book == "") ? nil : book
        }
        _model = StateObject(
            wrappedValue: Observed(CostEditStore(
                app: AppEnv.app,
                id: id,
                requestedBook: requested,
                requestedAsset: assetId
            ))
        )
    }

    var body: some View {
        let state = model.state
        NavigationStack {
            content(state)
                .navigationTitle(state.isNew ? tr("cost_new") : tr("cost_edit_title"))
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
    private func content(_ state: CostEditState) -> some View {
        if let error = state.loadError {
            ErrorView(error: error) { model.store.retry() }
        } else if !loaded {
            LoadingView()
        } else {
            form(state)
        }
    }

    private func form(_ state: CostEditState) -> some View {
        let view = model.store.view(form: fields.kotlin)
        let errors = state.fieldErrors
        return Form {
            if state.error != nil {
                Section {
                    ErrorBanner(error: state.error)
                }
            }
            Section {
                if state.books.count > 1 {
                    Picker(tr("cost_book"), selection: bookBinding) {
                        ForEach(state.books, id: \.id) { book in
                            Text(book.name).tag(book.id)
                        }
                    }
                }
                TextEntry(label: tr("cost_title"), text: $fields.title, error: errors["title"])
                MoneyEntry(
                    label: tr("cost_amount"),
                    text: $fields.amount,
                    currency: fields.currency,
                    error: errors["amountMinor"]
                )
                .disabled(state.fuelOwned)
                ToggleEntry(label: tr("cost_kind_refund"), isOn: $fields.refund, hint: tr("cost_kind_refund_hint"))
                    .disabled(state.fuelOwned)
                TextEntry(
                    label: tr("cost_currency"),
                    text: currencyBinding,
                    error: errors["currency"],
                    capitalization: .characters
                )
                .disabled(state.fuelOwned)
                DateEntry(label: tr("cost_date"), value: $fields.date, error: errors["date"], clearable: false)
                    .disabled(state.fuelOwned)
                ChoiceEntry(
                    label: tr("cost_category"),
                    selection: categoryBinding,
                    options: state.categories.map { Choice(value: $0.value, label: $0.label) }
                )
                if let note = state.fuelNote {
                    Text(note)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } header: {
                FormHeading(text: tr("cost_form_basics"))
            }
            Section {
                Picker(tr("cost_paid_by"), selection: $fields.paidByUserId) {
                    Text(tr("cost_payer_none")).tag("")
                    ForEach(state.people, id: \.id) { person in
                        Text(person.name).tag(person.id)
                    }
                }
                if fields.paidByUserId.isEmpty {
                    Text(tr("cost_payer_missing_hint"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Picker(tr("cost_split"), selection: splitBinding) {
                    ForEach(state.splitModes, id: \.value) { mode in
                        Text(mode.label).tag(mode.value)
                    }
                }
                if !view.splitHint.isEmpty {
                    Text(view.splitHint)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if view.showParticipants {
                    ForEach(state.people, id: \.id) { person in
                        Toggle(person.name, isOn: participantBinding(person.id))
                    }
                    FieldError(text: errors["participantIds"])
                }
                if view.showShares {
                    ForEach(state.people, id: \.id) { person in
                        TextEntry(
                            label: tr("cost_shares_person", ["name": person.name]),
                            text: shareBinding(person.id),
                            keyboard: .decimalPad
                        )
                    }
                    Button(tr("cost_shares_equalize")) {
                        fields = CostFields(model.store.equalizeShares(form: fields.kotlin))
                    }
                    .buttonStyle(.borderless)
                    if let status = view.sharesStatus {
                        Text(status)
                            .font(.footnote)
                            .foregroundStyle(view.sharesOk ? Color.secondary : Color.red)
                    }
                    FieldError(text: errors["shares"])
                }
                ForEach(view.preview, id: \.userId) { line in
                    LabeledContent(line.name + " · " + line.percent, value: line.amount)
                        .font(.subheadline)
                }
            } header: {
                FormHeading(text: tr("cost_form_payment"))
            }
            Section {
                Picker(tr("cost_asset"), selection: $fields.assetId) {
                    Text(tr("cost_no_asset")).tag("")
                    ForEach(state.assets, id: \.value) { asset in
                        Text(asset.label).tag(asset.value)
                    }
                }
                .disabled(state.fuelOwned)
                TextEntry(label: tr("cost_payee"), text: $fields.payee, error: errors["payee"], capitalization: .words)
                TextEntry(label: tr("cost_notes"), text: $fields.notes, error: errors["notes"], multiline: true)
                if !state.tags.isEmpty {
                    ChipGrid(
                        options: state.tags.map { Choice(value: $0.id, label: $0.name) },
                        isSelected: { fields.tagIds.contains($0) },
                        onTap: { fields = CostFields(model.store.toggleTag(form: fields.kotlin, tagId: $0)) }
                    )
                }
                ToggleEntry(label: tr("cost_counts_as_expense"), isOn: countsBinding, hint: view.countsHint)
                if view.taxClassApplies {
                    ChoiceEntry(
                        label: tr("cost_deductible"),
                        selection: $fields.deductible,
                        options: state.deductibles.map { Choice(value: $0.value, label: $0.label) }
                    )
                }
            } header: {
                FormHeading(text: tr("cost_form_links"))
            }
        }
    }

    private var bookBinding: Binding<String> {
        Binding(
            get: { fields.bookId },
            set: { fields = CostFields(model.store.withBook(form: fields.kotlin, bookId: $0)) }
        )
    }

    private var categoryBinding: Binding<String> {
        Binding(
            get: { fields.category },
            set: { fields = CostFields(model.store.withCategory(form: fields.kotlin, category: $0)) }
        )
    }

    private var splitBinding: Binding<String> {
        Binding(
            get: { fields.splitMode },
            set: { fields = CostFields(model.store.withSplitMode(form: fields.kotlin, mode: $0)) }
        )
    }

    private var currencyBinding: Binding<String> {
        Binding(
            get: { fields.currency },
            set: { fields = CostFields(model.store.withCurrency(form: fields.kotlin, text: $0)) }
        )
    }

    private var countsBinding: Binding<Bool> {
        Binding(
            get: { fields.countsAsExpense },
            set: { fields = CostFields(model.store.withCounts(form: fields.kotlin, counts: $0)) }
        )
    }

    private func participantBinding(_ userId: String) -> Binding<Bool> {
        Binding(
            get: { fields.participants.contains(userId) },
            set: { _ in fields = CostFields(model.store.toggleParticipant(form: fields.kotlin, userId: userId)) }
        )
    }

    private func shareBinding(_ userId: String) -> Binding<String> {
        Binding(
            get: { fields.shares[userId] ?? "" },
            set: { fields = CostFields(model.store.withShare(form: fields.kotlin, userId: userId, percent: $0)) }
        )
    }

    private func fill(_ initial: CostForm?) {
        guard !loaded, let initial else { return }
        fields = CostFields(initial)
        loaded = true
    }
}
