import shared
import SwiftUI

struct DashboardScreen: View {
    @StateObject private var model = Observed(DashboardStore(app: AppEnv.app))
    @State private var action: TaskActionRequest? = nil
    @State private var appointmentId: String? = nil

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("dashboard_title"))
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    NavigationLink(value: Route.search) {
                        Label(tr("search_open"), systemImage: "magnifyingglass")
                    }
                    NavigationLink(value: Route.notifications) {
                        Label(
                            bellLabel(state.unreadNotifications),
                            systemImage: state.unreadNotifications > 0 ? "bell.badge" : "bell"
                        )
                    }
                }
            }
            .sheet(item: $action) { request in
                TaskActionSheet(taskId: request.taskId, mode: request.mode) { notice in
                    model.store.announce(notice: notice)
                }
            }
            .navigationDestination(item: $appointmentId) { appointment in
                destination(for: Route.appointment(appointment))
            }
            .safeAreaInset(edge: .bottom) {
                if let notice = state.notice {
                    NoticeBar(
                        notice: notice,
                        onUndo: { token in model.store.undo(token: token) },
                        onDismiss: { model.store.consumeNotice() }
                    )
                }
            }
    }

    private func complete(_ item: TaskItem) {
        if item.needsReading {
            action = TaskActionRequest(taskId: item.id, mode: TaskActionStoreKt.ACTION_COMPLETE)
        } else {
            model.store.complete(taskId: item.id)
        }
    }

    private func bellLabel(_ unread: Int64) -> String {
        unread > 0 ? tr("notifications_bell_unread", ["count": unread]) : tr("notifications_bell")
    }

    @ViewBuilder
    private func content(_ state: DashboardState) -> some View {
        if let view = state.view {
            List {
                SessionExpiryNotice()
                if let actionError = state.actionError {
                    Section {
                        ErrorBanner(error: actionError)
                    }
                }
                Section {
                    HStack(spacing: 8) {
                        ForEach(view.tiles, id: \.id) { tile in
                            CountTileView(tile: tile)
                        }
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                } header: {
                    Text(state.greeting)
                }
                if view.nothingToDo {
                    Section {
                        EmptyStateView(
                            title: tr("dashboard_empty_title"),
                            message: tr("dashboard_empty_body"),
                            systemImage: "checkmark.circle"
                        )
                    }
                }
                ForEach(view.sections, id: \.id) { section in
                    taskSection(section)
                }
                if let card = view.defects {
                    defectsSection(card)
                }
                if !view.warranties.isEmpty {
                    warrantiesSection(view.warranties)
                }
                if !view.orderNow.isEmpty {
                    orderSection(view.orderNow)
                }
                if let costs = view.costs {
                    costsSection(costs)
                }
                if !view.recent.isEmpty {
                    recentSection(view.recent)
                }
            }
            .refreshable { model.store.refresh() }
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            LoadingView()
        }
    }

    private func taskSection(_ section: TaskSection) -> some View {
        Section {
            ForEach(section.items, id: \.id) { item in
                NavigationLink(value: Route.task(item.id)) {
                    TaskItemRow(item: item, onOpenAppointment: { appointmentId = $0 })
                }
                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                    if item.actionable {
                        Button {
                            complete(item)
                        } label: {
                            Label(tr("task_complete"), systemImage: "checkmark")
                        }
                        .tint(.green)
                    }
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    if item.actionable {
                        Button {
                            action = TaskActionRequest(taskId: item.id, mode: TaskActionStoreKt.ACTION_SKIP)
                        } label: {
                            Label(tr("task_skip"), systemImage: "forward.end")
                        }
                        .tint(.gray)
                        Button {
                            action = TaskActionRequest(taskId: item.id, mode: TaskActionStoreKt.ACTION_SNOOZE)
                        } label: {
                            Label(tr("task_snooze"), systemImage: "moon.zzz")
                        }
                        .tint(.orange)
                    }
                }
            }
            if section.collapsible {
                Button(
                    section.expanded
                        ? tr("dashboard_show_less")
                        : tr("dashboard_show_all", ["count": section.total])
                ) {
                    model.store.toggleLater()
                }
            }
        } header: {
            Text(section.title + " (" + String(section.total) + ")")
                .foregroundStyle(Tone.color(section.tone == "normal" ? "muted" : section.tone))
        }
    }

    private func defectsSection(_ card: DefectsCard) -> some View {
        Section(tr("dashboard_open_defects") + " (" + String(card.total) + ")") {
            ForEach(card.items, id: \.id) { item in
                NavigationLink(value: Route.defect(item.id)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("#" + String(item.number) + " " + item.title)
                            .lineLimit(1)
                        Text(item.statusLabel + " · " + item.severityLabel)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Text(item.deadlineText)
                            .font(.footnote)
                            .foregroundStyle(Tone.color(item.deadlineTone))
                    }
                }
            }
            NavigationLink(value: Route.defects) {
                Text(card.moreLabel)
            }
        }
    }

    private func warrantiesSection(_ items: [WarrantyItem]) -> some View {
        Section(tr("dashboard_expiring_warranties") + " (" + String(items.count) + ")") {
            ForEach(items, id: \.id) { item in
                NavigationLink(value: Route.asset(item.assetId)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title)
                            .lineLimit(1)
                        Text(item.wording + (item.date.map { " · " + $0 } ?? ""))
                            .font(.footnote)
                            .foregroundStyle(Tone.color(item.tone))
                    }
                }
            }
            NavigationLink(value: Route.warranties) {
                Text(tr("dashboard_to_warranties"))
            }
        }
    }

    private func orderSection(_ items: [OrderItem]) -> some View {
        Section(tr("dashboard_order_now") + " (" + String(items.count) + ")") {
            ForEach(items, id: \.id) { item in
                NavigationLink(value: Route.part(item.partId)) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(item.quantity + " " + item.partName)
                                .lineLimit(1)
                            if let late = item.lateLabel {
                                Badge(text: late, color: .red)
                            }
                        }
                        Text(item.neededBy + " · " + item.taskTitle)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
            NavigationLink(value: Route.parts) {
                Text(tr("dashboard_to_parts"))
            }
        }
    }

    private func costsSection(_ card: CostsCard) -> some View {
        Section(tr("costs_title")) {
            NavigationLink(value: Route.costs) {
                VStack(alignment: .leading, spacing: 6) {
                    if let you = card.youLine {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(you)
                                .font(.headline)
                                .foregroundStyle(Tone.color(card.youTone))
                            Text(tr("dashboard_costs_balance_hint"))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    if card.balancesUnavailable {
                        Text(tr("balances_unavailable"))
                    }
                    if let square = card.squareText {
                        Text(square)
                    }
                    ForEach(card.payments, id: \.self) { payment in
                        Text(payment)
                            .font(.footnote)
                    }
                    if let more = card.morePayments {
                        Text(more)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    if let budget = card.budgetText {
                        Label(budget, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(card.budgetExceeded ? Color.red : Color.orange)
                    }
                }
            }
            LabeledContent(card.yearLabel, value: card.yearTotal)
            ForEach(card.books, id: \.id) { book in
                LabeledContent(book.name, value: book.total)
                    .font(.footnote)
            }
            if let more = card.moreBooks {
                Text(more)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func recentSection(_ items: [RecentItem]) -> some View {
        Section(tr("dashboard_recent_title")) {
            ForEach(items, id: \.id) { item in
                NavigationLink(value: Route.task(item.taskId)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title)
                            .lineLimit(1)
                        Text(item.detail)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
        }
    }
}

private struct CountTileView: View {
    let tile: CountTile

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(String(tile.value))
                .font(.title2.weight(.semibold))
                .foregroundStyle(Tone.color(tile.tone))
            Text(tile.label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

/// A task as the dashboard and the task lists show it.
struct TaskItemRow: View {
    let item: TaskItem
    let onOpenAppointment: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(item.title)
                .lineLimit(1)
            if !item.place.isEmpty {
                Text(item.place)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            HStack(spacing: 6) {
                if !item.whenText.isEmpty {
                    Text(item.whenText)
                        .font(.footnote)
                        .foregroundStyle(Tone.color(item.tone))
                }
                if let assignee = item.assignee, !assignee.isEmpty {
                    Text(assignee)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            if let chip = item.appointment {
                AppointmentBadgeView(chip: chip, onOpen: onOpenAppointment)
            }
        }
    }
}
