import shared
import SwiftUI

struct PlantsScreen: View {
    @StateObject private var model = Observed(PlantsStore(app: AppEnv.app))
    @State private var creating: AssetCreation?

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("nav_plants"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        creating = AssetCreation(kind: "plant", roomId: nil)
                    } label: {
                        Label(tr("plants_create"), systemImage: "plus")
                    }
                }
            }
            .sheet(item: $creating) { creation in
                AssetEditScreen(id: nil, kind: creation.kind, roomId: creation.roomId)
            }
    }

    @ViewBuilder
    private func content(_ state: PlantsState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.plants.isEmpty {
            ErrorView(error: error) { model.store.refresh() }
        } else if state.plants.isEmpty {
            EmptyStateView(title: tr("plants_empty_title"), message: tr("plants_empty_body"), systemImage: "leaf")
        } else {
            List {
                if state.notice != nil {
                    Section {
                        NoticeBanner(notice: state.notice, undo: { model.store.undo() }, dismiss: { model.store.dismissNotice() })
                    }
                }
                if state.actionError != nil {
                    Section {
                        ErrorBanner(error: state.actionError)
                    }
                }
                ForEach(state.plants, id: \.id) { plant in
                    Section {
                        PlantCard(plant: plant, watering: state.wateringId == plant.id, busy: state.wateringId != nil) {
                            model.store.water(plantId: plant.id)
                        }
                    }
                }
            }
            .refreshable { model.store.refresh() }
        }
    }
}

private struct PlantCard: View {
    let plant: PlantItem
    let watering: Bool
    let busy: Bool
    let onWater: () -> Void

    var body: some View {
        NavigationLink(value: Route.asset(plant.id)) {
            VStack(alignment: .leading, spacing: 2) {
                Text(plant.name)
                    .font(.headline)
                    .lineLimit(1)
                if let species = plant.species {
                    Text(species)
                        .font(.subheadline)
                        .italic()
                        .lineLimit(1)
                }
                Text(plant.place)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        if !plant.hints.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text(tr("plants_hints"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                ForEach(plant.hints, id: \.id) { hint in
                    Label(hint.title, systemImage: hintKindSymbol(hint.kind))
                        .font(.subheadline)
                        .lineLimit(2)
                }
                if let more = plant.moreHints {
                    Text(more)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
        if plant.taskId != nil {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    if let status = plant.statusLabel {
                        Badge(text: status, color: Tone.color(plant.tone ?? "muted"))
                    }
                    if let dateText = plant.dateText {
                        Text(dateText)
                            .font(.footnote)
                    }
                }
                Spacer()
                Button {
                    onWater()
                } label: {
                    Label(watering ? tr("common_loading") : tr("plants_water"), systemImage: "drop")
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy)
            }
        } else {
            HStack {
                Text(tr("plants_no_plan"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Spacer()
                NavigationLink(value: Route.tasks) {
                    Text(tr("plants_add_plan"))
                        .font(.footnote)
                }
                .fixedSize()
            }
        }
    }
}
