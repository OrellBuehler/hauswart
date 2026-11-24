import shared
import SwiftUI

/// What the room sheet is opened for: a new room (`roomId` nil) or one to edit.
private struct RoomSheet: Identifiable {
    let id = UUID()
    let roomId: String?
}

struct RoomsScreen: View {
    @StateObject private var model = Observed(RoomsStore(app: AppEnv.app))
    @State private var sheet: RoomSheet?
    @State private var deleting: RoomItem?
    @State private var confirmingDelete = false

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("nav_rooms"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        sheet = RoomSheet(roomId: nil)
                    } label: {
                        Label(tr("rooms_create"), systemImage: "plus")
                    }
                }
            }
            .sheet(item: $sheet) { open in
                RoomEditScreen(id: open.roomId)
            }
            .confirmDelete(
                tr("rooms_delete_title"),
                message: tr("rooms_delete_description", ["name": deleting?.name ?? ""]),
                isPresented: $confirmingDelete
            ) {
                if let room = deleting { model.store.delete(roomId: room.id) }
            }
    }

    @ViewBuilder
    private func content(_ state: RoomsState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.rooms.isEmpty {
            ErrorView(error: error) { model.store.refresh() }
        } else if state.rooms.isEmpty {
            EmptyStateView(title: tr("rooms_empty_title"), message: tr("rooms_empty_body"), systemImage: "door.left.hand.open")
        } else {
            List {
                if state.notice != nil {
                    Section {
                        NoticeBanner(notice: state.notice, dismiss: { model.store.dismissNotice() })
                    }
                }
                if state.actionError != nil {
                    Section {
                        ErrorBanner(error: state.actionError)
                    }
                }
                Section {
                    ForEach(state.rooms, id: \.id) { room in
                        NavigationLink(value: Route.room(room.id)) {
                            RoomRow(room: room)
                        }
                        .contextMenu {
                            Button {
                                sheet = RoomSheet(roomId: room.id)
                            } label: {
                                Label(tr("common_edit"), systemImage: "pencil")
                            }
                            Button {
                                model.store.move(roomId: room.id, delta: -1)
                            } label: {
                                Label(tr("rooms_move_up_item"), systemImage: "arrow.up")
                            }
                            .disabled(!room.canMoveUp)
                            Button {
                                model.store.move(roomId: room.id, delta: 1)
                            } label: {
                                Label(tr("rooms_move_down_item"), systemImage: "arrow.down")
                            }
                            .disabled(!room.canMoveDown)
                            Button(role: .destructive) {
                                deleting = room
                                confirmingDelete = true
                            } label: {
                                Label(tr("common_delete"), systemImage: "trash")
                            }
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                deleting = room
                                confirmingDelete = true
                            } label: {
                                Label(tr("common_delete"), systemImage: "trash")
                            }
                            Button {
                                sheet = RoomSheet(roomId: room.id)
                            } label: {
                                Label(tr("common_edit"), systemImage: "pencil")
                            }
                            .tint(.blue)
                        }
                    }
                }
            }
            .refreshable { model.store.refresh() }
        }
    }
}

private struct RoomRow: View {
    let room: RoomItem

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: roomSymbol(room.icon))
                .frame(width: 28)
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(room.name)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(room.assetsText)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if let tasks = room.tasksText {
                        Text(tasks)
                            .font(.footnote)
                            .foregroundStyle(room.hasOverdue ? Color.red : Color.orange)
                    }
                }
            }
        }
    }
}

/// Creates a room (`id` nil) or edits one. Presented as a sheet.
struct RoomEditScreen: View {
    @StateObject private var model: Observed<RoomEditStore, RoomEditState>
    @Environment(\.dismiss) private var dismiss
    @State private var loaded = false
    @State private var name = ""
    @State private var icon = ""
    @State private var notes = ""

    init(id: String?) {
        _model = StateObject(wrappedValue: Observed(RoomEditStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        SheetForm(
            title: state.isNew ? tr("rooms_create_title") : tr("rooms_edit_title"),
            saving: state.saving || !loaded,
            onSave: { model.store.save(form: RoomForm(name: name, icon: icon, notes: notes)) }
        ) {
            if let error = state.loadError {
                ErrorView(error: error) { model.store.retry() }
            } else if !loaded {
                ProgressView()
            } else {
                Section {
                    TextEntry(label: tr("rooms_name"), text: $name, error: state.fieldErrors["name"], capitalization: .words)
                }
                Section(tr("rooms_icon")) {
                    Picker(tr("rooms_icon"), selection: $icon) {
                        Text(tr("m_none")).tag("")
                        ForEach(state.iconOptions, id: \.name) { option in
                            Label(option.label, systemImage: roomSymbol(option.name)).tag(option.name)
                        }
                    }
                }
                Section {
                    TextEntry(label: tr("rooms_notes"), text: $notes, error: state.fieldErrors["notes"], multiline: true)
                }
                if state.error != nil {
                    Section {
                        ErrorBanner(error: state.error)
                    }
                }
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

    private func fill(_ initial: RoomForm?) {
        guard !loaded, let initial else { return }
        name = initial.name
        icon = initial.icon
        notes = initial.notes
        loaded = true
    }
}
