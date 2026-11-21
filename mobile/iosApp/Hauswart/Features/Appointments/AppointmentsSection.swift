import shared
import SwiftUI

/// The planned appointments of a task, a device or a contact as a section of a `List`, with a button
/// that opens the form to schedule one for the owner.
///
///     AppointmentsSection(taskId: task.id)        // on a task screen
///     AppointmentsSection(assetId: asset.id)      // on a device screen
///     AppointmentsSection(contactId: contact.id)  // on a contact screen
///
/// Give exactly one of the three. It loads and refreshes itself (the `appointments` topic).
struct AppointmentsSection: View {
    private let taskId: String
    private let assetId: String
    private let contactId: String
    @StateObject private var model: Observed<AppointmentsSectionStore, AppointmentsSectionState>
    @State private var creating = false

    init(taskId: String = "", assetId: String = "", contactId: String = "") {
        self.taskId = taskId
        self.assetId = assetId
        self.contactId = contactId
        _model = StateObject(wrappedValue: Observed(AppointmentsSectionStore(app: AppEnv.app, taskId: taskId, assetId: assetId, contactId: contactId)))
    }

    var body: some View {
        let state = model.state
        Section {
            if state.loading {
                ProgressView()
                    .frame(maxWidth: .infinity)
            } else if let error = state.error, state.rows.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(error.message)
                        .foregroundStyle(.red)
                    Button(tr("common_retry")) { model.store.refresh() }
                        .buttonStyle(.borderless)
                }
            } else if state.rows.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text(tr("appointments_card_empty_title"))
                        .font(.subheadline.weight(.semibold))
                    Text(state.emptyBody)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            ForEach(state.rows, id: \.id) { row in
                NavigationLink(value: Route.appointment(row.id)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.title)
                            .lineLimit(2)
                        Text(row.whenText)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        if !row.location.isEmpty {
                            Text(row.location)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            Button {
                creating = true
            } label: {
                Label(tr("appointment_new"), systemImage: "plus")
            }
            .buttonStyle(.borderless)
            .sheet(isPresented: $creating) {
                AppointmentEditScreen(id: "", taskId: taskId, assetId: assetId, contactId: contactId, occurrenceKey: "")
            }
        } header: {
            Text(tr("appointments_card_title"))
        }
    }
}
