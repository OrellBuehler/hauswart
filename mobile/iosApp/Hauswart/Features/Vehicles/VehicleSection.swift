import shared
import SwiftUI

/// The vehicle card of the asset screen: plate, odometer with its record sheet, the vehicle's facts and the way to
/// the odometer history, tire sets, fuel log, statistics, details and task setup. Shows nothing for an asset that
/// is no vehicle.
struct VehicleSectionCard: View {
    private let assetId: String
    @StateObject private var model: Observed<VehicleSectionStore, VehicleSectionState>
    @State private var recording = false
    @State private var editing = false
    @State private var settingUp = false

    init(assetId: String) {
        self.assetId = assetId
        _model = StateObject(wrappedValue: Observed(VehicleSectionStore(app: AppEnv.app, assetId: assetId)))
    }

    var body: some View {
        let state = model.state
        if !state.notVehicle {
            CardSection(title: tr("vehicle_card_title")) {
                content(state)
            }
            .sheet(isPresented: $recording) {
                RecordOdometerSheet(assetId: assetId)
            }
            .sheet(isPresented: $editing) {
                VehicleEditScreen(assetId: assetId)
            }
            .sheet(isPresented: $settingUp) {
                VehicleSetupScreen(assetId: assetId)
            }
        }
    }

    @ViewBuilder
    private func content(_ state: VehicleSectionState) -> some View {
        if state.loading {
            ProgressView()
        } else if let error = state.error {
            ErrorBanner(error: error)
            Button(tr("common_retry")) { model.store.refresh() }
        } else {
            if let plate = state.plate {
                Badge(text: plate, color: .primary)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(tr("vehicle_odometer_title"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let odometer = state.odometer {
                    Text(odometer)
                        .font(.title.weight(.semibold))
                    if let date = state.odometerDate {
                        Text(date)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text(tr("vehicle_odometer_none"))
                        .font(.headline)
                    Text(tr("vehicle_odometer_none_hint"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            Button {
                recording = true
            } label: {
                Label(tr("vehicle_record_odometer"), systemImage: "gauge")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            if state.facts.isEmpty {
                Text(tr("vehicle_facts_empty"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(state.facts, id: \.label) { fact in
                VehicleFactRow(fact: fact)
            }
            ValueRow(label: tr("vehicle_notes"), value: state.notes)
            Divider()
            LinkRow(route: Route.vehicleOdometer(assetId)) {
                Label(tr("m_vehicle_link_odometer"), systemImage: "gauge")
            }
            LinkRow(route: Route.vehicleTires(assetId)) {
                Label(tr("tire_card_title"), systemImage: "circle.dotted")
            }
            LinkRow(route: Route.vehicleFuel(assetId)) {
                Label(tr("fuel_card_title"), systemImage: "fuelpump")
            }
            LinkRow(route: Route.vehicleStats(assetId)) {
                Label(tr("m_vehicle_link_stats"), systemImage: "chart.bar")
            }
            Button {
                settingUp = true
            } label: {
                Label(tr("vehicle_setup_open"), systemImage: "calendar.badge.plus")
            }
            Button {
                editing = true
            } label: {
                Label(tr("m_vehicle_edit_action"), systemImage: "pencil")
            }
        }
    }
}
