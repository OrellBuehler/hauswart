import shared
import SwiftUI

/// The tab with every task: filters, search, grouped rows with swipe actions.
struct TasksScreen: View {
    @StateObject private var model = Observed(TasksListStore(app: AppEnv.app))
    @State private var query = ""
    @State private var creating = false
    @State private var filtersOpen = false
    @State private var action: TaskActionRequest? = nil
    @State private var appointmentId: String? = nil

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("nav_tasks"))
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: tr("tasks_search_placeholder"))
            .onChange(of: query) { _, value in
                model.store.search(query: value)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        filtersOpen.toggle()
                    } label: {
                        Label(tr("tasks_filters"), systemImage: "line.3.horizontal.decrease.circle")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        creating = true
                    } label: {
                        Label(tr("task_new"), systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $creating) {
                NavigationStack {
                    TaskEditScreen(id: nil, assetId: nil)
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

    @ViewBuilder
    private func content(_ state: TasksListState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.total == 0 {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            List {
                if let actionError = state.actionError {
                    Section {
                        ErrorBanner(error: actionError)
                    }
                }
                Section {
                    Picker(tr("tasks_assignee_label"), selection: mine) {
                        Text(tr("tasks_assignee_all")).tag(false)
                        Text(tr("tasks_assignee_me")).tag(true)
                    }
                    .pickerStyle(.segmented)
                    if filtersOpen {
                        filters(state)
                    }
                    if state.filtered {
                        Button(tr("tasks_filter_reset")) {
                            query = ""
                            model.store.resetFilters()
                        }
                    }
                    Text(tr("tasks_count", ["count": state.shown]))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if state.shown == 0 {
                    if state.filtered {
                        EmptyStateView(
                            title: tr("tasks_empty_filtered_title"),
                            message: tr("tasks_empty_filtered_body"),
                            systemImage: "magnifyingglass"
                        )
                    } else {
                        EmptyStateView(
                            title: tr("tasks_empty_title"),
                            message: tr("tasks_empty_body"),
                            systemImage: "checklist"
                        )
                    }
                }
                ForEach(state.groups, id: \.key) { group in
                    Section(group.title.isEmpty ? "" : group.title + " (" + String(group.rows.count) + ")") {
                        ForEach(group.rows, id: \.id) { row in
                            NavigationLink(value: Route.task(row.id)) {
                                TaskRowView(row: row, onOpenAppointment: { appointmentId = $0 })
                            }
                            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                if !row.archived {
                                    Button {
                                        complete(row)
                                    } label: {
                                        Label(tr("task_complete"), systemImage: "checkmark")
                                    }
                                    .tint(.green)
                                }
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                if !row.archived {
                                    Button {
                                        action = TaskActionRequest(taskId: row.id, mode: TaskActionStoreKt.ACTION_SKIP)
                                    } label: {
                                        Label(tr("task_skip"), systemImage: "forward.end")
                                    }
                                    .tint(.gray)
                                    if row.snoozed {
                                        Button {
                                            model.store.unsnooze(taskId: row.id)
                                        } label: {
                                            Label(tr("task_unsnooze"), systemImage: "alarm")
                                        }
                                        .tint(.orange)
                                    } else {
                                        Button {
                                            action = TaskActionRequest(taskId: row.id, mode: TaskActionStoreKt.ACTION_SNOOZE)
                                        } label: {
                                            Label(tr("task_snooze"), systemImage: "moon.zzz")
                                        }
                                        .tint(.orange)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .refreshable { model.store.refresh() }
        }
    }

    @ViewBuilder
    private func filters(_ state: TasksListState) -> some View {
        ChoiceEntry(
            label: tr("tasks_filter_status"),
            selection: Binding(get: { model.state.status }, set: { model.store.setStatus(value: $0) }),
            options: taskChoices(TasksListStoreKt.taskStatusOptions())
        )
        ChoiceEntry(
            label: tr("tasks_filter_category"),
            selection: Binding(get: { model.state.category }, set: { model.store.setCategory(value: $0) }),
            options: taskChoices(TasksListStoreKt.taskCategoryFilterOptions())
        )
        ChoiceEntry(
            label: tr("tasks_filter_room"),
            selection: Binding(get: { model.state.roomId }, set: { model.store.setRoom(value: $0) }),
            options: taskChoices(state.rooms)
        )
        ChoiceEntry(
            label: tr("tasks_filter_asset"),
            selection: Binding(get: { model.state.assetId }, set: { model.store.setAsset(value: $0) }),
            options: taskChoices(state.assets)
        )
        ChoiceEntry(
            label: tr("tasks_view_label"),
            selection: Binding(get: { model.state.view }, set: { model.store.setView(value: $0) }),
            options: taskChoices(TasksListStoreKt.taskViewOptions())
        )
        ToggleEntry(label: tr("tasks_filter_archived"), isOn: archived)
    }

    private var mine: Binding<Bool> {
        Binding(
            get: { model.state.mine },
            set: { model.store.setMine(value: $0) }
        )
    }

    private var archived: Binding<Bool> {
        Binding(
            get: { model.state.archived },
            set: { model.store.setArchived(value: $0) }
        )
    }

    private func complete(_ row: TaskRow) {
        if row.needsReading {
            action = TaskActionRequest(taskId: row.id, mode: TaskActionStoreKt.ACTION_COMPLETE)
        } else {
            model.store.complete(taskId: row.id)
        }
    }
}
