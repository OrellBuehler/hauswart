import shared
import SwiftUI

private enum TireSheet: Identifiable {
    case form(String?)
    case mount(String)
    case measure(String)

    var id: String {
        switch self {
        case let .form(id): return "form-" + (id ?? "new")
        case let .mount(id): return "mount-" + id
        case let .measure(id): return "measure-" + id
        }
    }
}

/// The tire sets of a vehicle with add, edit, mount, tread measurement, retire and delete.
struct TireSetsScreen: View {
    @StateObject private var model: Observed<TireSetsStore, TireSetsState>
    @State private var sheet: TireSheet?
    @State private var deleting: TireSetRow?
    @State private var confirmingDelete = false
    @State private var retiring: TireSetRow?
    @State private var confirmingRetire = false

    init(assetId: String) {
        _model = StateObject(wrappedValue: Observed(TireSetsStore(app: AppEnv.app, assetId: assetId)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("tire_card_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        open(.form(nil))
                    } label: {
                        Label(tr("tire_add"), systemImage: "plus")
                    }
                }
            }
            .sheet(item: $sheet) { item in
                sheetContent(item)
            }
            .confirmDelete(
                tr("tire_delete_title"),
                message: tr("tire_delete_description", ["name": deleting?.title ?? ""]),
                isPresented: $confirmingDelete
            ) {
                if let row = deleting { model.store.delete(id: row.id) }
            }
            .confirmationDialog(tr("tire_retire_title"), isPresented: $confirmingRetire, titleVisibility: .visible) {
                Button(tr("tire_retire")) {
                    if let row = retiring { model.store.setRetired(id: row.id, retired: true) }
                }
                Button(tr("common_cancel"), role: .cancel) {}
            } message: {
                Text(tr("tire_retire_description", ["name": retiring?.title ?? ""]))
            }
            .onChange(of: state.done) { _, done in
                if done {
                    sheet = nil
                    model.store.ackDone()
                }
            }
    }

    private func open(_ next: TireSheet) {
        model.store.clearForm()
        if case .form = next {
            model.store.prepareForm()
        }
        sheet = next
    }

    @ViewBuilder
    private func sheetContent(_ item: TireSheet) -> some View {
        switch item {
        case let .form(id):
            TireSetFormSheet(store: model.store, state: model.state, id: id)
        case let .mount(id):
            TireMountSheet(store: model.store, state: model.state, id: id)
        case let .measure(id):
            TireMeasureSheet(store: model.store, state: model.state, id: id)
        }
    }

    @ViewBuilder
    private func content(_ state: TireSetsState) -> some View {
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
                    if let summary = state.summary {
                        Text(summary)
                            .font(.subheadline)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if !state.warnings.isEmpty {
                        CardSection(title: tr("tire_alert_title")) {
                            ForEach(state.warnings, id: \.self) { warning in
                                Text(warning)
                                    .font(.footnote)
                                    .foregroundStyle(.red)
                            }
                        }
                    }
                    if state.rows.isEmpty {
                        EmptyStateView(title: tr("tire_empty_title"), message: tr("tire_empty_body"), systemImage: "circle.dotted")
                    }
                    ForEach(state.visible, id: \.id) { row in
                        card(row)
                    }
                    if !state.retiredToggle.isEmpty {
                        Button(state.retiredToggle) { model.store.toggleRetired() }
                    }
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .refreshable { model.store.refresh() }
        }
    }

    private func card(_ row: TireSetRow) -> some View {
        CardSection(title: "") {
            HStack(alignment: .top) {
                LinkRow(route: Route.vehicleTireSet(row.id)) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(row.title)
                            .font(.headline)
                        if !row.make.isEmpty {
                            Text(row.make)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        if let badge = row.badge {
                            Badge(text: badge, color: row.mounted ? Color.green : Color.secondary)
                        }
                    }
                }
                Menu {
                    Button {
                        open(.form(row.id))
                    } label: {
                        Label(tr("common_edit"), systemImage: "pencil")
                    }
                    if row.retired {
                        Button {
                            model.store.setRetired(id: row.id, retired: false)
                        } label: {
                            Label(tr("tire_unretire"), systemImage: "tray.and.arrow.up")
                        }
                    } else {
                        Button {
                            if row.mounted {
                                retiring = row
                                confirmingRetire = true
                            } else {
                                model.store.setRetired(id: row.id, retired: true)
                            }
                        } label: {
                            Label(tr("tire_retire"), systemImage: "archivebox")
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
            ForEach(row.facts, id: \.label) { fact in
                VehicleFactRow(fact: fact)
            }
            if let notes = row.notes {
                Text(notes)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if row.canMount || row.canMeasure {
                HStack {
                    if row.canMount {
                        Button(tr("tire_mount")) { open(.mount(row.id)) }
                            .buttonStyle(.bordered)
                    }
                    if row.canMeasure {
                        Button(tr("tire_measure")) { open(.measure(row.id)) }
                            .buttonStyle(.bordered)
                    }
                }
            }
        }
    }
}

private struct TireSetFormSheet: View {
    let store: TireSetsStore
    let state: TireSetsState
    let id: String?
    @State private var season: String
    @State private var brand: String
    @State private var model: String
    @State private var size: String
    @State private var dot: String
    @State private var treadDepth: String
    @State private var treadMeasuredOn: String
    @State private var storageLocation: String
    @State private var storageContactId: String
    @State private var purchasedOn: String
    @State private var notes: String

    init(store: TireSetsStore, state: TireSetsState, id: String?) {
        self.store = store
        self.state = state
        self.id = id
        var start = store.blankForm(season: "winter")
        if let id, let existing = store.editForm(id: id) {
            start = existing
        }
        _season = State(initialValue: start.season)
        _brand = State(initialValue: start.brand)
        _model = State(initialValue: start.model)
        _size = State(initialValue: start.size)
        _dot = State(initialValue: start.dot)
        _treadDepth = State(initialValue: start.treadDepth)
        _treadMeasuredOn = State(initialValue: start.treadMeasuredOn)
        _storageLocation = State(initialValue: start.storageLocation)
        _storageContactId = State(initialValue: start.storageContactId)
        _purchasedOn = State(initialValue: start.purchasedOn)
        _notes = State(initialValue: start.notes)
    }

    var body: some View {
        SheetForm(
            title: id == nil ? tr("tire_form_create_title") : tr("tire_form_edit_title"),
            saveLabel: id == nil ? tr("common_create") : tr("common_save"),
            saving: state.saving,
            onSave: { store.save(id: id, form: form(season: season)) }
        ) {
            Section {
                Text(tr("tire_form_description"))
                    .font(.footnote)
                ChoiceEntry(label: tr("tire_season"), selection: $season, options: vehicleChoices(store.seasonChoices()))
                TextEntry(label: tr("tire_brand"), text: $brand, error: state.fieldErrors["brand"])
                TextEntry(label: tr("tire_model"), text: $model, error: state.fieldErrors["model"])
                TextEntry(label: tr("tire_size"), text: $size, error: state.fieldErrors["size"], capitalization: .characters)
                TextEntry(label: tr("tire_dot"), text: $dot, error: state.fieldErrors["dot"], keyboard: .numberPad)
                Text(tr("tire_dot_hint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if id == nil {
                Section {
                    TextEntry(
                        label: tr("tire_tread_first"),
                        text: $treadDepth,
                        error: state.fieldErrors["treadDepthMm"],
                        keyboard: .decimalPad
                    )
                    Text(tr("tire_tread_first_hint"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if !treadDepth.trimmingCharacters(in: .whitespaces).isEmpty {
                        DateEntry(
                            label: tr("tire_tread_date"),
                            value: $treadMeasuredOn,
                            error: state.fieldErrors["treadMeasuredOn"],
                            clearable: false
                        )
                    }
                }
            }
            Section {
                TextEntry(label: tr("tire_storage"), text: $storageLocation, error: state.fieldErrors["storageLocation"])
                ChoiceEntry(label: tr("tire_storage_contact"), selection: $storageContactId, options: contactOptions)
                DateEntry(label: tr("tire_purchased"), value: $purchasedOn, error: state.fieldErrors["purchasedOn"])
                TextEntry(label: tr("tire_notes"), text: $notes, error: state.fieldErrors["notes"], multiline: true)
            }
            if state.formError != nil {
                Section {
                    ErrorBanner(error: state.formError)
                }
            }
        }
        .onChange(of: season) { old, next in
            let moved = store.withSeason(form: form(season: old), season: next)
            size = moved.size
        }
    }

    private var contactOptions: [Choice] {
        let options = vehicleChoices(state.contacts)
        return options.isEmpty ? [Choice(value: "", label: tr("m_vehicle_none"))] : options
    }

    private func form(season: String) -> TireSetForm {
        TireSetForm(
            season: season,
            brand: brand,
            model: model,
            size: size,
            dot: dot,
            treadDepth: treadDepth,
            treadMeasuredOn: treadMeasuredOn,
            storageLocation: storageLocation,
            storageContactId: storageContactId,
            purchasedOn: purchasedOn,
            notes: notes
        )
    }
}

private struct TireMountSheet: View {
    let store: TireSetsStore
    let state: TireSetsState
    let id: String
    @State private var date: String
    @State private var odometer: String

    init(store: TireSetsStore, state: TireSetsState, id: String) {
        self.store = store
        self.state = state
        self.id = id
        let start = store.blankMountForm()
        _date = State(initialValue: start.date)
        _odometer = State(initialValue: start.odometer)
    }

    var body: some View {
        SheetForm(
            title: tr("tire_mount_title"),
            saveLabel: tr("tire_mount_submit"),
            saving: state.saving,
            onSave: { store.mount(id: id, form: TireMountForm(date: date, odometer: odometer)) }
        ) {
            Section {
                Text(tr("tire_mount_description", ["name": store.titleOf(id: id)]))
                    .font(.footnote)
                DateEntry(label: tr("tire_mount_date"), value: $date, error: state.fieldErrors["date"], clearable: false)
                TextEntry(
                    label: tr("vehicle_odometer_value", ["unit": state.unit]),
                    text: $odometer,
                    error: state.fieldErrors["odometer"],
                    keyboard: .decimalPad
                )
                Text(state.readingHint)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if state.formError != nil {
                Section {
                    ErrorBanner(error: state.formError)
                }
            }
        }
    }
}

private struct TireMeasureSheet: View {
    let store: TireSetsStore
    let state: TireSetsState
    let id: String
    @State private var date: String
    @State private var depth = ""
    @State private var odometer: String

    init(store: TireSetsStore, state: TireSetsState, id: String) {
        self.store = store
        self.state = state
        self.id = id
        let start = store.blankTreadForm()
        _date = State(initialValue: start.date)
        _odometer = State(initialValue: start.odometer)
    }

    var body: some View {
        SheetForm(
            title: tr("tire_tread_title"),
            saving: state.saving,
            onSave: { store.measure(id: id, form: TireTreadForm(date: date, depth: depth, odometer: odometer)) }
        ) {
            Section {
                Text(tr("tire_tread_description", ["name": store.titleOf(id: id)]))
                    .font(.footnote)
                TextEntry(
                    label: tr("tire_tread_depth"),
                    text: $depth,
                    error: state.fieldErrors["treadDepthMm"],
                    keyboard: .decimalPad
                )
                Text(state.treadHint)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                DateEntry(label: tr("tire_tread_date"), value: $date, error: state.fieldErrors["date"], clearable: false)
                TextEntry(
                    label: tr("vehicle_odometer_value", ["unit": state.unit]),
                    text: $odometer,
                    error: state.fieldErrors["odometer"],
                    keyboard: .decimalPad
                )
                Text(state.readingHint)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if state.formError != nil {
                Section {
                    ErrorBanner(error: state.formError)
                }
            }
        }
    }
}
