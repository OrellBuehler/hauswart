import shared
import SwiftUI

/// The colour of a tag key, from the hex the shared module names for it.
func tagColor(_ key: String) -> Color {
    let hex = CostTagsStoresKt.tagColorHex(color: key)
    let value = UInt64(hex, radix: 16) ?? 0
    let red = Double((value >> 16) & 0xFF) / 255
    let green = Double((value >> 8) & 0xFF) / 255
    let blue = Double(value & 0xFF) / 255
    return Color(red: red, green: green, blue: blue)
}

/// The tag form is opened for one of these: a new tag or an existing one.
private struct TagTarget: Identifiable {
    let id = UUID()
    var tagId: String?
}

/// The cost tags with how many entries carry each.
struct CostTagsScreen: View {
    @StateObject private var model = Observed(CostTagsStore(app: AppEnv.app))
    @State private var target: TagTarget?
    @State private var deleteId: String?
    @State private var confirmingDelete = false

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("costtag_settings_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        target = TagTarget(tagId: nil)
                    } label: {
                        Label(tr("costtag_new"), systemImage: "plus")
                    }
                }
            }
            .sheet(item: $target) { item in
                TagEditScreen(id: item.tagId)
            }
            .confirmDelete(
                tr("costtag_delete_title"),
                message: deleteId.map { model.store.deleteText(id: $0) } ?? "",
                isPresented: $confirmingDelete
            ) {
                if let id = deleteId { model.store.delete(id: id) }
            }
    }

    @ViewBuilder
    private func content(_ state: CostTagsState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.rows.isEmpty {
            ErrorView(error: error) { model.store.refresh() }
        } else if state.rows.isEmpty {
            EmptyStateView(title: tr("costtag_empty_title"), message: tr("costtag_empty_body"), systemImage: "tag")
        } else {
            list(state)
        }
    }

    private func list(_ state: CostTagsState) -> some View {
        List {
            if let notice = state.notice {
                Section {
                    CostsNoticeRow(message: notice) { model.store.dismissNotice() }
                }
            }
            if state.actionError != nil {
                Section {
                    ErrorBanner(error: state.actionError)
                }
            }
            Section {
                ForEach(state.rows, id: \.id) { tag in
                    HStack(spacing: 12) {
                        Circle()
                            .fill(tagColor(tag.color))
                            .frame(width: 20, height: 20)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(tag.name)
                                .lineLimit(1)
                            Text(tag.colorLabel + " · " + tag.entryCountText)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture {
                        target = TagTarget(tagId: tag.id)
                    }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            deleteId = tag.id
                            confirmingDelete = true
                        } label: {
                            Label(tr("common_delete"), systemImage: "trash")
                        }
                        Button {
                            target = TagTarget(tagId: tag.id)
                        } label: {
                            Label(tr("common_edit"), systemImage: "pencil")
                        }
                        .tint(.blue)
                    }
                }
            } header: {
                Text(state.countText)
            } footer: {
                Text(tr("costtag_settings_description"))
            }
        }
        .refreshable { model.store.refresh() }
    }
}
