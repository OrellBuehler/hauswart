import shared
import SwiftUI

struct RoomDetailScreen: View {
    private let id: String
    @StateObject private var model: Observed<RoomDetailStore, RoomDetailState>
    @Environment(\.dismiss) private var dismiss
    @State private var editing: RoomEditRequest?
    @State private var creating: AssetCreation?
    @State private var confirmingDelete = false

    init(id: String) {
        self.id = id
        _model = StateObject(wrappedValue: Observed(RoomDetailStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(state.room?.name ?? tr("nav_rooms"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if state.room != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button {
                                editing = RoomEditRequest()
                            } label: {
                                Label(tr("common_edit"), systemImage: "pencil")
                            }
                            Button(role: .destructive) {
                                confirmingDelete = true
                            } label: {
                                Label(tr("common_delete"), systemImage: "trash")
                            }
                        } label: {
                            Label(tr("asset_actions"), systemImage: "ellipsis.circle")
                        }
                    }
                }
            }
            .sheet(item: $editing) { _ in
                RoomEditScreen(id: id)
            }
            .sheet(item: $creating) { creation in
                AssetEditScreen(id: nil, kind: creation.kind, roomId: creation.roomId)
            }
            .confirmDelete(
                tr("rooms_delete_title"),
                message: tr("rooms_delete_description", ["name": state.room?.name ?? ""]),
                isPresented: $confirmingDelete
            ) {
                model.store.delete()
            }
            .onChange(of: state.deleted) { _, deleted in
                if deleted { dismiss() }
            }
    }

    @ViewBuilder
    private func content(_ state: RoomDetailState) -> some View {
        if let room = state.room {
            List {
                if state.actionError != nil {
                    Section {
                        ErrorBanner(error: state.actionError)
                    }
                }
                Section {
                    Label(room.name, systemImage: roomSymbol(room.icon))
                        .font(.headline)
                    if let notes = room.notes, !notes.isEmpty {
                        Text(notes)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                Section(tr("rooms_assets_title")) {
                    if state.assets.isEmpty {
                        Text(tr("rooms_assets_empty_title"))
                            .foregroundStyle(.secondary)
                    }
                    ForEach(state.assets, id: \.id) { row in
                        NavigationLink(value: Route.asset(row.id)) {
                            AssetRowView(row: row)
                        }
                    }
                    Button {
                        creating = AssetCreation(kind: "device", roomId: room.id)
                    } label: {
                        Label(tr("rooms_add_asset"), systemImage: "plus")
                    }
                }
                Section(tr("rooms_tasks_title")) {
                    if state.tasks.isEmpty {
                        Text(tr("rooms_tasks_empty_title"))
                            .foregroundStyle(.secondary)
                    }
                    ForEach(state.tasks, id: \.id) { line in
                        NavigationLink(value: Route.task(line.id)) {
                            TaskLineRow(line: line, showAsset: true)
                        }
                    }
                }
                RoomExtras(roomId: room.id)
            }
            .refreshable { model.store.refresh() }
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            LoadingView()
        }
    }
}

private struct RoomEditRequest: Identifiable {
    let id = UUID()
}
