import shared
import SwiftUI

/// The sheet that records an odometer reading. It loads the vehicle's unit and latest reading when it appears.
struct RecordOdometerSheet: View {
    @StateObject private var model: Observed<OdometerRecordStore, OdometerRecordState>
    @Environment(\.dismiss) private var dismiss
    @State private var filled = false
    @State private var value = ""
    @State private var date = ""
    @State private var note = ""

    init(assetId: String) {
        _model = StateObject(wrappedValue: Observed(OdometerRecordStore(app: AppEnv.app, assetId: assetId)))
    }

    var body: some View {
        let state = model.state
        SheetForm(
            title: tr("vehicle_record_odometer"),
            saveLabel: model.store.isForced(form: form) ? tr("vehicle_odometer_save_anyway") : tr("common_save"),
            saving: state.saving || !filled,
            onSave: { model.store.save(form: form) }
        ) {
            if let error = state.loadError {
                Section {
                    ErrorBanner(error: error)
                    Button(tr("common_retry")) { model.store.reset() }
                }
            } else if !filled {
                Section {
                    ProgressView()
                }
            } else {
                Section {
                    Text(tr("vehicle_odometer_dialog_description"))
                        .font(.footnote)
                    FieldError(text: state.refusalText)
                    TextEntry(
                        label: tr("vehicle_odometer_value", ["unit": state.unit]),
                        text: $value,
                        error: state.fieldErrors["value"],
                        keyboard: .decimalPad
                    )
                    Text(state.hint)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    DateEntry(label: tr("vehicle_odometer_date"), value: $date, error: state.fieldErrors["date"], clearable: false)
                    TextEntry(label: tr("vehicle_odometer_note"), text: $note, error: state.fieldErrors["note"])
                }
                if state.error != nil && state.refusalText == nil {
                    Section {
                        ErrorBanner(error: state.error)
                    }
                }
            }
        }
        .onAppear {
            model.store.reset()
            fill(state.initial)
        }
        .onChange(of: state.initial) { _, initial in
            fill(initial)
        }
        .onChange(of: state.savedText) { _, text in
            if text != nil {
                model.store.ackSaved()
                dismiss()
            }
        }
    }

    private var form: OdometerForm {
        OdometerForm(value: value, date: date, note: note)
    }

    private func fill(_ initial: OdometerForm?) {
        guard !filled, let initial else { return }
        value = initial.value
        date = initial.date
        note = initial.note
        filled = true
    }
}

/// The odometer history of a vehicle, newest first, with delete.
struct OdometerScreen: View {
    private let assetId: String
    @StateObject private var model: Observed<OdometerStore, OdometerState>
    @State private var recording = false
    @State private var deleting: OdometerLine?
    @State private var confirmingDelete = false

    init(assetId: String) {
        self.assetId = assetId
        _model = StateObject(wrappedValue: Observed(OdometerStore(app: AppEnv.app, assetId: assetId)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("m_vehicle_odometer_screen_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        recording = true
                    } label: {
                        Label(tr("vehicle_record_odometer"), systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $recording) {
                RecordOdometerSheet(assetId: assetId)
            }
            .confirmDelete(
                tr("vehicle_history_delete_title"),
                message: deleting?.confirmText ?? "",
                isPresented: $confirmingDelete
            ) {
                if let line = deleting { model.store.delete(id: line.id) }
            }
    }

    @ViewBuilder
    private func content(_ state: OdometerState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            List {
                if state.notice != nil {
                    Section {
                        VehicleNotice(text: state.notice, dismiss: { model.store.dismissNotice() })
                    }
                }
                if state.actionError != nil {
                    Section {
                        ErrorBanner(error: state.actionError)
                    }
                }
                if state.lines.isEmpty {
                    Section {
                        EmptyStateView(title: tr("vehicle_history_empty"), message: tr("vehicle_odometer_none_hint"), systemImage: "gauge")
                    }
                }
                Section {
                    ForEach(state.lines, id: \.id) { line in
                        row(line, deleting: state.deleting)
                    }
                    if state.hasMore {
                        Button(tr("common_load_more")) { model.store.loadMore() }
                            .disabled(state.loadingMore)
                    }
                }
            }
            .refreshable { model.store.refresh() }
        }
    }

    private func row(_ line: OdometerLine, deleting isDeleting: Bool) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text(line.valueText)
                    .font(.headline)
                Text(line.dateText)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if let note = line.note {
                    Text(note)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if let source = line.sourceLabel {
                Badge(text: source)
            }
            Button {
                deleting = line
                confirmingDelete = true
            } label: {
                Image(systemName: "trash")
                    .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.borderless)
            .disabled(isDeleting)
            .accessibilityLabel(line.deleteLabel)
        }
    }
}
