import shared
import SwiftUI

struct InsuranceDetailScreen: View {
    private let id: String
    @StateObject private var model: Observed<InsuranceDetailStore, InsuranceDetailState>
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var editing = false
    @State private var confirmingDelete = false

    init(id: String) {
        self.id = id
        _model = StateObject(wrappedValue: Observed(InsuranceDetailStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(state.title.isEmpty ? tr("nav_insurance") : state.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if state.loaded {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button {
                                editing = true
                            } label: {
                                Label(tr("common_edit"), systemImage: "pencil")
                            }
                            Button {
                                model.store.toggleArchive()
                            } label: {
                                Label(tr(state.archived ? "insurance_restore" : "insurance_archive"), systemImage: "archivebox")
                            }
                            Button(role: .destructive) {
                                confirmingDelete = true
                            } label: {
                                Label(tr("common_delete"), systemImage: "trash")
                            }
                        } label: {
                            Label(tr("insurance_actions"), systemImage: "ellipsis.circle")
                        }
                    }
                }
            }
            .sheet(isPresented: $editing) {
                InsuranceEditScreen(id: id, assetId: "", type: "") { _ in }
            }
            .confirmDelete(
                tr("insurance_delete_title"),
                message: tr("insurance_delete_description", ["title": state.title]),
                isPresented: $confirmingDelete
            ) {
                model.store.delete()
            }
            .safeAreaInset(edge: .bottom) {
                if let text = state.notice {
                    KnowledgeNoticeBar(text: text) { model.store.dismissNotice() }
                } else if let error = state.actionError {
                    KnowledgeNoticeBar(text: error.message) { model.store.dismissActionError() }
                }
            }
            .onChange(of: state.deleted) { _, deleted in
                if deleted { dismiss() }
            }
    }

    @ViewBuilder
    private func content(_ state: InsuranceDetailState) -> some View {
        if state.loaded {
            List {
                headerSection(state)
                if !state.endedText.isEmpty {
                    Section(tr("insurance_term_ended_title")) {
                        Text(state.endedText)
                        Button(tr("insurance_term_ended_action")) { editing = true }
                    }
                }
                if !state.assistancePhone.isEmpty {
                    Section(tr("insurance_assistance")) {
                        Button {
                            if let url = URL(string: ContactLinksKt.telUri(phone: state.assistancePhone)) { openURL(url) }
                        } label: {
                            Label(state.assistancePhone, systemImage: "phone.fill")
                                .font(.title3.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.borderedProminent)
                        .accessibilityLabel(tr("insurance_call_aria", ["title": state.title]))
                    }
                }
                Section(tr("insurance_facts")) {
                    if !state.insurerContactId.isEmpty {
                        NavigationLink(value: Route.contact(state.insurerContactId)) {
                            LabeledContent(tr("insurance_insurer"), value: state.insurerName)
                        }
                    } else {
                        LabeledContent(tr("insurance_insurer"), value: "–")
                    }
                    ForEach(state.facts, id: \.label) { fact in
                        LabeledContent(fact.label, value: fact.value.isEmpty ? "–" : fact.value)
                    }
                }
                Section(tr("insurance_assets")) {
                    if state.assets.isEmpty {
                        Text(tr("insurance_assets_none"))
                            .foregroundStyle(.secondary)
                    }
                    ForEach(state.assets, id: \.id) { asset in
                        NavigationLink(value: Route.asset(asset.id)) {
                            Text(asset.name)
                        }
                    }
                }
                Section(tr("insurance_deadline_title")) {
                    if state.cancelBy.isEmpty {
                        Text(tr("insurance_deadline_none_detail"))
                            .foregroundStyle(.secondary)
                    } else {
                        LabeledContent(tr("insurance_cancel_by"), value: state.cancelBy)
                    }
                    if state.reminderTaskId.isEmpty {
                        Text(tr("insurance_reminder_none"))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        NavigationLink(value: Route.task(state.reminderTaskId)) {
                            Text(tr("insurance_reminder_open"))
                        }
                    }
                }
                if !state.notes.isEmpty {
                    Section(tr("insurance_notes")) {
                        Text(state.notes)
                    }
                }
                AttachmentsSection(ownerType: "insurance_policy", ownerId: id)
                DocumentLinksSection(ownerType: "insurance_policy", ownerId: id)
                CommentsSection(ownerType: "insurance_policy", ownerId: id)
            }
            .refreshable { model.store.refresh() }
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            LoadingView()
        }
    }

    private func headerSection(_ state: InsuranceDetailState) -> some View {
        Section {
            Text(state.typeLabel)
                .foregroundStyle(.secondary)
            if state.archived {
                Badge(text: tr("insurance_archived"))
            }
            if let deadline = state.deadline {
                Text(deadline.text)
                    .foregroundStyle(Tone.color(deadline.tone))
            }
        }
    }
}
