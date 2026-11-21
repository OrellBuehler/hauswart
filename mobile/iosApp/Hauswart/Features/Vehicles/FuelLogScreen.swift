import shared
import SwiftUI

private struct FuelSheet: Identifiable {
    let id = UUID()
    let logId: String?
}

/// The fuel log of a vehicle: consumption and price panels, the entries, and add, edit and delete.
struct FuelLogScreen: View {
    @StateObject private var model: Observed<FuelLogStore, FuelLogState>
    @State private var sheet: FuelSheet?
    @State private var deleting: FuelRow?
    @State private var confirmingDelete = false
    @State private var openedCost: String?

    init(assetId: String) {
        _model = StateObject(wrappedValue: Observed(FuelLogStore(app: AppEnv.app, assetId: assetId)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("fuel_card_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        open(nil)
                    } label: {
                        Label(tr("fuel_add"), systemImage: "plus")
                    }
                    .disabled(state.loading || state.error != nil)
                }
            }
            .sheet(item: $sheet) { item in
                FuelFormSheet(store: model.store, state: model.state, logId: item.logId)
            }
            .navigationDestination(item: $openedCost) { costId in
                destination(for: Route.cost(costId))
            }
            .confirmDelete(
                tr("fuel_delete_title"),
                message: deleting?.deleteText ?? "",
                isPresented: $confirmingDelete
            ) {
                if let row = deleting { model.store.delete(id: row.id) }
            }
            .onChange(of: state.done) { _, done in
                if done {
                    sheet = nil
                    model.store.ackDone()
                }
            }
    }

    private func open(_ logId: String?) {
        model.store.clearForm()
        sheet = FuelSheet(logId: logId)
    }

    @ViewBuilder
    private func content(_ state: FuelLogState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            ScrollView {
                VStack(spacing: 16) {
                    if state.notice != nil {
                        CardSection(title: "") {
                            VehicleNotice(text: state.notice, dismiss: { model.store.dismissNotice() })
                        }
                    }
                    if state.actionError != nil {
                        CardSection(title: "") {
                            ErrorBanner(error: state.actionError)
                        }
                    }
                    Text(tr("fuel_card_description"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    ForEach(state.panels, id: \.unit) { panel in
                        panelCard(panel)
                    }
                    if state.rows.isEmpty {
                        EmptyStateView(title: tr("fuel_empty_title"), message: tr("fuel_empty_body"), systemImage: "fuelpump")
                    }
                    CardSection(title: "") {
                        ForEach(state.rows, id: \.id) { row in
                            fuelRow(row)
                            Divider()
                        }
                        if state.hasMore {
                            Button(tr("common_load_more")) { model.store.loadMore() }
                                .disabled(state.loadingMore)
                        }
                    }
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .refreshable { model.store.refresh() }
        }
    }

    private func panelCard(_ panel: FuelPanel) -> some View {
        CardSection(title: "") {
            Text(tr("fuel_avg_title"))
                .font(.caption)
                .foregroundStyle(.secondary)
            if let average = panel.average {
                Text(average)
                    .font(.title2.weight(.semibold))
                if let stretches = panel.stretches {
                    Text(stretches)
                        .font(.footnote)
                }
                VehicleSparkline(points: panel.consumptionSpark)
                if let range = panel.consumptionRange {
                    Text(range)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text(tr("fuel_avg_none"))
                    .font(.headline)
                Text(tr("fuel_avg_none_hint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Text(panel.priceTitle)
                .font(.caption)
                .foregroundStyle(.secondary)
            if let price = panel.price {
                Text(price)
                    .font(.title2.weight(.semibold))
                VehicleSparkline(points: panel.priceSpark)
                if let range = panel.priceRange {
                    Text(range)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text(tr("fuel_price_none"))
                    .font(.headline)
            }
        }
    }

    private func fuelRow(_ row: FuelRow) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(row.dateText)
                        .font(.subheadline.weight(.semibold))
                    if row.partial {
                        Badge(text: tr("fuel_partial"))
                    }
                    if row.missedPrevious {
                        Badge(text: tr("fuel_missed_badge"))
                    }
                }
                if let place = row.place {
                    Text(place)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Text(row.quantityLine)
                    .font(.footnote)
                if let stretch = row.stretchLine {
                    Text(stretch)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let notes = row.notes {
                    Text(notes)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(row.amountText)
                    .font(.subheadline.weight(.medium))
                if let rate = row.rateText {
                    Text(rate)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Menu {
                Button {
                    open(row.id)
                } label: {
                    Label(tr("common_edit"), systemImage: "pencil")
                }
                if let costId = row.costEntryId {
                    Button {
                        openedCost = costId
                    } label: {
                        Label(tr("fuel_cost_entry_open"), systemImage: "receipt")
                    }
                }
                Button(role: .destructive) {
                    deleting = row
                    confirmingDelete = true
                } label: {
                    Label(tr("common_delete"), systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .frame(minWidth: 44, minHeight: 44)
            }
            .accessibilityLabel(row.actionsLabel)
        }
    }
}

private struct FuelFormSheet: View {
    let store: FuelLogStore
    let state: FuelLogState
    let logId: String?
    @State private var date: String
    @State private var odometer: String
    @State private var quantity: String
    @State private var amount: String
    @State private var unit: String
    @State private var currency: String
    @State private var fullTank: Bool
    @State private var missedPrevious: Bool
    @State private var station: String
    @State private var notes: String
    @State private var paidByUserId: String
    @State private var bookId: String
    @State private var splitMode: String
    @State private var splitTouched: Bool
    @State private var shares: [String: String]

    init(store: FuelLogStore, state: FuelLogState, logId: String?) {
        self.store = store
        self.state = state
        self.logId = logId
        var start = store.newForm()
        if let logId, let existing = store.editForm(id: logId) {
            start = existing
        }
        _date = State(initialValue: start.date)
        _odometer = State(initialValue: start.odometer)
        _quantity = State(initialValue: start.quantity)
        _amount = State(initialValue: start.amount)
        _unit = State(initialValue: start.unit)
        _currency = State(initialValue: start.currency)
        _fullTank = State(initialValue: start.fullTank)
        _missedPrevious = State(initialValue: start.missedPrevious)
        _station = State(initialValue: start.station)
        _notes = State(initialValue: start.notes)
        _paidByUserId = State(initialValue: start.paidByUserId)
        _bookId = State(initialValue: start.bookId)
        _splitMode = State(initialValue: start.splitMode)
        _splitTouched = State(initialValue: start.splitTouched)
        _shares = State(initialValue: start.shares)
    }

    var body: some View {
        let view = store.view(form: form, editingId: logId)
        SheetForm(
            title: logId == nil ? tr("fuel_create_title") : tr("fuel_edit_title"),
            saveLabel: logId == nil ? tr("fuel_save") : tr("common_save"),
            saving: state.saving,
            onSave: { store.save(id: logId, form: form) }
        ) {
            Section {
                Text(tr("fuel_form_description"))
                    .font(.footnote)
                TextEntry(label: view.amountLabel, text: $amount, error: state.fieldErrors["amountMinor"], keyboard: .decimalPad)
                TextEntry(label: view.quantityLabel, text: $quantity, error: state.fieldErrors["quantity"], keyboard: .decimalPad)
                TextEntry(label: view.odometerLabel, text: $odometer, error: state.fieldErrors["odometer"], keyboard: .decimalPad)
                Text(state.readingHint)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                ToggleEntry(label: tr("fuel_full_tank"), isOn: $fullTank, hint: tr("fuel_full_tank_hint"))
                DateEntry(label: tr("fuel_date"), value: $date, error: state.fieldErrors["date"], clearable: false)
            }
            Section {
                if view.showBook {
                    ChoiceEntry(label: tr("cost_book"), selection: $bookId, options: vehicleChoices(store.bookChoices(editingId: logId)))
                    Text(tr("fuel_book_hint"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    FieldError(text: state.fieldErrors["bookId"])
                }
                ChoiceEntry(label: tr("fuel_unit"), selection: $unit, options: vehicleChoices(store.unitChoices()))
                TextEntry(label: tr("fuel_station"), text: $station, error: state.fieldErrors["station"])
                ToggleEntry(label: tr("fuel_missed_previous"), isOn: $missedPrevious, hint: tr("fuel_missed_previous_hint"))
                TextEntry(label: tr("fuel_notes"), text: $notes, error: state.fieldErrors["notes"], multiline: true)
                ChoiceEntry(
                    label: tr("cost_paid_by"),
                    selection: $paidByUserId,
                    options: vehicleChoices(store.payerChoices(editing: logId != nil))
                )
                TextEntry(
                    label: tr("cost_currency"),
                    text: $currency,
                    error: state.fieldErrors["currency"],
                    capitalization: .characters
                )
            }
            if view.showSplit {
                Section(tr("cost_split")) {
                    ChoiceEntry(
                        label: tr("cost_split"),
                        selection: Binding(get: { splitMode }, set: { next in
                            splitMode = next
                            splitTouched = true
                        }),
                        options: vehicleChoices(store.splitChoices())
                    )
                    Text(view.splitHint)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if view.showShares {
                        ForEach(state.people, id: \.value) { person in
                            TextEntry(
                                label: tr("cost_shares_person", ["name": person.label]),
                                text: Binding(get: { shares[person.value] ?? "" }, set: { shares[person.value] = $0 }),
                                keyboard: .decimalPad
                            )
                        }
                        Button(tr("cost_shares_equalize")) {
                            shares = store.equalizeShares(form: form).shares
                        }
                        if let status = view.sharesStatus {
                            Text(status)
                                .font(.footnote)
                        }
                        FieldError(text: state.fieldErrors["shares"])
                    }
                }
            }
            if let hint = view.costEntryHint {
                Section {
                    Text(hint)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            if state.formError != nil {
                Section {
                    ErrorBanner(error: state.formError)
                }
            }
        }
        .onChange(of: bookId) { _, next in
            splitMode = store.withBook(form: form, bookId: next, creating: logId == nil).splitMode
        }
        .onChange(of: currency) { _, next in
            let cleaned = store.withCurrency(form: form, text: next).currency
            if cleaned != next { currency = cleaned }
        }
    }

    private var form: FuelForm {
        FuelForm(
            date: date,
            odometer: odometer,
            quantity: quantity,
            amount: amount,
            unit: unit,
            currency: currency,
            fullTank: fullTank,
            missedPrevious: missedPrevious,
            station: station,
            notes: notes,
            paidByUserId: paidByUserId,
            bookId: bookId,
            splitMode: splitMode,
            splitTouched: splitTouched,
            shares: shares
        )
    }
}
