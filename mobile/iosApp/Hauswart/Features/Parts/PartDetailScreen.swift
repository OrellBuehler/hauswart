import shared
import SwiftUI

/// Which sheet the detail screen shows: `edit`, `stock`, `ordered`, `asset`, `task` or `taskQty`.
private struct PartSheet: Identifiable {
    let id = UUID()
    let kind: String
    var reason = "used"
    var qty: Int64 = 1
    var taskId = ""
    var title = ""
}

struct PartDetailScreen: View {
    private let id: String
    @StateObject private var model: Observed<PartDetailStore, PartDetailState>
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var confirmingDelete = false
    @State private var sheet: PartSheet? = nil

    init(id: String) {
        self.id = id
        _model = StateObject(wrappedValue: Observed(PartDetailStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(state.view?.name ?? tr("nav_parts"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let view = state.view {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button {
                                sheet = PartSheet(kind: "edit")
                            } label: {
                                Label(tr("common_edit"), systemImage: "pencil")
                            }
                            Button {
                                model.store.toggleArchive()
                            } label: {
                                Label(
                                    tr(view.archived ? "part_restore" : "part_archive"),
                                    systemImage: view.archived ? "tray.and.arrow.up" : "archivebox"
                                )
                            }
                            .disabled(state.busy)
                            Button(role: .destructive) {
                                confirmingDelete = true
                            } label: {
                                Label(tr("common_delete"), systemImage: "trash")
                            }
                            .disabled(state.busy)
                        } label: {
                            Label(tr("part_actions"), systemImage: "ellipsis.circle")
                        }
                    }
                }
            }
            .sheet(item: $sheet) { request in
                sheetContent(request)
            }
            .confirmDelete(
                tr("part_delete_title"),
                message: state.view?.deleteText ?? "",
                isPresented: $confirmingDelete
            ) {
                model.store.delete()
            }
            .onChange(of: state.deleted) { _, deleted in
                if deleted { dismiss() }
            }
            .safeAreaInset(edge: .bottom) {
                if let notice = state.notice {
                    PartNoticeBar(
                        notice: notice,
                        onUndo: { _ in model.store.dismissNotice() },
                        onDismiss: { model.store.dismissNotice() }
                    )
                }
            }
    }

    @ViewBuilder
    private func sheetContent(_ request: PartSheet) -> some View {
        switch request.kind {
        case "stock":
            PartStockSheet(id: id, reason: request.reason, qty: request.qty)
        case "ordered":
            PartOrderedSheet(id: id)
        case "asset":
            PartAssetLinkSheet(partId: id)
        case "task":
            PartTaskLinkSheet(partId: id)
        case "taskQty":
            PartTaskQtySheet(partId: id, taskId: request.taskId, title: request.title, qty: request.qty)
        default:
            PartFormSheet(id: id, onSaved: nil)
        }
    }

    @ViewBuilder
    private func content(_ state: PartDetailState) -> some View {
        if let view = state.view {
            List {
                if state.actionError != nil {
                    Section {
                        ErrorBanner(error: state.actionError)
                    }
                }
                headerSection(view)
                stockSection(view, state)
                movementsSection(state)
                factsSection(view)
                assetsSection(view, state)
                tasksSection(view, state)
                CommentsSection(ownerType: "part", ownerId: id)
                AttachmentsSection(ownerType: "part", ownerId: id)
                DocumentLinksSection(ownerType: "part", ownerId: id)
            }
            .refreshable { model.store.refresh() }
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            LoadingView()
        }
    }

    private func headerSection(_ view: PartView) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Text(view.name)
                    .font(.title3.weight(.semibold))
                HStack(spacing: 6) {
                    Badge(text: view.stockLabel, color: Tone.color(view.stockTone))
                    if let ordered = view.orderedLabel {
                        Badge(text: ordered)
                    }
                    if view.archived {
                        Badge(text: tr("part_archived"))
                    }
                }
            }
        }
    }

    private func stockSection(_ view: PartView, _ state: PartDetailState) -> some View {
        Section(tr("part_stock_title")) {
            HStack(alignment: .bottom) {
                Text(String(view.stockCount))
                    .font(.system(size: 44, weight: .semibold))
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(tr("part_min_stock") + ": " + String(view.minStock))
                    Text(tr("part_reorder_qty") + ": " + String(view.reorderQty))
                    Text(tr("part_lead_time") + ": " + String(view.leadTimeDays))
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            HStack(spacing: 12) {
                Button {
                    model.store.quick(used: true)
                } label: {
                    Label(tr("part_quick_used"), systemImage: "minus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(state.busy || !view.canUseOne)
                Button {
                    model.store.quick(used: false)
                } label: {
                    Label(tr("part_quick_bought"), systemImage: "plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(state.busy)
            }
            Button(tr("part_stock_adjust")) {
                sheet = PartSheet(kind: "stock")
            }
            if view.onOrder {
                Text(view.onOrderText)
                    .font(.subheadline)
                HStack(spacing: 12) {
                    Button(tr("part_order_arrived")) {
                        sheet = PartSheet(kind: "stock", reason: "bought", qty: view.orderedQty)
                    }
                    .buttonStyle(.bordered)
                    .disabled(state.busy)
                    Button(tr("part_order_clear")) {
                        model.store.clearOrder()
                    }
                    .buttonStyle(.borderless)
                    .disabled(state.busy)
                }
            } else {
                Text(tr("part_not_ordered"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button {
                    sheet = PartSheet(kind: "ordered")
                } label: {
                    Label(tr("part_mark_ordered"), systemImage: "shippingbox")
                }
            }
        }
    }

    private func movementsSection(_ state: PartDetailState) -> some View {
        Section(tr("part_movements_title")) {
            if state.movements.isEmpty {
                Text(tr("part_movements_empty"))
                    .foregroundStyle(.secondary)
            }
            ForEach(state.movements, id: \.id) { movement in
                HStack(alignment: .top, spacing: 12) {
                    Text(movement.deltaText)
                        .font(.headline)
                        .foregroundStyle(movement.positive ? Color.green : Color.primary)
                        .frame(minWidth: 44, alignment: .trailing)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(movement.reasonLabel)
                            .font(.subheadline)
                        Text(movement.byText)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let note = movement.note {
                            Text(note)
                                .font(.footnote)
                        }
                    }
                }
            }
            if state.moreMovements {
                Button {
                    model.store.loadMore()
                } label: {
                    if state.loadingMore {
                        ProgressView()
                    } else {
                        Text(tr("common_load_more"))
                    }
                }
                .disabled(state.loadingMore)
            }
        }
    }

    private func factsSection(_ view: PartView) -> some View {
        Section(tr("part_facts_title")) {
            LabeledContent(tr("part_number"), value: view.partNumber ?? "–")
            LabeledContent(tr("part_supplier"), value: view.supplier ?? "–")
            LabeledContent(tr("part_unit_price"), value: view.priceText ?? "–")
            if let url = view.shopUrl {
                Button {
                    if let target = URL(string: url) { openURL(target) }
                } label: {
                    Label(tr("order_now_shop"), systemImage: "arrow.up.right.square")
                }
            }
            ValueRow(label: tr("part_notes"), value: view.notes)
        }
    }

    private func assetsSection(_ view: PartView, _ state: PartDetailState) -> some View {
        Section {
            if view.assets.isEmpty {
                Text(tr("part_assets_empty_title"))
                    .foregroundStyle(.secondary)
            }
            ForEach(view.assets, id: \.id) { asset in
                NavigationLink(value: Route.asset(asset.id)) {
                    Text(asset.name)
                        .lineLimit(1)
                }
                .swipeActions(edge: .trailing) {
                    Button {
                        model.store.unlinkAsset(assetId: asset.id)
                    } label: {
                        Label(tr("part_unlink_aria", ["name": asset.name]), systemImage: "link")
                    }
                    .tint(.red)
                    .disabled(state.busy)
                }
            }
            Button {
                sheet = PartSheet(kind: "asset")
            } label: {
                Label(tr("part_link_add"), systemImage: "plus")
            }
        } header: {
            Text(tr("part_assets_title"))
        }
    }

    private func tasksSection(_ view: PartView, _ state: PartDetailState) -> some View {
        Section {
            if view.tasks.isEmpty {
                Text(tr("part_tasks_empty_title"))
                    .foregroundStyle(.secondary)
            }
            ForEach(view.tasks, id: \.id) { task in
                NavigationLink(value: Route.task(task.id)) {
                    HStack {
                        Text(task.title)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Text(task.qtyText)
                            .foregroundStyle(.secondary)
                    }
                }
                .swipeActions(edge: .trailing) {
                    Button {
                        model.store.unlinkTask(taskId: task.id)
                    } label: {
                        Label(tr("part_unlink_aria", ["name": task.title]), systemImage: "link")
                    }
                    .tint(.red)
                    .disabled(state.busy)
                }
                .swipeActions(edge: .leading) {
                    Button {
                        sheet = PartSheet(kind: "taskQty", qty: task.qty, taskId: task.id, title: task.title)
                    } label: {
                        Label(tr("task_part_edit_title"), systemImage: "pencil")
                    }
                    .tint(.blue)
                }
            }
            Button {
                sheet = PartSheet(kind: "task")
            } label: {
                Label(tr("part_link_add"), systemImage: "plus")
            }
        } header: {
            Text(tr("part_tasks_title"))
        }
    }
}
