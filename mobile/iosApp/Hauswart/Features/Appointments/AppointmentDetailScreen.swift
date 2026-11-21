import shared
import SwiftUI

struct AppointmentDetailScreen: View {
    private let id: String
    @StateObject private var model: Observed<AppointmentDetailStore, AppointmentDetailState>
    @Environment(\.dismiss) private var dismiss
    @State private var editing = false
    @State private var confirmingDelete = false

    init(id: String) {
        self.id = id
        _model = StateObject(wrappedValue: Observed(AppointmentDetailStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(state.detail?.title ?? tr("nav_appointments"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if state.detail != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button {
                                editing = true
                            } label: {
                                Label(tr("common_edit"), systemImage: "pencil")
                            }
                            if state.detail?.planned == true {
                                Button {
                                    model.store.cancel()
                                } label: {
                                    Label(tr("appointment_cancel"), systemImage: "calendar.badge.minus")
                                }
                            }
                            Button(role: .destructive) {
                                confirmingDelete = true
                            } label: {
                                Label(tr("common_delete"), systemImage: "trash")
                            }
                        } label: {
                            Label(tr("appointment_actions"), systemImage: "ellipsis.circle")
                        }
                    }
                }
            }
            .sheet(isPresented: $editing) {
                AppointmentEditScreen(id: id, taskId: "", assetId: "", contactId: "", occurrenceKey: "")
            }
            .confirmDelete(
                tr("appointment_delete_title"),
                message: tr("appointment_delete_description", ["title": state.detail?.title ?? ""]),
                isPresented: $confirmingDelete
            ) {
                model.store.delete()
            }
            .onChange(of: state.deleted) { _, deleted in
                if deleted { dismiss() }
            }
            .onChange(of: state.notice) { _, text in
                if !text.isEmpty {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
                        model.store.dismissNotice()
                    }
                }
            }
    }

    @ViewBuilder
    private func content(_ state: AppointmentDetailState) -> some View {
        if let detail = state.detail {
            List {
                if !state.notice.isEmpty {
                    Section {
                        HStack {
                            Text(state.notice)
                            Spacer(minLength: 0)
                            Button {
                                model.store.dismissNotice()
                            } label: {
                                Image(systemName: "xmark")
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                }
                if state.actionError != nil {
                    Section {
                        ErrorBanner(error: state.actionError)
                    }
                }
                Section {
                    header(detail)
                }
                Section {
                    actions(detail, state)
                }
                if let completion = state.completion {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(completion.title)
                                .font(.headline)
                            Text(completion.hint)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        NavigationLink(value: Route.task(completion.taskId)) {
                            Text(tr("appointment_result_open_task"))
                        }
                    }
                }
                Section(tr("appointment_details")) {
                    ValueRow(label: tr("appointment_location_label"), value: detail.location)
                    ValueRow(label: tr("appointment_notes_label"), value: detail.notes)
                }
                Section(tr("appointment_links")) {
                    if detail.links.isEmpty {
                        Text(tr("appointment_links_none"))
                            .foregroundStyle(.secondary)
                    }
                    ForEach(detail.links, id: \.id) { link in
                        NavigationLink(value: route(for: link)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(link.name)
                                Text(link.caption)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    Text(detail.updatedText.isEmpty ? detail.createdText : detail.createdText + "\n" + detail.updatedText)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                AttachmentsSection(ownerType: "appointment", ownerId: id)
                CommentsSection(ownerType: "appointment", ownerId: id)
            }
            .refreshable { model.store.refresh() }
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            LoadingView()
        }
    }

    private func header(_ detail: ApptDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Badge(text: detail.statusLabel, color: Tone.color(detail.statusTone))
            Text(detail.title)
                .font(.title3.weight(.semibold))
            Text(detail.whenText + " · " + detail.relativeText)
                .font(.subheadline)
            if !detail.location.isEmpty {
                Label(detail.location, systemImage: "mappin.and.ellipse")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func actions(_ detail: ApptDetail, _ state: AppointmentDetailState) -> some View {
        let busy = !state.busy.isEmpty
        if detail.planned {
            VStack(alignment: .leading, spacing: 8) {
                Button {
                    model.store.complete()
                } label: {
                    Text(state.busy == "complete" ? tr("common_saving") : tr("appointment_complete"))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy)
                if !detail.completeHint.isEmpty {
                    Text(detail.completeHint)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        } else {
            Button {
                model.store.reopen()
            } label: {
                Label(tr("appointment_reopen"), systemImage: "arrow.uturn.backward")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(busy)
        }
    }

    private func route(for link: ApptLinkRef) -> Route {
        switch link.kind {
        case "task": return Route.task(link.id)
        case "asset": return Route.asset(link.id)
        default: return Route.contact(link.id)
        }
    }
}
