import shared
import SwiftUI

struct ContactsScreen: View {
    @StateObject private var model = Observed(ContactsListStore(app: AppEnv.app))
    @State private var query = ""
    @State private var creating = false

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("nav_contacts"))
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: tr("contacts_search_placeholder"))
            .onChange(of: query) { _, value in
                model.store.search(query: value)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        creating = true
                    } label: {
                        Label(tr("contacts_create"), systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $creating) {
                ContactEditScreen(id: nil)
            }
    }

    @ViewBuilder
    private func content(_ state: ContactsListState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.total == 0 {
            ErrorView(error: error) { model.store.refresh() }
        } else if state.total == 0 {
            EmptyStateView(
                title: tr("contacts_empty_title"),
                message: tr("contacts_empty_body"),
                systemImage: "person.crop.rectangle.stack"
            )
        } else {
            List {
                Section {
                    Toggle(tr("contacts_emergency_only"), isOn: emergencyOnly)
                }
                if state.groups.isEmpty {
                    EmptyStateView(
                        title: tr("contacts_no_results_title"),
                        message: tr("contacts_no_results_body"),
                        systemImage: "magnifyingglass"
                    )
                }
                ForEach(state.groups, id: \.kind) { group in
                    Section(group.title) {
                        ForEach(group.contacts, id: \.id) { contact in
                            NavigationLink(value: Route.contact(contact.id)) {
                                ContactRow(contact: contact)
                            }
                        }
                    }
                }
            }
            .refreshable { model.store.refresh() }
        }
    }

    private var emergencyOnly: Binding<Bool> {
        Binding(
            get: { model.state.emergencyOnly },
            set: { model.store.setEmergencyOnly(value: $0) }
        )
    }
}

private struct ContactRow: View {
    let contact: Contact

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(contact.name)
                    .lineLimit(1)
                if contact.emergency {
                    Badge(text: tr("contact_emergency_badge"), color: .red)
                }
            }
            if let detail = contact.company ?? contact.phone {
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}
