import shared
import SwiftUI

/// What the part sheet is for: linking a new part, or changing the quantity of a linked one.
private struct PartRequest: Identifiable {
    let partId: String?
    let name: String
    let qty: String
    var id: String { (partId ?? "new") + "/" + qty }
}

struct TaskDetailScreen: View {
    private let id: String
    @StateObject private var model: Observed<TaskDetailStore, TaskDetailState>
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var editing = false
    @State private var confirmingDelete = false
    @State private var action: TaskActionRequest? = nil
    @State private var partRequest: PartRequest? = nil

    init(id: String) {
        self.id = id
        _model = StateObject(wrappedValue: Observed(TaskDetailStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(state.view?.title ?? tr("nav_tasks"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let view = state.view {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button {
                                editing = true
                            } label: {
                                Label(tr("common_edit"), systemImage: "pencil")
                            }
                            if !view.archived {
                                Button {
                                    action = TaskActionRequest(taskId: id, mode: TaskActionStoreKt.ACTION_COMPLETE)
                                } label: {
                                    Label(tr("task_complete_with_note"), systemImage: "square.and.pencil")
                                }
                                Button {
                                    action = TaskActionRequest(taskId: id, mode: TaskActionStoreKt.ACTION_SKIP)
                                } label: {
                                    Label(tr("task_skip"), systemImage: "forward.end")
                                }
                                if view.snoozed {
                                    Button {
                                        model.store.unsnooze()
                                    } label: {
                                        Label(tr("task_unsnooze"), systemImage: "alarm")
                                    }
                                } else {
                                    Button {
                                        action = TaskActionRequest(taskId: id, mode: TaskActionStoreKt.ACTION_SNOOZE)
                                    } label: {
                                        Label(tr("task_snooze"), systemImage: "moon.zzz")
                                    }
                                }
                            }
                            Button {
                                model.store.toggleArchive()
                            } label: {
                                Label(tr(view.archived ? "task_restore" : "task_archive"), systemImage: "archivebox")
                            }
                            Button(role: .destructive) {
                                confirmingDelete = true
                            } label: {
                                Label(tr("common_delete"), systemImage: "trash")
                            }
                        } label: {
                            Label(tr("task_more_actions"), systemImage: "ellipsis.circle")
                        }
                    }
                }
            }
            .sheet(isPresented: $editing) {
                NavigationStack {
                    TaskEditScreen(id: id, assetId: nil)
                }
            }
            .sheet(item: $action) { request in
                TaskActionSheet(taskId: request.taskId, mode: request.mode) { notice in
                    model.store.announce(notice: notice)
                }
            }
            .sheet(item: $partRequest) { request in
                TaskPartSheet(model: model, request: request.partId, name: request.name, qty: request.qty)
            }
            .confirmDelete(
                tr("task_delete_title"),
                message: tr("task_delete_description", ["title": state.view?.title ?? ""])
                    + ((state.view?.isBill ?? false) ? " " + tr("task_bill_delete_note") : ""),
                isPresented: $confirmingDelete
            ) {
                model.store.delete()
            }
            .onChange(of: state.deleted) { _, deleted in
                if deleted { dismiss() }
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
    private func content(_ state: TaskDetailState) -> some View {
        if let view = state.view {
            List {
                if let error = state.actionError {
                    Section {
                        ErrorBanner(error: error)
                    }
                }
                headerSection(view, state)
                Group {
                    scheduleSection(view)
                    AppointmentsSection(taskId: id)
                }
                Section(tr("task_description")) {
                    if view.description_.isEmpty {
                        Text(tr("task_description_empty"))
                            .foregroundStyle(.secondary)
                    } else {
                        Text(view.description_)
                    }
                }
                preparationsSection(view, state)
                Group {
                    partsSection(view, state)
                    DocumentLinksSection(ownerType: "task", ownerId: id)
                }
                Group {
                    historySection(view, state)
                    CommentsSection(ownerType: "task", ownerId: id)
                }
                Section(tr("task_assignment")) {
                    ForEach(view.assignmentLines, id: \.self) { line in
                        Text(line)
                    }
                    Text(view.notifyLine)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Section(tr("task_details")) {
                    if let assetId = view.assetId, !view.place.isEmpty {
                        NavigationLink(value: Route.asset(assetId)) {
                            LabeledContent(tr("task_location"), value: view.place)
                        }
                    } else if let roomId = view.roomId, !view.place.isEmpty {
                        NavigationLink(value: Route.room(roomId)) {
                            LabeledContent(tr("task_location"), value: view.place)
                        }
                    } else {
                        ValueRow(label: tr("task_location"), value: view.place)
                    }
                    if let url = view.billUrl {
                        Button {
                            if let target = URL(string: url) { openURL(target) }
                        } label: {
                            Label(tr("finance_open_in_app"), systemImage: "arrow.up.right.square")
                        }
                    }
                    ValueRow(label: tr("task_effort"), value: view.effort)
                    ValueRow(label: tr("task_created"), value: view.created)
                }
            }
            .refreshable { model.store.refresh() }
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            LoadingView()
        }
    }

    @ViewBuilder
    private func headerSection(_ view: TaskDetailView, _ state: TaskDetailState) -> some View {
        Section {
            HStack(spacing: 8) {
                Badge(text: view.statusLabel, color: Tone.color(view.tone))
                if !view.dueText.isEmpty {
                    Text(view.dueText)
                        .font(.subheadline)
                }
            }
            HStack(spacing: 6) {
                ForEach(view.chips, id: \.label) { chip in
                    Badge(text: chip.label, color: Tone.color(chip.tone))
                }
            }
            if let progress = view.progress {
                ProgressLine(progress: progress)
            }
            if let chip = view.appointment {
                NavigationLink(value: Route.appointment(chip.id)) {
                    Label(chip.label, systemImage: "calendar.badge.clock")
                        .font(.subheadline)
                }
            }
            if !view.archived {
                Button {
                    if view.needsReading {
                        action = TaskActionRequest(taskId: id, mode: TaskActionStoreKt.ACTION_COMPLETE)
                    } else {
                        model.store.complete()
                    }
                } label: {
                    Label(tr("task_complete"), systemImage: "checkmark")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(state.busy)
            }
        }
    }

    @ViewBuilder
    private func scheduleSection(_ view: TaskDetailView) -> some View {
        Section(tr("task_schedule")) {
            Text(view.triggerSummary)
                .font(.subheadline.weight(.semibold))
            if !view.dueValue.isEmpty {
                LabeledContent(tr("task_due"), value: view.dueValue)
                ValueRow(label: "", value: view.dueLimit)
            }
            LabeledContent(tr("task_grace_days"), value: view.graceText)
            ValueRow(label: tr("task_due_soon_days"), value: view.dueSoonText)
            ForEach(view.reasons, id: \.self) { reason in
                Text("• " + reason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func preparationsSection(_ view: TaskDetailView, _ state: TaskDetailState) -> some View {
        Section(tr("task_preparations")) {
            if view.preparations.isEmpty {
                Text(tr("task_preparations_empty"))
                    .foregroundStyle(.secondary)
            }
            ForEach(view.preparations, id: \.id) { prep in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(prep.title)
                        Text(preparationSubtitle(prep))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if prep.open {
                        Button {
                            model.store.completePreparation(prepId: prep.id)
                        } label: {
                            Image(systemName: "checkmark.circle")
                        }
                        .buttonStyle(.borderless)
                        .disabled(state.busy)
                        .accessibilityLabel(tr("dashboard_prep_done_aria", ["title": prep.title]))
                    }
                }
            }
        }
    }

    private func preparationSubtitle(_ prep: PreparationRow) -> String {
        var parts: [String] = [prep.kindLabel]
        if let lead = prep.leadText { parts.append(lead) }
        parts.append(prep.stateLabel)
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private func partsSection(_ view: TaskDetailView, _ state: TaskDetailState) -> some View {
        Section(tr("task_parts_title")) {
            Text(tr("task_parts_description"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            if view.parts.isEmpty {
                Text(tr("task_parts_empty_title"))
                    .foregroundStyle(.secondary)
            }
            ForEach(view.parts, id: \.partId) { part in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(part.name)
                        Text(part.stockLabel)
                            .font(.caption)
                            .foregroundStyle(Tone.color(part.stockTone))
                    }
                    Spacer()
                    Button(part.qtyLabel) {
                        partRequest = PartRequest(partId: part.partId, name: part.name, qty: String(part.qty))
                    }
                    .buttonStyle(.borderless)
                }
                .swipeActions {
                    Button(role: .destructive) {
                        model.store.unlinkPart(partId: part.partId)
                    } label: {
                        Label(tr("part_unlink_aria", ["name": part.name]), systemImage: "xmark")
                    }
                }
            }
            Button(tr("part_link_add")) {
                model.store.loadPartChoices()
                partRequest = PartRequest(partId: nil, name: "", qty: "1")
            }
        }
    }

    @ViewBuilder
    private func historySection(_ view: TaskDetailView, _ state: TaskDetailState) -> some View {
        Section(tr("task_history")) {
            Text(tr("task_history_description"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            if view.history.isEmpty {
                Text(tr("task_history_empty"))
                    .foregroundStyle(.secondary)
            }
            ForEach(view.history, id: \.id) { item in
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.skipped ? item.who + " · " + item.skippedLabel : item.who)
                        Text(item.whenText + " · " + item.sourceLabel)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let note = item.note {
                            Text(note)
                                .font(.footnote)
                        }
                    }
                    Spacer()
                    if item.canUndo {
                        Button {
                            model.store.undoCompletion(completionId: item.id)
                        } label: {
                            Image(systemName: "arrow.uturn.backward")
                        }
                        .buttonStyle(.borderless)
                        .disabled(state.busy)
                        .accessibilityLabel(tr("completion_undo_aria", ["who": item.who]))
                    }
                }
            }
            if state.moreHistory {
                Button(tr("common_load_more")) { model.store.loadMoreHistory() }
                    .disabled(state.loadingMore)
            }
        }
    }
}

/// Links a spare part to the task or changes how many pieces each completion uses.
private struct TaskPartSheet: View {
    @ObservedObject var model: Observed<TaskDetailStore, TaskDetailState>
    let request: String?
    let name: String
    @State var qty: String
    @State private var chosen = ""
    @Environment(\.dismiss) private var dismiss

    init(model: Observed<TaskDetailStore, TaskDetailState>, request: String?, name: String, qty: String) {
        self.model = model
        self.request = request
        self.name = name
        _qty = State(initialValue: qty)
    }

    var body: some View {
        let state = model.state
        NavigationStack {
            Form {
                Section {
                    Text(request == nil ? tr("task_part_link_description") : tr("task_part_edit_description", ["name": name]))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if request == nil {
                    Section(tr("part_link_list")) {
                        if state.partChoicesLoading {
                            ProgressView()
                        }
                        if let error = state.partChoicesError {
                            ErrorBanner(error: error)
                        }
                        if state.partChoices.isEmpty && !state.partChoicesLoading && state.partChoicesError == nil {
                            Text(tr("part_link_empty"))
                                .foregroundStyle(.secondary)
                        }
                        ForEach(state.partChoices, id: \.value) { choice in
                            Button {
                                chosen = choice.value
                            } label: {
                                HStack {
                                    Text(choice.label)
                                        .foregroundStyle(Color.primary)
                                    Spacer()
                                    if chosen == choice.value {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    }
                }
                Section {
                    TextEntry(
                        label: tr("task_part_qty"),
                        text: $qty,
                        error: state.partError,
                        keyboard: .numberPad,
                        capitalization: .never
                    )
                    Text(tr("task_part_qty_hint"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle(request == nil ? tr("task_part_link_title") : tr("task_part_edit_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(tr("common_cancel")) {
                        model.store.partDialogClosed()
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(request == nil ? tr("part_link_submit") : tr("common_save")) {
                        if let partId = request {
                            model.store.setPartQty(partId: partId, qty: qty)
                        } else {
                            model.store.linkPart(partId: chosen, qty: qty)
                        }
                    }
                    .disabled(state.partSaving)
                }
            }
        }
        .onChange(of: state.partSaved) { _, saved in
            if saved {
                model.store.partDialogClosed()
                dismiss()
            }
        }
    }
}
