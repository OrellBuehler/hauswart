import shared
import SwiftUI

/// Sets up the recurring tasks of a vehicle from templates: tires, service, inspection, vignette, tax and more.
/// Presented as a sheet.
struct VehicleSetupScreen: View {
    @StateObject private var model: Observed<VehicleSetupStore, VehicleSetupState>
    @Environment(\.dismiss) private var dismiss
    @State private var loaded = false
    @State private var selected: [String] = []
    @State private var serviceDistance = ""
    @State private var serviceMonths = ""
    @State private var mfkDate = ""
    @State private var taxMonth = ""
    @State private var taxDay = ""
    @State private var brakeFluidLastDone = ""
    @State private var acServiceLastDone = ""

    init(assetId: String) {
        _model = StateObject(wrappedValue: Observed(VehicleSetupStore(app: AppEnv.app, assetId: assetId)))
    }

    var body: some View {
        let state = model.state
        NavigationStack {
            content(state)
                .navigationTitle(tr("m_vehicle_setup_title"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(tr("common_close")) { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(state.running ? tr("vehicle_setup_pending") : tr("vehicle_setup_submit")) {
                            model.store.submit(form: form)
                        }
                        .disabled(state.running || !loaded || state.nothingLeft)
                    }
                }
        }
        .onAppear { fill(state.initial) }
        .onChange(of: state.initial) { _, initial in
            fill(initial)
        }
    }

    @ViewBuilder
    private func content(_ state: VehicleSetupState) -> some View {
        if let error = state.loadError {
            ErrorView(error: error) { model.store.retry() }
        } else if !loaded {
            LoadingView()
        } else {
            Form {
                if state.notice != nil {
                    Section {
                        VehicleNotice(text: state.notice, dismiss: { model.store.dismissNotice() })
                    }
                }
                Section {
                    Text(tr("vehicle_setup_description", ["name": state.assetName]))
                        .font(.footnote)
                    FieldError(text: state.message)
                }
                ForEach(state.rows, id: \.id) { row in
                    rowSection(row, state)
                }
                if state.nothingLeft {
                    Section {
                        Text(tr("vehicle_setup_nothing_left"))
                            .font(.footnote)
                    }
                }
            }
        }
    }

    private func rowSection(_ row: VehicleSetupRow, _ state: VehicleSetupState) -> some View {
        let on = selected.contains(row.id) && !row.locked
        return Section {
            Toggle(isOn: Binding(
                get: { on },
                set: { next in selected = model.store.withSelected(form: form, id: row.id, on: next).selected }
            )) {
                HStack {
                    Text(row.title)
                    if row.existingTitle != nil {
                        Badge(text: tr("vehicle_setup_exists"))
                    } else if row.state == "created" {
                        Badge(text: tr("vehicle_setup_created"), color: .green)
                    } else if row.state == "running" {
                        Badge(text: tr("vehicle_setup_running"))
                    }
                }
            }
            .disabled(row.locked || row.state == "running")
            if let existing = row.existingTitle {
                Text(tr("vehicle_setup_exists_hint", ["title": existing]))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                if let summary = model.store.summary(id: row.id, form: form) {
                    Text(summary)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                ForEach(row.preparations, id: \.self) { line in
                    Text(line)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            FieldError(text: row.error)
            ForEach(row.preparationErrors, id: \.self) { problem in
                FieldError(text: problem)
            }
            if on {
                parameters(row.id, state)
            }
        }
    }

    @ViewBuilder
    private func parameters(_ id: String, _ state: VehicleSetupState) -> some View {
        switch id {
        case "service":
            TextEntry(
                label: tr("vehicle_setup_service_distance", ["unit": state.unit]),
                text: $serviceDistance,
                error: state.fieldErrors["serviceDistance"],
                keyboard: .decimalPad
            )
            TextEntry(
                label: tr("vehicle_setup_service_months"),
                text: $serviceMonths,
                error: state.fieldErrors["serviceMonths"],
                keyboard: .numberPad
            )
        case "mfk":
            DateEntry(label: tr("vehicle_setup_mfk_date"), value: $mfkDate, error: state.fieldErrors["mfkDate"], clearable: false)
            if state.firstRegistration == nil {
                Text(tr("vehicle_setup_mfk_unknown"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        case "vehicle_tax":
            TextEntry(label: tr("vehicle_setup_month"), text: $taxMonth, error: state.fieldErrors["taxMonth"], keyboard: .numberPad)
            TextEntry(label: tr("vehicle_setup_day"), text: $taxDay, error: state.fieldErrors["taxDay"], keyboard: .numberPad)
            Text(tr("vehicle_setup_tax_hint"))
                .font(.footnote)
                .foregroundStyle(.secondary)
        case "brake_fluid":
            DateEntry(label: tr("vehicle_setup_last_done"), value: $brakeFluidLastDone, error: state.fieldErrors["brakeFluidLastDone"])
        case "ac_service":
            DateEntry(label: tr("vehicle_setup_last_done"), value: $acServiceLastDone, error: state.fieldErrors["acServiceLastDone"])
        default:
            EmptyView()
        }
    }

    private var form: VehicleSetupForm {
        VehicleSetupForm(
            selected: selected,
            params: VehicleSetupParams(
                serviceDistance: serviceDistance,
                serviceMonths: serviceMonths,
                mfkDate: mfkDate,
                taxMonth: taxMonth,
                taxDay: taxDay,
                brakeFluidLastDone: brakeFluidLastDone,
                acServiceLastDone: acServiceLastDone
            )
        )
    }

    private func fill(_ initial: VehicleSetupForm?) {
        guard !loaded, let initial else { return }
        selected = initial.selected
        serviceDistance = initial.params.serviceDistance
        serviceMonths = initial.params.serviceMonths
        mfkDate = initial.params.mfkDate
        taxMonth = initial.params.taxMonth
        taxDay = initial.params.taxDay
        brakeFluidLastDone = initial.params.brakeFluidLastDone
        acServiceLastDone = initial.params.acServiceLastDone
        loaded = true
    }
}
