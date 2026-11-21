import shared
import SwiftUI

struct PartsScreen: View {
    @StateObject private var model = Observed(PartsListStore(app: AppEnv.app))
    @State private var query = ""
    @State private var creating = false
    @State private var openId: String? = nil
    @Environment(\.openURL) private var openURL

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("nav_parts"))
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: tr("parts_search_placeholder"))
            .onChange(of: query) { _, value in
                model.store.search(query: value)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        creating = true
                    } label: {
                        Label(tr("parts_create"), systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $creating) {
                PartFormSheet(id: nil, onSaved: { id in openId = id })
            }
            .navigationDestination(item: $openId) { id in
                PartDetailScreen(id: id)
            }
            .safeAreaInset(edge: .bottom) {
                if let notice = state.notice {
                    PartNoticeBar(
                        notice: notice,
                        onUndo: { partId in model.store.undoOrdered(partId: partId) },
                        onDismiss: { model.store.dismissNotice() }
                    )
                }
            }
    }

    @ViewBuilder
    private func content(_ state: PartsListState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.rows.isEmpty, state.orderNow.isEmpty {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            list(state)
        }
    }

    private func list(_ state: PartsListState) -> some View {
        List {
            if state.actionError != nil {
                Section {
                    ErrorBanner(error: state.actionError)
                }
            }
            if !state.orderNow.isEmpty {
                Section {
                    ForEach(state.orderNow, id: \.id) { item in
                        orderNowRow(item, busy: state.busyPartId == item.partId)
                    }
                } header: {
                    Label(tr("order_now_title"), systemImage: "cart")
                } footer: {
                    Text(tr("order_now_description"))
                }
            }
            if state.none {
                EmptyStateView(
                    title: tr("parts_empty_title"),
                    message: tr("parts_empty_body"),
                    systemImage: "puzzlepiece"
                )
            } else {
                Section {
                    Toggle(isOn: Binding(get: { model.state.lowOnly }, set: { model.store.setLowOnly(value: $0) })) {
                        Text(state
                            .lowCount > 0 ? tr("parts_low_only") + " (" + String(state.lowCount) + ")" :
                            tr("parts_low_only"))
                    }
                    if state.hasArchived {
                        Toggle(
                            tr("parts_show_archived"),
                            isOn: Binding(
                                get: { model.state.showArchived },
                                set: { model.store.setShowArchived(value: $0) }
                            )
                        )
                    }
                    Text(state.countText)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if state.filtered {
                        Button(tr("parts_filter_reset")) {
                            query = ""
                            model.store.reset()
                        }
                    }
                }
                if state.rows.isEmpty {
                    EmptyStateView(
                        title: tr("parts_no_results_title"),
                        message: tr("parts_no_results_body"),
                        systemImage: "magnifyingglass"
                    )
                }
                Section {
                    ForEach(state.rows, id: \.id) { row in
                        NavigationLink(value: Route.part(row.id)) {
                            PartRowView(row: row)
                        }
                    }
                }
            }
        }
        .refreshable { model.store.refresh() }
    }

    private func orderNowRow(_ item: OrderNowRow, busy: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                NavigationLink(value: Route.part(item.partId)) {
                    Text(item.partName)
                        .font(.headline)
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                Text(item.quantityText)
                    .font(.headline)
            }
            Text(tr("order_now_for_task") + " " + item.taskTitle)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            HStack(spacing: 6) {
                Text(item.neededByText)
                    .font(.footnote)
                if item.late {
                    Badge(text: tr("order_now_late"), color: .red)
                }
            }
            if item.late {
                Text(item.lateHint)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(([item.stockText, item.supplier, item.priceText] as [String?]).compactMap { $0 }
                .joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack(spacing: 12) {
                if let url = item.shopUrl {
                    Button {
                        if let target = URL(string: url) { openURL(target) }
                    } label: {
                        Label(tr("order_now_shop"), systemImage: "arrow.up.right.square")
                    }
                    .buttonStyle(.bordered)
                }
                Button {
                    model.store.markOrdered(partId: item.partId)
                } label: {
                    Label(tr("order_now_ordered"), systemImage: "checkmark")
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy)
            }
        }
    }
}
