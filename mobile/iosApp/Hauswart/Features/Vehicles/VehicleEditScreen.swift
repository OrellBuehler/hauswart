import shared
import SwiftUI

/// Plate, VIN, registration data, tire sizes, location, odometer unit, notes and the cost book of a vehicle. Presented as a sheet.
struct VehicleEditScreen: View {
    @StateObject private var model: Observed<VehicleEditStore, VehicleEditState>
    @Environment(\.dismiss) private var dismiss
    @State private var loaded = false
    @State private var plate = ""
    @State private var vin = ""
    @State private var registrationNumber = ""
    @State private var firstRegistration = ""
    @State private var fuelType = ""
    @State private var tireSizeSummer = ""
    @State private var tireSizeWinter = ""
    @State private var location = ""
    @State private var odometerUnit = "km"
    @State private var notes = ""
    @State private var costBookId = ""

    init(assetId: String) {
        _model = StateObject(wrappedValue: Observed(VehicleEditStore(app: AppEnv.app, assetId: assetId)))
    }

    var body: some View {
        let state = model.state
        NavigationStack {
            content(state)
                .navigationTitle(tr("m_vehicle_edit_title"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(tr("common_cancel")) { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(state.saving ? tr("common_saving") : tr("common_save")) {
                            model.store.save(form: form)
                        }
                        .disabled(state.saving || !loaded)
                    }
                }
        }
        .onAppear { fill(state.initial) }
        .onChange(of: state.initial) { _, initial in
            fill(initial)
        }
        .onChange(of: state.saved) { _, saved in
            if saved { dismiss() }
        }
    }

    @ViewBuilder
    private func content(_ state: VehicleEditState) -> some View {
        if let error = state.loadError {
            ErrorView(error: error) { model.store.retry() }
        } else if !loaded {
            LoadingView()
        } else {
            Form {
                if state.error != nil {
                    Section {
                        ErrorBanner(error: state.error)
                    }
                }
                Section {
                    TextEntry(
                        label: tr("vehicle_plate"),
                        text: $plate,
                        error: state.fieldErrors["plate"],
                        capitalization: .characters
                    )
                    DateEntry(
                        label: tr("vehicle_first_registration"),
                        value: $firstRegistration,
                        error: state.fieldErrors["firstRegistration"]
                    )
                    TextEntry(label: tr("vehicle_vin"), text: $vin, error: state.fieldErrors["vin"], capitalization: .characters)
                    TextEntry(
                        label: tr("vehicle_registration_number"),
                        text: $registrationNumber,
                        error: state.fieldErrors["registrationNumber"]
                    )
                    ChoiceEntry(label: tr("vehicle_fuel"), selection: $fuelType, options: vehicleChoices(state.fuelTypes))
                }
                Section {
                    TextEntry(
                        label: tr("vehicle_tire_summer"),
                        text: $tireSizeSummer,
                        error: state.fieldErrors["tireSizeSummer"],
                        capitalization: .characters
                    )
                    TextEntry(
                        label: tr("vehicle_tire_winter"),
                        text: $tireSizeWinter,
                        error: state.fieldErrors["tireSizeWinter"],
                        capitalization: .characters
                    )
                    TextEntry(label: tr("vehicle_location"), text: $location, error: state.fieldErrors["location"])
                }
                Section {
                    ChoiceEntry(label: tr("vehicle_odometer_unit"), selection: $odometerUnit, options: vehicleChoices(state.units))
                    Text(tr("vehicle_odometer_unit_hint"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    ChoiceEntry(label: tr("vehicle_cost_book"), selection: $costBookId, options: vehicleChoices(state.books))
                    FieldError(text: state.fieldErrors["costBookId"])
                    Text(tr("vehicle_cost_book_hint"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Section {
                    TextEntry(label: tr("vehicle_notes"), text: $notes, error: state.fieldErrors["notes"], multiline: true)
                }
            }
        }
    }

    private var form: VehicleForm {
        VehicleForm(
            plate: plate,
            vin: vin,
            registrationNumber: registrationNumber,
            firstRegistration: firstRegistration,
            fuelType: fuelType,
            tireSizeSummer: tireSizeSummer,
            tireSizeWinter: tireSizeWinter,
            location: location,
            odometerUnit: odometerUnit,
            notes: notes,
            costBookId: costBookId
        )
    }

    private func fill(_ initial: VehicleForm?) {
        guard !loaded, let initial else { return }
        plate = initial.plate
        vin = initial.vin
        registrationNumber = initial.registrationNumber
        firstRegistration = initial.firstRegistration
        fuelType = initial.fuelType
        tireSizeSummer = initial.tireSizeSummer
        tireSizeWinter = initial.tireSizeWinter
        location = initial.location
        odometerUnit = initial.odometerUnit
        notes = initial.notes
        costBookId = initial.costBookId
        loaded = true
    }
}
