import shared
import SwiftUI

/// What the status sheet is for: moving the defect to `target`.
private struct DefectStatusRequest: Identifiable {
    let id = UUID()
    let target: String
}

struct DefectDetailScreen: View {
    private let id: String
    @StateObject private var model: Observed<DefectDetailStore, DefectDetailState>
    @Environment(\.dismiss) private var dismiss
    @State private var editing = false
    @State private var confirmingDelete = false
    @State private var correspondence = false
    @State private var statusRequest: DefectStatusRequest? = nil

    init(id: String) {
        self.id = id
        _model = StateObject(wrappedValue: Observed(DefectDetailStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(state.view?.numberLabel ?? tr("nav_defects"))
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
                            ForEach(view.actions.filter { !$0.primary }, id: \.status) { action in
                                Button {
                                    statusRequest = DefectStatusRequest(target: action.status)
                                } label: {
                                    Label(action.label, systemImage: "arrow.triangle.2.circlepath")
                                }
                            }
                            Button(role: .destructive) {
                                confirmingDelete = true
                            } label: {
                                Label(tr("common_delete"), systemImage: "trash")
                            }
                            .disabled(state.deleting)
                        } label: {
                            Label(tr("defect_more_actions"), systemImage: "ellipsis.circle")
                        }
                    }
                }
            }
            .sheet(isPresented: $editing) {
                DefectEditScreen(id: id, assetId: nil, roomId: nil, embedded: false, onSaved: nil)
            }
            .sheet(isPresented: $correspondence) {
                DefectCorrespondenceSheet(id: id)
            }
            .sheet(item: $statusRequest) { request in
                DefectStatusSheet(id: id, target: request.target)
            }
            .confirmDelete(
                tr("defect_delete_title"),
                message: state.view?.deleteText ?? "",
                isPresented: $confirmingDelete
            ) {
                model.store.delete()
            }
            .onChange(of: state.deleted) { _, deleted in
                if deleted { dismiss() }
            }
    }

    @ViewBuilder
    private func content(_ state: DefectDetailState) -> some View {
        if let view = state.view {
            List {
                if state.actionError != nil {
                    Section {
                        ErrorBanner(error: state.actionError)
                    }
                }
                headerSection(view)
                Section {
                    DefectStepperView(steps: view.steps)
                }
                factsSection(view)
                Section(tr("defect_description")) {
                    if view.body.isEmpty {
                        Text(tr("defect_description_empty"))
                            .foregroundStyle(.secondary)
                    } else {
                        Text(defectLinkedText(view.body))
                    }
                }
                if !view.resolution.isEmpty {
                    Section(tr("defect_resolution")) {
                        Text(defectLinkedText(view.resolution))
                    }
                }
                if let taskId = view.reminderTaskId {
                    Section(tr("defect_reminder")) {
                        Text(tr("defect_reminder_description"))
                            .font(.footnote)
                        NavigationLink(value: Route.task(taskId)) {
                            Text(tr("defect_reminder_open"))
                        }
                    }
                }
                Section(tr("defect_timeline")) {
                    ForEach(view.timeline, id: \.id) { event in
                        DefectEventView(event: event)
                    }
                    Button {
                        correspondence = true
                    } label: {
                        Label(tr("defect_correspondence_add"), systemImage: "envelope")
                    }
                }
                CommentsSection(ownerType: "defect", ownerId: id)
                AttachmentsSection(ownerType: "defect", ownerId: id)
                DocumentLinksSection(ownerType: "defect", ownerId: id)
            }
            .refreshable { model.store.refresh() }
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            LoadingView()
        }
    }

    private func headerSection(_ view: DefectView) -> some View {
        let primary = view.actions.filter(\.primary)
        return Section {
            VStack(alignment: .leading, spacing: 8) {
                Text(view.title)
                    .font(.title3.weight(.semibold))
                HStack(spacing: 6) {
                    Badge(text: view.statusLabel, color: Tone.color(view.statusTone))
                    Badge(text: view.severityLabel, color: Tone.color(view.severityTone))
                }
                Text(tr("defect_deadline") + ": " + view.deadline.text)
                    .font(.footnote)
                    .foregroundStyle(Tone.color(view.deadline.tone))
            }
            ForEach(primary, id: \.status) { action in
                actionButton(action, prominent: action.status == primary.first?.status && !view.closed)
            }
        }
    }

    @ViewBuilder
    private func actionButton(_ action: DefectAction, prominent: Bool) -> some View {
        if prominent {
            Button {
                statusRequest = DefectStatusRequest(target: action.status)
            } label: {
                Text(action.label)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        } else {
            Button {
                statusRequest = DefectStatusRequest(target: action.status)
            } label: {
                Text(action.label)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
    }

    private func factsSection(_ view: DefectView) -> some View {
        Section(tr("defect_facts")) {
            if let roomId = view.roomId, let roomName = view.roomName {
                NavigationLink(value: Route.room(roomId)) {
                    LabeledContent(tr("defect_room"), value: roomName)
                }
            }
            if let assetId = view.assetId, let assetName = view.assetName {
                NavigationLink(value: Route.asset(assetId)) {
                    LabeledContent(tr("defect_asset"), value: assetName)
                }
            }
            ForEach(view.facts, id: \.label) { fact in
                LabeledContent(fact.label) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(fact.value)
                            .multilineTextAlignment(.trailing)
                        if !fact.note.isEmpty {
                            Text(fact.note)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }
}
