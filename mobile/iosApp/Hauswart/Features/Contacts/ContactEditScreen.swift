import shared
import SwiftUI

/// Creates a contact (`id` nil) or edits one. Presented as a sheet.
struct ContactEditScreen: View {
    @StateObject private var model: Observed<ContactEditStore, ContactEditState>
    @Environment(\.dismiss) private var dismiss

    @State private var loaded = false
    @State private var kind = "other"
    @State private var name = ""
    @State private var company = ""
    @State private var phone = ""
    @State private var email = ""
    @State private var url = ""
    @State private var address = ""
    @State private var notes = ""
    @State private var emergency = false
    @State private var guestVisible = false

    init(id: String?) {
        _model = StateObject(wrappedValue: Observed(ContactEditStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        NavigationStack {
            content(state)
                .navigationTitle(state.isNew ? tr("contact_create_title") : tr("contact_edit_title"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(tr("common_cancel")) { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(state.saving ? tr("common_saving") : tr("common_save")) {
                            model.store.save(form: form)
                        }
                        .disabled(state.saving || !loaded)
                    }
                }
        }
        .onAppear { fill(state.initial) }
        .onChange(of: state.initial) { _, initial in
            fill(initial)
        }
        .onChange(of: state.savedId) { _, savedId in
            if savedId != nil { dismiss() }
        }
    }

    @ViewBuilder
    private func content(_ state: ContactEditState) -> some View {
        if let error = state.loadError {
            ErrorView(error: error) { model.store.retry() }
        } else if !loaded {
            LoadingView()
        } else {
            Form {
                if state.error != nil {
                    Section {
                        ErrorBanner(error: state.error)
                    }
                }
                Section {
                    TextEntry(label: tr("contact_name"), text: $name, error: state.fieldErrors["name"], capitalization: .words)
                    ChoiceEntry(label: tr("contact_kind"), selection: $kind, options: kinds)
                    TextEntry(label: tr("contact_company"), text: $company, error: state.fieldErrors["company"])
                }
                Section {
                    TextEntry(
                        label: tr("contact_phone"),
                        text: $phone,
                        error: state.fieldErrors["phone"],
                        keyboard: .phonePad
                    )
                    TextEntry(
                        label: tr("contact_email"),
                        text: $email,
                        error: state.fieldErrors["email"],
                        keyboard: .emailAddress,
                        capitalization: .never
                    )
                    TextEntry(
                        label: tr("contact_url"),
                        text: $url,
                        error: state.fieldErrors["url"],
                        keyboard: .URL,
                        capitalization: .never
                    )
                    TextEntry(
                        label: tr("contact_address"),
                        text: $address,
                        error: state.fieldErrors["address"],
                        multiline: true
                    )
                }
                Section {
                    TextEntry(label: tr("contact_notes"), text: $notes, error: state.fieldErrors["notes"], multiline: true)
                }
                Section {
                    ToggleEntry(label: tr("contact_emergency"), isOn: $emergency, hint: tr("contact_emergency_hint"))
                    ToggleEntry(
                        label: tr("contact_guest_visible"),
                        isOn: $guestVisible,
                        hint: tr("contact_guest_visible_hint")
                    )
                }
            }
        }
    }

    private var kinds: [Choice] {
        ContactsStoresKt.CONTACT_KINDS.map { Choice(value: $0, label: ContactsStoresKt.contactKindLabel(kind: $0)) }
    }

    private var form: ContactForm {
        ContactForm(
            kind: kind,
            name: name,
            company: company,
            phone: phone,
            email: email,
            url: url,
            address: address,
            notes: notes,
            emergency: emergency,
            guestVisible: guestVisible
        )
    }

    private func fill(_ initial: ContactForm?) {
        guard !loaded, let initial else { return }
        kind = initial.kind
        name = initial.name
        company = initial.company
        phone = initial.phone
        email = initial.email
        url = initial.url
        address = initial.address
        notes = initial.notes
        emergency = initial.emergency
        guestVisible = initial.guestVisible
        loaded = true
    }
}
