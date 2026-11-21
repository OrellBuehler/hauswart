import shared
import SwiftUI

/// Creates a part (`id` nil) or edits one. Presented as a sheet; `onSaved` gets the id.
struct PartFormSheet: View {
    private let onSaved: ((String) -> Void)?
    @StateObject private var model: Observed<PartEditStore, PartEditState>
    @Environment(\.dismiss) private var dismiss
    @State private var loaded = false
    @State private var name = ""
    @State private var partNumber = ""
    @State private var supplier = ""
    @State private var shopUrl = ""
    @State private var price = ""
    @State private var stockCount = "0"
    @State private var minStock = "0"
    @State private var reorderQty = "1"
    @State private var leadTimeDays = "14"
    @State private var notes = ""

    init(id: String?, onSaved: ((String) -> Void)?) {
        self.onSaved = onSaved
        _model = StateObject(wrappedValue: Observed(PartEditStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        SheetForm(
            title: tr(state.isNew ? "part_create_title" : "part_edit_title"),
            saveLabel: tr(state.isNew ? "common_create" : "common_save"),
            saving: state.saving || !loaded,
            onSave: { model.store.save(form: form) }
        ) {
            content(state)
        }
        .onAppear { fill(state.initial) }
        .onChange(of: state.initial) { _, initial in
            fill(initial)
        }
        .onChange(of: state.savedId) { _, savedId in
            if let savedId {
                onSaved?(savedId)
                dismiss()
            }
        }
    }

    @ViewBuilder
    private func content(_ state: PartEditState) -> some View {
        if let error = state.loadError {
            Section {
                ErrorBanner(error: error)
                Button(tr("common_retry")) { model.store.retry() }
            }
        } else if !loaded {
            Section {
                ProgressView()
            }
        } else {
            Section {
                Text(tr(state.isNew ? "part_create_description" : "part_edit_description"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                TextEntry(label: tr("part_name"), text: $name, error: state.fieldErrors["name"])
                TextEntry(label: tr("part_number"), text: $partNumber, error: state.fieldErrors["partNumber"])
                TextEntry(
                    label: tr("part_supplier"),
                    text: $supplier,
                    error: state.fieldErrors["supplier"],
                    capitalization: .words
                )
                TextEntry(
                    label: tr("part_shop_url"),
                    text: $shopUrl,
                    error: state.fieldErrors["shopUrl"],
                    keyboard: .URL,
                    capitalization: .never
                )
                MoneyEntry(
                    label: tr("part_unit_price"),
                    text: $price,
                    currency: state.currency,
                    error: state.fieldErrors["unitPriceMinor"]
                )
            }
            Section {
                if state.isNew {
                    TextEntry(
                        label: tr("part_initial_stock"),
                        text: $stockCount,
                        error: state.fieldErrors["stockCount"],
                        keyboard: .numberPad
                    )
                }
                TextEntry(
                    label: tr("part_min_stock"),
                    text: $minStock,
                    error: state.fieldErrors["minStock"],
                    keyboard: .numberPad
                )
                TextEntry(
                    label: tr("part_reorder_qty"),
                    text: $reorderQty,
                    error: state.fieldErrors["reorderQty"],
                    keyboard: .numberPad
                )
                TextEntry(
                    label: tr("part_lead_time"),
                    text: $leadTimeDays,
                    error: state.fieldErrors["leadTimeDays"],
                    keyboard: .numberPad
                )
                Text(tr("part_stock_fields_hint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Section {
                TextEntry(label: tr("part_notes"), text: $notes, error: state.fieldErrors["notes"], multiline: true)
            }
            if state.error != nil {
                Section {
                    ErrorBanner(error: state.error)
                }
            }
        }
    }

    private var form: PartForm {
        PartForm(
            name: name,
            partNumber: partNumber,
            supplier: supplier,
            shopUrl: shopUrl,
            price: price,
            stockCount: stockCount,
            minStock: minStock,
            reorderQty: reorderQty,
            leadTimeDays: leadTimeDays,
            notes: notes
        )
    }

    private func fill(_ initial: PartForm?) {
        guard !loaded, let initial else { return }
        name = initial.name
        partNumber = initial.partNumber
        supplier = initial.supplier
        shopUrl = initial.shopUrl
        price = initial.price
        stockCount = initial.stockCount
        minStock = initial.minStock
        reorderQty = initial.reorderQty
        leadTimeDays = initial.leadTimeDays
        notes = initial.notes
        loaded = true
    }
}

/// Books a stock movement. Presented as a sheet.
struct PartStockSheet: View {
    @StateObject private var model: Observed<PartStockStore, PartStockState>
    @Environment(\.dismiss) private var dismiss
    @State private var loaded = false
    @State private var reason = "used"
    @State private var direction = "more"
    @State private var qty = "1"
    @State private var note = ""

    init(id: String, reason: String, qty: Int64) {
        _model = StateObject(wrappedValue: Observed(PartStockStore(
            app: AppEnv.app,
            id: id,
            initialReason: reason,
            initialQty: qty
        )))
    }

    var body: some View {
        let state = model.state
        SheetForm(
            title: tr("part_stock_dialog_title"),
            saveLabel: tr("part_stock_submit"),
            saving: state.saving || !loaded,
            onSave: { model.store.save(form: form) }
        ) {
            content(state)
        }
        .onAppear { fill(state.initial) }
        .onChange(of: state.initial) { _, initial in
            fill(initial)
        }
        .onChange(of: state.done) { _, done in
            if done { dismiss() }
        }
    }

    @ViewBuilder
    private func content(_ state: PartStockState) -> some View {
        if let error = state.loadError {
            Section {
                ErrorBanner(error: error)
                Button(tr("common_retry")) { model.store.retry() }
            }
        } else if !loaded {
            Section {
                ProgressView()
            }
        } else {
            Section {
                Text(state.intro)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                ChoiceEntry(label: tr("part_stock_reason"), selection: $reason, options: reasons)
                if reason == "correction" {
                    ChoiceEntry(
                        label: tr("part_stock_direction"),
                        selection: $direction,
                        options: [
                            Choice(value: "more", label: tr("part_stock_more")),
                            Choice(value: "less", label: tr("part_stock_less")),
                        ]
                    )
                }
                HStack {
                    Button {
                        qty = model.store.step(form: form, by: -1).qty
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(tr("part_stock_decrease"))
                    TextEntry(
                        label: tr("part_stock_qty"),
                        text: $qty,
                        error: state.fieldErrors["delta"],
                        keyboard: .numberPad
                    )
                    Button {
                        qty = model.store.step(form: form, by: 1).qty
                    } label: {
                        Image(systemName: "plus.circle")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(tr("part_stock_increase"))
                }
                Text(model.store.resultText(form: form))
                    .font(.subheadline)
                TextEntry(label: tr("part_stock_note"), text: $note, error: state.fieldErrors["note"])
            }
            if state.error != nil {
                Section {
                    ErrorBanner(error: state.error)
                }
            }
        }
    }

    private var reasons: [Choice] {
        PartsLogicKt.PART_MOVEMENT_REASONS.map {
            Choice(value: $0, label: PartsLogicKt.partMovementReasonLabel(reason: $0))
        }
    }

    private var form: PartStockForm {
        PartStockForm(reason: reason, direction: direction, qty: qty, note: note)
    }

    private func fill(_ initial: PartStockForm?) {
        guard !loaded, let initial else { return }
        reason = initial.reason
        direction = initial.direction
        qty = initial.qty
        note = initial.note
        loaded = true
    }
}

/// Marks a part as ordered. Presented as a sheet.
struct PartOrderedSheet: View {
    @StateObject private var model: Observed<PartOrderedStore, PartOrderedState>
    @Environment(\.dismiss) private var dismiss
    @State private var loaded = false
    @State private var qty = ""

    init(id: String) {
        _model = StateObject(wrappedValue: Observed(PartOrderedStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        SheetForm(
            title: tr("part_ordered_dialog_title"),
            saveLabel: tr("part_ordered_submit"),
            saving: state.saving || state.loading,
            onSave: { model.store.save(qtyText: qty) }
        ) {
            if let error = state.loadError {
                Section {
                    ErrorBanner(error: error)
                    Button(tr("common_retry")) { model.store.retry() }
                }
            } else if state.loading {
                Section {
                    ProgressView()
                }
            } else {
                Section {
                    Text(state.intro)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    TextEntry(
                        label: tr("part_ordered_qty"),
                        text: $qty,
                        error: state.fieldErrors["qty"],
                        keyboard: .numberPad
                    )
                }
                if state.error != nil {
                    Section {
                        ErrorBanner(error: state.error)
                    }
                }
            }
        }
        .onAppear { fillQty(state.initialQty) }
        .onChange(of: state.initialQty) { _, value in
            fillQty(value)
        }
        .onChange(of: state.done) { _, done in
            if done { dismiss() }
        }
    }

    private func fillQty(_ value: String) {
        guard !loaded, !value.isEmpty else { return }
        qty = value
        loaded = true
    }
}

/// Picks a device to link the part to. Presented as a sheet.
struct PartAssetLinkSheet: View {
    @StateObject private var model: Observed<PartAssetLinkStore, PartLinkState>
    @Environment(\.dismiss) private var dismiss
    @State private var chosen = ""

    init(partId: String) {
        _model = StateObject(wrappedValue: Observed(PartAssetLinkStore(app: AppEnv.app, partId: partId)))
    }

    var body: some View {
        let state = model.state
        SheetForm(
            title: tr("part_link_asset_title"),
            saveLabel: tr("part_link_submit"),
            saving: state.saving || state.loading,
            onSave: { model.store.link(assetId: chosen) }
        ) {
            Section {
                Text(tr("part_link_asset_description"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let error = state.loadError {
                Section {
                    ErrorBanner(error: error)
                    Button(tr("common_retry")) { model.store.retry() }
                }
            } else if state.loading {
                Section {
                    ProgressView()
                }
            } else {
                Section(tr("part_link_asset_list")) {
                    if state.options.isEmpty {
                        Text(tr("part_link_asset_empty"))
                            .foregroundStyle(.secondary)
                    }
                    PartChoiceList(options: state.options, selection: $chosen)
                    FieldError(text: state.fieldErrors["choice"])
                }
            }
            if state.error != nil {
                Section {
                    ErrorBanner(error: state.error)
                }
            }
        }
        .onChange(of: state.done) { _, done in
            if done { dismiss() }
        }
    }
}

/// Picks a task to link the part to and how many pieces a completion uses. Presented as a sheet.
struct PartTaskLinkSheet: View {
    @StateObject private var model: Observed<PartTaskLinkStore, PartTaskLinkState>
    @Environment(\.dismiss) private var dismiss
    @State private var chosen = ""
    @State private var qty = "1"

    init(partId: String) {
        _model = StateObject(wrappedValue: Observed(PartTaskLinkStore(app: AppEnv.app, partId: partId)))
    }

    var body: some View {
        let state = model.state
        SheetForm(
            title: tr("part_link_task_title"),
            saveLabel: tr("part_link_submit"),
            saving: state.saving || state.loading,
            onSave: { model.store.link(taskId: chosen, qtyText: qty) }
        ) {
            Section {
                Text(tr("task_part_link_description"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let error = state.loadError {
                Section {
                    ErrorBanner(error: error)
                    Button(tr("common_retry")) { model.store.retry() }
                }
            } else if state.loading {
                Section {
                    ProgressView()
                }
            } else {
                Section(tr("part_link_task_list")) {
                    if state.options.isEmpty {
                        Text(tr("part_link_task_empty"))
                            .foregroundStyle(.secondary)
                    }
                    PartChoiceList(options: state.options, selection: $chosen)
                    FieldError(text: state.fieldErrors["choice"])
                }
            }
            Section {
                TextEntry(
                    label: tr("task_part_qty"),
                    text: $qty,
                    error: state.fieldErrors["qty"],
                    keyboard: .numberPad
                )
                Text(tr("task_part_qty_hint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if state.error != nil {
                Section {
                    ErrorBanner(error: state.error)
                }
            }
        }
        .onChange(of: state.done) { _, done in
            if done { dismiss() }
        }
    }
}

/// Changes how many pieces a task uses. Presented as a sheet.
struct PartTaskQtySheet: View {
    @StateObject private var model: Observed<PartTaskQtyStore, PartTaskQtyState>
    @Environment(\.dismiss) private var dismiss
    @State private var qty: String

    init(partId: String, taskId: String, title: String, qty: Int64) {
        _model = StateObject(wrappedValue: Observed(PartTaskQtyStore(
            app: AppEnv.app,
            partId: partId,
            taskId: taskId,
            title: title
        )))
        _qty = State(initialValue: String(qty))
    }

    var body: some View {
        let state = model.state
        SheetForm(
            title: tr("task_part_edit_title"),
            saving: state.saving,
            onSave: { model.store.save(qtyText: qty) }
        ) {
            Section {
                Text(state.intro)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                TextEntry(
                    label: tr("task_part_qty"),
                    text: $qty,
                    error: state.fieldErrors["qty"],
                    keyboard: .numberPad
                )
                Text(tr("task_part_qty_hint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if state.error != nil {
                Section {
                    ErrorBanner(error: state.error)
                }
            }
        }
        .onChange(of: state.done) { _, done in
            if done { dismiss() }
        }
    }
}
