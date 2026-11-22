import shared
import SwiftUI

/// What the adjust form holds, as Swift values the fields bind to; `kotlin` is the form the store takes.
struct AcceptFields {
    var title = ""
    var bookId = ""
    var category = "other"
    var paidByUserId = ""
    var assetId = ""
    var roomId = ""
    var notes = ""
    var splitMode = "ownership"
    var splitTouched = false
    var participants: [String] = []
    var shares: [String: String] = [:]
    var countsAsExpense = true
    var countsTouched = false
    var deductible = "unknown"
    var tagIds: [String] = []
    var assetKind = "device"

    init() {}

    init(_ form: AcceptForm) {
        title = form.title
        bookId = form.bookId
        category = form.category
        paidByUserId = form.paidByUserId
        assetId = form.assetId
        roomId = form.roomId
        notes = form.notes
        splitMode = form.splitMode
        splitTouched = form.splitTouched
        participants = form.participants
        shares = form.shares
        countsAsExpense = form.countsAsExpense
        countsTouched = form.countsTouched
        deductible = form.deductible
        tagIds = form.tagIds
        assetKind = form.assetKind
    }

    var kotlin: AcceptForm {
        AcceptForm(
            title: title,
            bookId: bookId,
            category: category,
            paidByUserId: paidByUserId,
            assetId: assetId,
            roomId: roomId,
            notes: notes,
            splitMode: splitMode,
            splitTouched: splitTouched,
            participants: participants,
            shares: shares,
            countsAsExpense: countsAsExpense,
            countsTouched: countsTouched,
            deductible: deductible,
            tagIds: tagIds,
            assetKind: assetKind
        )
    }
}

/// Accepts a suggestion of the finance app with changes ("Anpassen"). Presented as a sheet.
struct SuggestionAcceptScreen: View {
    @StateObject private var model: Observed<SuggestionAcceptStore, AcceptState>
    @Environment(\.dismiss) private var dismiss

    @State private var loaded = false
    @State private var fields = AcceptFields()

    init(id: String) {
        _model = StateObject(wrappedValue: Observed(SuggestionAcceptStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        NavigationStack {
            content(state)
                .navigationTitle(state.dialogTitle.isEmpty ? tr("finance_inbox_title") : state.dialogTitle)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(tr("common_cancel")) { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(state.saving ? tr("finance_accepting") : state.submitLabel) {
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
        .onChange(of: state.done != nil) { _, done in
            if done { dismiss() }
        }
    }

    @ViewBuilder
    private func content(_ state: AcceptState) -> some View {
        if let error = state.loadError {
            ErrorView(error: error) { model.store.retry() }
        } else if !loaded {
            LoadingView()
        } else {
            form(state)
        }
    }

    private func form(_ state: AcceptState) -> some View {
        let view = model.store.view(form: fields.kotlin)
        let errors = state.fieldErrors
        return Form {
            if let text = state.error {
                Section {
                    Text(text)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
            Section {
                TextEntry(label: state.titleLabel, text: $fields.title, error: errors["title"])
            } footer: {
                Text(tr("finance_accept_description") + " " + state.facts)
            }
            if state.kind == "asset" {
                Section {
                    ChoiceEntry(
                        label: tr("asset_kind"),
                        selection: $fields.assetKind,
                        options: state.assetKinds.map { Choice(value: $0.value, label: $0.label) }
                    )
                    Picker(tr("cost_room"), selection: $fields.roomId) {
                        Text(tr("cost_no_room")).tag("")
                        ForEach(state.rooms, id: \.value) { room in
                            Text(room.label).tag(room.value)
                        }
                    }
                }
            }
            if state.kind == "cost" {
                costSections(state, view, errors)
            }
        }
    }

    @ViewBuilder
    private func costSections(_ state: AcceptState, _ view: AcceptFormView, _ errors: [String: String]) -> some View {
        Section {
            if state.books.count > 1 {
                Picker(tr("cost_book"), selection: bookBinding) {
                    ForEach(state.books, id: \.id) { book in
                        Text(book.name).tag(book.id)
                    }
                }
            }
            ChoiceEntry(
                label: tr("cost_category"),
                selection: categoryBinding,
                options: state.categories.map { Choice(value: $0.value, label: $0.label) }
            )
            Picker(tr("cost_paid_by"), selection: $fields.paidByUserId) {
                Text(tr("cost_payer_none")).tag("")
                ForEach(state.people, id: \.id) { person in
                    Text(person.name).tag(person.id)
                }
            }
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
        }
        Section {
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
                    fields = AcceptFields(model.store.equalizeShares(form: fields.kotlin))
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
        }
        Section {
            if !state.tags.isEmpty {
                ForEach(state.tags, id: \.id) { tag in
                    Toggle(tag.name, isOn: tagBinding(tag.id))
                }
            }
            TextEntry(label: tr("cost_notes"), text: $fields.notes, multiline: true)
        }
    }

    private var bookBinding: Binding<String> {
        Binding(
            get: { fields.bookId },
            set: { fields = AcceptFields(model.store.withBook(form: fields.kotlin, bookId: $0)) }
        )
    }

    private var categoryBinding: Binding<String> {
        Binding(
            get: { fields.category },
            set: { fields = AcceptFields(model.store.withCategory(form: fields.kotlin, category: $0)) }
        )
    }

    private var splitBinding: Binding<String> {
        Binding(
            get: { fields.splitMode },
            set: { fields = AcceptFields(model.store.withSplitMode(form: fields.kotlin, mode: $0)) }
        )
    }

    private var countsBinding: Binding<Bool> {
        Binding(
            get: { fields.countsAsExpense },
            set: { fields = AcceptFields(model.store.withCounts(form: fields.kotlin, counts: $0)) }
        )
    }

    private func tagBinding(_ tagId: String) -> Binding<Bool> {
        Binding(
            get: { fields.tagIds.contains(tagId) },
            set: { _ in fields = AcceptFields(model.store.toggleTag(form: fields.kotlin, tagId: tagId)) }
        )
    }

    private func participantBinding(_ userId: String) -> Binding<Bool> {
        Binding(
            get: { fields.participants.contains(userId) },
            set: { _ in fields = AcceptFields(model.store.toggleParticipant(form: fields.kotlin, userId: userId)) }
        )
    }

    private func shareBinding(_ userId: String) -> Binding<String> {
        Binding(
            get: { fields.shares[userId] ?? "" },
            set: { fields = AcceptFields(model.store.withShare(form: fields.kotlin, userId: userId, percent: $0)) }
        )
    }

    private func fill(_ initial: AcceptForm?) {
        guard !loaded, let initial else { return }
        fields = AcceptFields(initial)
        loaded = true
    }
}
