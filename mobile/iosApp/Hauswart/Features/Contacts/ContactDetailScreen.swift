import shared
import SwiftUI

struct ContactDetailScreen: View {
    private let id: String
    @StateObject private var model: Observed<ContactDetailStore, ContactDetailState>
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @ObservedObject private var phoneStatus = PhoneContactStatus.shared
    @State private var editing = false
    @State private var confirmingDelete = false

    init(id: String) {
        self.id = id
        _model = StateObject(wrappedValue: Observed(ContactDetailStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(state.contact?.name ?? tr("nav_contacts"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if state.contact != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button {
                                editing = true
                            } label: {
                                Label(tr("common_edit"), systemImage: "pencil")
                            }
                            Button(role: .destructive) {
                                confirmingDelete = true
                            } label: {
                                Label(tr("common_delete"), systemImage: "trash")
                            }
                        } label: {
                            Label(tr("contact_actions"), systemImage: "ellipsis.circle")
                        }
                    }
                }
            }
            .sheet(isPresented: $editing) {
                ContactEditScreen(id: id)
            }
            .confirmDelete(
                tr("contact_delete_title"),
                message: tr("contact_delete_description", ["name": state.contact?.name ?? ""]),
                isPresented: $confirmingDelete
            ) {
                model.store.delete()
            }
            .onChange(of: state.deleted) { _, deleted in
                if deleted { dismiss() }
            }
            .onAppear {
                phoneStatus.refresh()
                model.store.setPhoneAccess(value: phoneStatus.access)
            }
            .onChange(of: phoneStatus.access) { _, access in
                model.store.setPhoneAccess(value: access)
            }
    }

    @ViewBuilder
    private func content(_ state: ContactDetailState) -> some View {
        if let contact = state.contact {
            List {
                if state.actionError != nil {
                    Section {
                        ErrorBanner(error: state.actionError)
                    }
                }
                Section(tr("contact_details_title")) {
                    LabeledContent(tr("contact_kind"), value: ContactsStoresKt.contactKindLabel(kind: contact.kind))
                    ValueRow(label: tr("contact_company"), value: contact.company)
                    if contact.emergency {
                        Badge(text: tr("contact_emergency_badge"), color: .red)
                    }
                    if let phone = contact.phone, !phone.isEmpty {
                        linkRow(tr("contact_phone"), phone, "phone", "tel:" + phone.filter { !$0.isWhitespace })
                    }
                    if let email = contact.email, !email.isEmpty {
                        linkRow(tr("contact_email"), email, "envelope", "mailto:" + email)
                    }
                    if let url = contact.url, !url.isEmpty {
                        linkRow(tr("contact_url"), url, "globe", url)
                    }
                    ValueRow(label: tr("contact_address"), value: contact.address)
                }
                if state.canBeOnPhone {
                    Section {
                        ToggleEntry(
                            label: tr("m_contact_sync_toggle"),
                            isOn: Binding(
                                get: { model.state.onPhone },
                                set: { model.store.setOnPhone(value: $0) }
                            ),
                            hint: tr("m_contact_sync_toggle_hint")
                        )
                        if state.phoneAccessBlocked {
                            Text(tr("m_contact_sync_blocked"))
                                .font(.footnote)
                                .foregroundStyle(.red)
                            Button(tr("m_reminders_open_system")) {
                                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                            }
                        }
                    }
                }
                if let notes = contact.notes, !notes.isEmpty {
                    Section(tr("contact_notes")) {
                        Text(notes)
                    }
                }
                AppointmentsSection(contactId: id)
                Section(tr("contact_assets_title")) {
                    if contact.assets.isEmpty {
                        Text(tr("contact_assets_empty_title"))
                            .foregroundStyle(.secondary)
                    }
                    ForEach(contact.assets, id: \.linkId) { asset in
                        NavigationLink(value: Route.asset(asset.assetId)) {
                            LabeledContent(asset.assetName, value: tr("contact_role_" + asset.role))
                        }
                    }
                }
                AttachmentsSection(ownerType: "contact", ownerId: id)
                DocumentLinksSection(ownerType: "contact", ownerId: id)
            }
            .refreshable { model.store.refresh() }
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            LoadingView()
        }
    }

    private func linkRow(_ label: String, _ value: String, _ systemImage: String, _ target: String) -> some View {
        Button {
            if let url = URL(string: target) { openURL(url) }
        } label: {
            LabeledContent {
                Label(value, systemImage: systemImage)
                    .labelStyle(.titleAndIcon)
                    .lineLimit(1)
            } label: {
                Text(label)
                    .foregroundStyle(Color.primary)
            }
        }
    }
}
