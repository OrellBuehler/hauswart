import shared
import SwiftUI

/// One tire set with its history and its photos.
struct TireSetDetailScreen: View {
    private let id: String
    @StateObject private var model: Observed<TireSetDetailStore, TireSetDetailState>

    init(id: String) {
        self.id = id
        _model = StateObject(wrappedValue: Observed(TireSetDetailStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(state.row?.title ?? tr("m_vehicle_tire_detail_title"))
            .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private func content(_ state: TireSetDetailState) -> some View {
        if let row = state.row {
            List {
                Section {
                    if !row.make.isEmpty {
                        Text(row.make)
                    }
                    if let badge = row.badge {
                        Badge(text: badge, color: row.mounted ? Color.green : Color.secondary)
                    }
                    ForEach(row.facts, id: \.label) { fact in
                        VehicleFactRow(fact: fact)
                    }
                    ForEach(row.warnings, id: \.self) { warning in
                        Text(warning)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                    if let notes = row.notes {
                        Text(notes)
                            .font(.footnote)
                    }
                }
                Section(tr("vehicle_history_title")) {
                    ForEach(state.events, id: \.id) { event in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.title)
                            Text(event.detail)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                AttachmentsSection(ownerType: "tire_set", ownerId: id)
            }
            .refreshable { model.store.refresh() }
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            LoadingView()
        }
    }
}
