import QuickLook
import shared
import SwiftUI

struct EmergencyScreen: View {
    @StateObject private var model = Observed(EmergencyStore(app: AppEnv.app))
    @Environment(\.openURL) private var openURL
    @State private var preview: URL? = nil
    @State private var notice: String? = nil

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("emergency_title"))
            .navigationBarTitleDisplayMode(.inline)
            .quickLookPreview($preview)
            .safeAreaInset(edge: .bottom) {
                if let text = notice {
                    KnowledgeNoticeBar(text: text) { notice = nil }
                } else if let error = state.exportError {
                    KnowledgeNoticeBar(text: error.message) { model.store.dismissExportError() }
                }
            }
            .onChange(of: state.sheet != nil) { _, ready in
                if ready { consumeSheet() }
            }
    }

    @ViewBuilder
    private func content(_ state: EmergencyState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.description_.isEmpty {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            List {
                Section {
                    Text(state.description_)
                        .foregroundStyle(.secondary)
                }
                if state.empty {
                    EmptyStateView(
                        title: tr("emergency_empty_title"),
                        message: tr("emergency_empty_body"),
                        systemImage: "cross.case"
                    )
                }
                if !state.contacts.isEmpty {
                    Section(tr("emergency_contacts")) {
                        ForEach(state.contacts, id: \.id) { contact in
                            contactRow(contact)
                        }
                    }
                }
                if !state.insurance.isEmpty {
                    Section(tr("emergency_insurance")) {
                        ForEach(state.insurance, id: \.id) { policy in
                            insuranceRow(policy)
                        }
                    }
                }
                if !state.assets.isEmpty {
                    Section(tr("emergency_assets")) {
                        ForEach(state.assets, id: \.id) { asset in
                            assetRow(asset)
                        }
                    }
                }
                if !state.pages.isEmpty {
                    Section(tr("emergency_pdf_pages")) {
                        ForEach(state.pages, id: \.slug) { page in
                            NavigationLink(value: Route.doc(page.slug)) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(page.title)
                                    Text(page.sectionLabel)
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
                sheetSection(state)
            }
            .refreshable { model.store.refresh() }
        }
    }

    private func contactRow(_ contact: EmergencyContactRow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            NavigationLink(value: Route.contact(contact.id)) {
                Text(contact.name)
                    .font(.headline)
            }
            if !contact.company.isEmpty {
                Text(contact.company)
                    .foregroundStyle(.secondary)
            }
            if !contact.notes.isEmpty {
                Text(contact.notes)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if !contact.phone.isEmpty {
                callButton(contact.phone, tr("contact_call_aria", ["name": contact.name]))
            }
            if !contact.email.isEmpty {
                Button {
                    open(ContactLinksKt.mailUri(email: contact.email))
                } label: {
                    Label(contact.email, systemImage: "envelope")
                        .lineLimit(1)
                }
                .buttonStyle(.bordered)
                .accessibilityLabel(tr("contact_mail_aria", ["name": contact.name]))
            }
        }
        .padding(.vertical, 4)
    }

    private func insuranceRow(_ policy: EmergencyInsuranceRow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            NavigationLink(value: Route.insurancePolicy(policy.id)) {
                Text(policy.title)
                    .font(.headline)
            }
            Text(policy.subtitle)
                .font(.footnote)
                .foregroundStyle(.secondary)
            if !policy.assistancePhone.isEmpty {
                Text(tr("emergency_insurance_assistance"))
                    .font(.caption)
                callButton(policy.assistancePhone, tr("insurance_call_aria", ["title": policy.title]))
            }
            if !policy.insurerPhone.isEmpty {
                Button {
                    open(ContactLinksKt.telUri(phone: policy.insurerPhone))
                } label: {
                    Label(policy.insurerPhone + " · " + tr("emergency_insurance_insurer"), systemImage: "phone")
                        .lineLimit(1)
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(.vertical, 4)
    }

    private func assetRow(_ asset: EmergencyAssetRow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            NavigationLink(value: Route.asset(asset.id)) {
                Text(asset.name)
                    .font(.headline)
            }
            if !asset.room.isEmpty {
                Text(asset.room)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if asset.hints.isEmpty {
                Text(tr("emergency_no_hints"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(asset.hints, id: \.id) { hint in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Badge(text: hint.kindLabel, color: hint.kind == "warning" ? .red : .secondary)
                        Text(hint.title)
                            .font(.subheadline.weight(.semibold))
                    }
                    if !hint.body.isEmpty {
                        Text(hint.body)
                            .font(.subheadline)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func sheetSection(_ state: EmergencyState) -> some View {
        Section(tr("emergency_sheet_title")) {
            Text(tr("emergency_sheet_description"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            ToggleEntry(
                label: tr("emergency_sheet_secrets"),
                isOn: Binding(
                    get: { model.state.includeSecrets },
                    set: { model.store.setIncludeSecrets(value: $0) }
                ),
                hint: tr("emergency_sheet_secrets_hint")
            )
            if state.includeSecrets {
                Text(tr("emergency_sheet_secrets_warning"))
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
            Button {
                model.store.exportSheet()
            } label: {
                Label(tr("emergency_sheet_download"), systemImage: "doc.richtext")
            }
            .disabled(state.exporting)
            if state.exporting {
                ProgressView()
            }
        }
    }

    private func callButton(_ phone: String, _ label: String) -> some View {
        Button {
            open(ContactLinksKt.telUri(phone: phone))
        } label: {
            Label(phone, systemImage: "phone.fill")
                .font(.title3.weight(.semibold))
                .lineLimit(1)
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.borderedProminent)
        .tint(.red)
        .accessibilityLabel(label)
    }

    private func open(_ address: String) {
        if let url = URL(string: address) {
            openURL(url)
        } else {
            notice = tr("m_cannot_open")
        }
    }

    private func consumeSheet() {
        guard let sheet = model.state.sheet else { return }
        model.store.clearSheet()
        if let url = CacheFiles.write(sheet.file) {
            preview = url
        } else {
            notice = tr("m_cannot_open")
        }
    }
}
