import shared
import SwiftUI

/// What the form of a recurring cost holds, as Swift values the fields bind to; `kotlin` is the form the store takes.
struct RecurringFields {
    var bookId = ""
    var title = ""
    var amount = ""
    var refund = false
    var currency = ""
    var category = "other"
    var assetId = ""
    var roomId = ""
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
    var frequency = "monthly"
    var interval = "1"
    var dayOfMonth = ""
    var dayTouched = false
    var startDate = ""
    var endDate = ""

    init() {}

    init(_ form: RecurringForm) {
        bookId = form.bookId
        title = form.title
        amount = form.amount
        refund = form.refund
        currency = form.currency
        category = form.category
        assetId = form.assetId
        roomId = form.roomId
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
        frequency = form.frequency
        interval = form.interval
        dayOfMonth = form.dayOfMonth
        dayTouched = form.dayTouched
        startDate = form.startDate
        endDate = form.endDate
    }

    var kotlin: RecurringForm {
        RecurringForm(
            bookId: bookId,
            title: title,
            amount: amount,
            refund: refund,
            currency: currency,
            category: category,
            assetId: assetId,
            roomId: roomId,
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
            tagIds: tagIds,
            frequency: frequency,
            interval: interval,
            dayOfMonth: dayOfMonth,
            dayTouched: dayTouched,
            startDate: startDate,
            endDate: endDate
        )
    }
}

/// Sets up a recurring cost (`id` nil) or changes one. Presented as a sheet. `book` is a book id for a new one.
struct RecurringEditScreen: View {
    @StateObject private var model: Observed<RecurringEditStore, RecurringEditState>
    @Environment(\.dismiss) private var dismiss

    @State private var loaded = false
    @State private var fields = RecurringFields()

    init(id: String?, book: String?) {
        _model = StateObject(
            wrappedValue: Observed(RecurringEditStore(app: AppEnv.app, id: id, requestedBook: book))
        )
    }

    var body: some View {
        let state = model.state
        NavigationStack {
            content(state)
                .navigationTitle(state.isNew ? tr("recurrence_new_title") : tr("recurrence_edit_title"))
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
    private func content(_ state: RecurringEditState) -> some View {
        if let error = state.loadError {
            ErrorView(error: error) { model.store.retry() }
        } else if !loaded {
            LoadingView()
        } else {
            form(state)
        }
    }

    private func form(_ state: RecurringEditState) -> some View {
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
                    FieldError(text: errors["bookId"])
                }
                TextEntry(label: tr("cost_title"), text: $fields.title, error: errors["title"])
                ToggleEntry(label: tr("cost_kind_refund"), isOn: $fields.refund, hint: tr("cost_kind_refund_hint"))
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
                ChoiceEntry(
                    label: tr("cost_category"),
                    selection: categoryBinding,
                    options: state.categories.map { Choice(value: $0.value, label: $0.label) }
                )
                TextEntry(label: tr("cost_notes"), text: $fields.notes, error: errors["notes"], multiline: true)
                if !state.tags.isEmpty {
                    ForEach(state.tags, id: \.id) { tag in
                        Toggle(tag.name, isOn: tagBinding(tag.id))
                    }
                }
            } header: {
                FormHeading(text: tr("recurrence_form_template"))
            }
            Section {
                ChoiceEntry(
                    label: tr("recurrence_frequency"),
                    selection: $fields.frequency,
                    options: state.frequencies.map { Choice(value: $0.value, label: $0.label) }
                )
                TextEntry(
                    label: tr("recurrence_interval") + " (" + view.intervalUnit + ")",
                    text: intervalBinding,
                    error: errors["interval"],
                    keyboard: .numberPad
                )
                TextEntry(
                    label: tr("recurrence_day"),
                    text: dayBinding,
                    error: errors["dayOfMonth"],
                    keyboard: .numberPad
                )
                DateEntry(
                    label: tr("recurrence_start"),
                    value: startBinding,
                    error: errors["startDate"],
                    clearable: false
                )
                DateEntry(label: tr("recurrence_end"), value: $fields.endDate, error: errors["endDate"])
            } header: {
                FormHeading(text: tr("recurrence_form_rule"))
            } footer: {
                Text(tr("recurrence_day_hint"))
            }
            Section {
                Text(view.ruleText ?? view.previewInvalid)
                    .font(.subheadline.weight(.semibold))
                if let note = view.clampNote {
                    Text(note)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if let warning = view.immediateWarning {
                    Text(warning)
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }
                ForEach(view.upcoming, id: \.self) { date in
                    Text(date)
                        .font(.subheadline)
                }
                if let hint = view.ruleHint {
                    Text(hint)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } header: {
                FormHeading(text: tr("recurrence_preview_title"))
            }
            Section {
                Picker(tr("cost_paid_by"), selection: $fields.paidByUserId) {
                    Text(tr("cost_payer_none")).tag("")
                    ForEach(state.people, id: \.id) { person in
                        Text(person.name).tag(person.id)
                    }
                }
                TextEntry(label: tr("cost_payee"), text: $fields.payee, error: errors["payee"], capitalization: .words)
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
                        fields = RecurringFields(model.store.equalizeShares(form: fields.kotlin))
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
                ToggleEntry(
                    label: tr("cost_counts_as_expense"),
                    isOn: countsBinding,
                    hint: tr("cost_counts_as_expense_hint")
                )
                if view.taxClassApplies {
                    ChoiceEntry(
                        label: tr("cost_deductible"),
                        selection: $fields.deductible,
                        options: state.deductibles.map { Choice(value: $0.value, label: $0.label) }
                    )
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
                Picker(tr("cost_room"), selection: $fields.roomId) {
                    Text(tr("cost_no_room")).tag("")
                    ForEach(state.rooms, id: \.value) { room in
                        Text(room.label).tag(room.value)
                    }
                }
            } header: {
                FormHeading(text: tr("cost_form_links"))
            }
        }
    }

    private var bookBinding: Binding<String> {
        Binding(
            get: { fields.bookId },
            set: { fields = RecurringFields(model.store.withBook(form: fields.kotlin, bookId: $0)) }
        )
    }

    private var categoryBinding: Binding<String> {
        Binding(
            get: { fields.category },
            set: { fields = RecurringFields(model.store.withCategory(form: fields.kotlin, category: $0)) }
        )
    }

    private var splitBinding: Binding<String> {
        Binding(
            get: { fields.splitMode },
            set: { fields = RecurringFields(model.store.withSplitMode(form: fields.kotlin, mode: $0)) }
        )
    }

    private var currencyBinding: Binding<String> {
        Binding(
            get: { fields.currency },
            set: { fields = RecurringFields(model.store.withCurrency(form: fields.kotlin, text: $0)) }
        )
    }

    private var countsBinding: Binding<Bool> {
        Binding(
            get: { fields.countsAsExpense },
            set: { fields = RecurringFields(model.store.withCounts(form: fields.kotlin, counts: $0)) }
        )
    }

    private var intervalBinding: Binding<String> {
        Binding(
            get: { fields.interval },
            set: { fields = RecurringFields(model.store.withInterval(form: fields.kotlin, text: $0)) }
        )
    }

    private var dayBinding: Binding<String> {
        Binding(
            get: { fields.dayOfMonth },
            set: { fields = RecurringFields(model.store.withDay(form: fields.kotlin, text: $0)) }
        )
    }

    private var startBinding: Binding<String> {
        Binding(
            get: { fields.startDate },
            set: { fields = RecurringFields(model.store.withStartDate(form: fields.kotlin, date: $0)) }
        )
    }

    private func tagBinding(_ tagId: String) -> Binding<Bool> {
        Binding(
            get: { fields.tagIds.contains(tagId) },
            set: { _ in fields = RecurringFields(model.store.toggleTag(form: fields.kotlin, tagId: tagId)) }
        )
    }

    private func participantBinding(_ userId: String) -> Binding<Bool> {
        Binding(
            get: { fields.participants.contains(userId) },
            set: { _ in fields = RecurringFields(model.store.toggleParticipant(form: fields.kotlin, userId: userId)) }
        )
    }

    private func shareBinding(_ userId: String) -> Binding<String> {
        Binding(
            get: { fields.shares[userId] ?? "" },
            set: { fields = RecurringFields(model.store.withShare(form: fields.kotlin, userId: userId, percent: $0)) }
        )
    }

    private func fill(_ initial: RecurringForm?) {
        guard !loaded, let initial else { return }
        fields = RecurringFields(initial)
        loaded = true
    }
}
