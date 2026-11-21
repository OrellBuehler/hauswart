import shared
import SwiftUI

/// Creates an asset (`id` nil, starting as `kind` in `roomId`) or edits one. Presented as a sheet.
struct AssetEditScreen: View {
    @StateObject private var model: Observed<AssetEditStore, AssetEditState>
    @Environment(\.dismiss) private var dismiss

    @State private var loaded = false
    @State private var kind = "device"
    @State private var name = ""
    @State private var roomId = ""
    @State private var category = ""
    @State private var manufacturer = ""
    @State private var assetModel = ""
    @State private var serialNumber = ""
    @State private var purchaseDate = ""
    @State private var installedDate = ""
    @State private var warrantyUntil = ""
    @State private var warrantyExtendedUntil = ""
    @State private var showOnEmergency = false
    @State private var notes = ""
    @State private var species = ""
    @State private var light = ""
    @State private var waterNotes = ""
    @State private var makePlan = true
    @State private var everyDays = "7"
    @State private var seasonal = false
    @State private var summerEveryDays = "3"

    init(id: String?, kind: String, roomId: String?) {
        _model = StateObject(wrappedValue: Observed(AssetEditStore(app: AppEnv.app, id: id, kind: kind, roomId: roomId)))
    }

    var body: some View {
        let state = model.state
        SheetForm(
            title: state.isNew ? tr("inventory_create") : tr("common_edit"),
            saving: state.saving || !loaded,
            onSave: { model.store.save(form: form) }
        ) {
            if let error = state.loadError {
                ErrorView(error: error) { model.store.retry() }
            } else if !loaded {
                ProgressView()
            } else {
                fields(state)
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
    private func fields(_ state: AssetEditState) -> some View {
        let isPlant = kind == "plant"
        let isVehicle = kind == "vehicle"
        let errors = state.fieldErrors
        Section {
            TextEntry(label: tr("asset_name"), text: $name, error: errors["name"], capitalization: .words)
            ChoiceEntry(label: tr("asset_kind"), selection: $kind, options: choices(state.kindOptions))
            ChoiceEntry(label: tr("asset_room"), selection: $roomId, options: choices(state.roomOptions))
            if !isPlant {
                TextEntry(label: tr("asset_category"), text: $category, error: errors["category"])
            }
        }
        if isPlant {
            Section(tr("asset_form_care")) {
                TextEntry(label: tr("asset_species"), text: $species, error: errors["species"])
                TextEntry(label: tr("asset_light"), text: $light, error: errors["light"])
                TextEntry(label: tr("asset_water_notes"), text: $waterNotes, error: errors["waterNotes"], multiline: true)
            }
            if state.isNew {
                Section(tr("asset_form_plan")) {
                    ToggleEntry(label: tr("asset_form_plan_enable"), isOn: $makePlan, hint: tr("asset_form_plan_description"))
                    if makePlan {
                        TextEntry(label: tr("asset_form_plan_every"), text: $everyDays, error: errors["everyDays"], keyboard: .numberPad)
                        ToggleEntry(label: tr("asset_form_plan_seasonal"), isOn: $seasonal)
                        if seasonal {
                            TextEntry(
                                label: tr("asset_form_plan_summer"),
                                text: $summerEveryDays,
                                error: errors["summerEveryDays"],
                                keyboard: .numberPad
                            )
                        }
                    }
                }
            }
        } else {
            Section(isVehicle ? tr("asset_form_vehicle") : tr("asset_form_device")) {
                TextEntry(
                    label: isVehicle ? tr("vehicle_make") : tr("asset_manufacturer"),
                    text: $manufacturer,
                    error: errors["manufacturer"],
                    capitalization: .words
                )
                TextEntry(label: tr("asset_model"), text: $assetModel, error: errors["model"])
                if !isVehicle {
                    TextEntry(label: tr("asset_serial"), text: $serialNumber, error: errors["serialNumber"])
                }
            }
            Section(tr("asset_form_purchase")) {
                DateEntry(label: tr("asset_purchase_date"), value: $purchaseDate, error: errors["purchaseDate"])
                if !isVehicle {
                    DateEntry(label: tr("asset_installed_date"), value: $installedDate, error: errors["installedDate"])
                }
                DateEntry(label: tr("asset_warranty_until"), value: $warrantyUntil, error: errors["warrantyUntil"])
                DateEntry(label: tr("asset_warranty_extended"), value: $warrantyExtendedUntil, error: errors["warrantyExtendedUntil"])
            }
        }
        Section(tr("asset_form_more")) {
            if !isVehicle || !notes.isEmpty {
                TextEntry(label: tr("asset_notes"), text: $notes, error: errors["notes"], multiline: true)
            }
            ToggleEntry(label: tr("asset_emergency"), isOn: $showOnEmergency, hint: tr("asset_emergency_hint"))
            if isVehicle {
                Text(tr("m_asset_vehicle_hint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        if state.error != nil {
            Section {
                ErrorBanner(error: state.error)
            }
        }
    }

    private var form: AssetForm {
        AssetForm(
            kind: kind,
            name: name,
            roomId: roomId,
            category: category,
            manufacturer: manufacturer,
            model: assetModel,
            serialNumber: serialNumber,
            purchaseDate: purchaseDate,
            installedDate: installedDate,
            warrantyUntil: warrantyUntil,
            warrantyExtendedUntil: warrantyExtendedUntil,
            showOnEmergency: showOnEmergency,
            notes: notes,
            species: species,
            light: light,
            waterNotes: waterNotes,
            makePlan: makePlan,
            everyDays: everyDays,
            seasonal: seasonal,
            summerEveryDays: summerEveryDays
        )
    }

    private func fill(_ initial: AssetForm?) {
        guard !loaded, let initial else { return }
        kind = initial.kind
        name = initial.name
        roomId = initial.roomId
        category = initial.category
        manufacturer = initial.manufacturer
        assetModel = initial.model
        serialNumber = initial.serialNumber
        purchaseDate = initial.purchaseDate
        installedDate = initial.installedDate
        warrantyUntil = initial.warrantyUntil
        warrantyExtendedUntil = initial.warrantyExtendedUntil
        showOnEmergency = initial.showOnEmergency
        notes = initial.notes
        species = initial.species
        light = initial.light
        waterNotes = initial.waterNotes
        makePlan = initial.makePlan
        everyDays = initial.everyDays
        seasonal = initial.seasonal
        summerEveryDays = initial.summerEveryDays
        loaded = true
    }
}
