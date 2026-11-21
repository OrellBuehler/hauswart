import shared
import SwiftUI

struct InventoryScreen: View {
    @StateObject private var model = Observed(InventoryStore(app: AppEnv.app))
    @State private var query = ""
    @State private var creating: AssetCreation?

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("nav_inventory"))
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: tr("inventory_search_placeholder"))
            .onChange(of: query) { _, value in
                model.store.search(query: value)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            creating = AssetCreation(kind: "device", roomId: nil)
                        } label: {
                            Label(tr("inventory_create"), systemImage: "cpu")
                        }
                        Button {
                            creating = AssetCreation(kind: "vehicle", roomId: nil)
                        } label: {
                            Label(tr("vehicle_create"), systemImage: "car")
                        }
                    } label: {
                        Label(tr("inventory_create"), systemImage: "plus")
                    }
                }
            }
            .sheet(item: $creating) { creation in
                AssetEditScreen(id: nil, kind: creation.kind, roomId: creation.roomId)
            }
    }

    @ViewBuilder
    private func content(_ state: InventoryState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.assetCount == 0 {
            ErrorView(error: error) { model.store.refresh() }
        } else if state.assetCount == 0 {
            EmptyStateView(
                title: tr("inventory_empty_title"),
                message: tr("inventory_empty_body"),
                systemImage: "shippingbox"
            )
        } else {
            List {
                Section {
                    Picker(tr("asset_room"), selection: roomBinding) {
                        ForEach(state.roomOptions, id: \.value) { option in
                            Text(option.label).tag(option.value)
                        }
                    }
                    Picker(tr("asset_kind"), selection: kindBinding) {
                        ForEach(state.kindOptions, id: \.value) { option in
                            Text(option.label).tag(option.value)
                        }
                    }
                    Picker(tr("asset_warranty"), selection: warrantyBinding) {
                        ForEach(state.warrantyOptions, id: \.value) { option in
                            Text(option.label).tag(option.value)
                        }
                    }
                    if state.hasArchived {
                        Toggle(tr("inventory_show_archived"), isOn: archivedBinding)
                    }
                } footer: {
                    HStack {
                        Text(state.countText)
                        Spacer()
                        if state.filtered {
                            Button(tr("inventory_filter_reset")) {
                                query = ""
                                model.store.resetFilter()
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                }
                if state.rows.isEmpty {
                    EmptyStateView(
                        title: tr("inventory_no_results_title"),
                        message: tr("inventory_no_results_body"),
                        systemImage: "magnifyingglass"
                    )
                }
                Section {
                    ForEach(state.rows, id: \.id) { row in
                        NavigationLink(value: Route.asset(row.id)) {
                            AssetRowView(row: row)
                        }
                    }
                }
            }
            .refreshable { model.store.refresh() }
        }
    }

    private var roomBinding: Binding<String> {
        Binding(
            get: { model.state.filter.roomId },
            set: { model.store.setRoom(roomId: $0) }
        )
    }

    private var kindBinding: Binding<String> {
        Binding(
            get: { model.state.filter.kind },
            set: { model.store.setKind(kind: $0) }
        )
    }

    private var warrantyBinding: Binding<String> {
        Binding(
            get: { model.state.filter.warranty },
            set: { model.store.setWarranty(status: $0) }
        )
    }

    private var archivedBinding: Binding<Bool> {
        Binding(
            get: { model.state.filter.archived },
            set: { model.store.setShowArchived(value: $0) }
        )
    }
}
