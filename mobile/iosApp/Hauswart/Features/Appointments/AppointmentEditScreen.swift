import shared
import SwiftUI

/// Creates an appointment (`id` empty; the other ids prefill it) or edits one. Presented as a
/// sheet. Times are wall-clock times in the household's time zone.
struct AppointmentEditScreen: View {
    @StateObject private var model: Observed<AppointmentEditStore, AppointmentEditState>
    @Environment(\.dismiss) private var dismiss

    @State private var loaded = false
    @State private var title = ""
    @State private var allDay = false
    @State private var startDate = ""
    @State private var startTime = ""
    @State private var endDate = ""
    @State private var endTime = ""
    @State private var location = ""
    @State private var notes = ""
    @State private var task = ""
    @State private var asset = ""
    @State private var contact = ""
    @State private var occurrence = ""
    @State private var showEndDate = false

    init(id: String, taskId: String, assetId: String, contactId: String, occurrenceKey: String) {
        _model = StateObject(
            wrappedValue: Observed(
                AppointmentEditStore(
                    app: AppEnv.app,
                    id: id,
                    taskId: taskId,
                    assetId: assetId,
                    contactId: contactId,
                    occurrenceKey: occurrenceKey
                )
            )
        )
    }

    var body: some View {
        let state = model.state
        NavigationStack {
            content(state)
                .navigationTitle(state.isNew ? tr("appointment_create_title") : tr("appointment_edit_title"))
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
    private func content(_ state: AppointmentEditState) -> some View {
        if let error = state.loadError {
            ErrorView(error: error) { model.store.retry() }
        } else if !loaded {
            LoadingView()
        } else {
            let errors = state.fieldErrors
            Form {
                if state.error != nil {
                    Section {
                        ErrorBanner(error: state.error)
                    }
                }
                Section {
                    TextEntry(label: tr("appointment_title_label"), text: $title, error: errors["title"])
                    ToggleEntry(
                        label: tr("appointment_all_day_label"),
                        isOn: $allDay,
                        hint: tr("appointment_all_day_hint")
                    )
                    .onChange(of: allDay) { _, value in
                        showEndDate = !value && !endDate.isEmpty
                    }
                }
                Section {
                    timeFields(errors)
                    previewText
                }
                Section {
                    TextEntry(label: tr("appointment_location_label"), text: $location, error: errors["location"])
                }
                Section {
                    ApptChoiceEntry(
                        label: tr("appointment_task_label"),
                        noneLabel: tr("appointment_task_none"),
                        options: state.tasks,
                        selection: $task,
                        error: errors["taskId"]
                    ) { picked in
                        apply(model.store.taskChosen(form: form, taskId: picked))
                    }
                    ApptChoiceEntry(
                        label: tr("appointment_asset_label"),
                        noneLabel: tr("appointment_asset_none"),
                        options: state.assets,
                        selection: $asset,
                        error: errors["assetId"]
                    )
                    ApptChoiceEntry(
                        label: tr("appointment_contact_label"),
                        noneLabel: tr("m_appt_contact_none"),
                        options: state.contacts,
                        selection: $contact,
                        error: errors["contactId"]
                    )
                    if state.choicesError != nil {
                        HStack {
                            Text(tr("m_appt_choices_failed"))
                                .font(.footnote)
                                .foregroundStyle(.red)
                            Spacer(minLength: 0)
                            Button(tr("common_retry")) { model.store.retry() }
                                .buttonStyle(.borderless)
                        }
                    }
                }
                Section {
                    TextEntry(
                        label: tr("appointment_notes_label"),
                        text: $notes,
                        error: errors["notes"],
                        multiline: true
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func timeFields(_ errors: [String: String]) -> some View {
        if allDay {
            DateEntry(
                label: tr("appointment_from_label"),
                value: $startDate,
                error: errors["startDate"],
                clearable: false
            )
            DateEntry(label: tr("appointment_to_label"), value: $endDate, error: errors["endDate"])
            Text(tr("appointment_to_hint"))
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else {
            DateEntry(
                label: tr("appointment_date_label"),
                value: $startDate,
                error: errors["startDate"],
                clearable: false
            )
            TimeEntry(label: tr("appointment_start_time_label"), value: $startTime, error: errors["startTime"])
            TimeEntry(
                label: tr("appointment_end_time_label"),
                value: $endTime,
                error: errors["endTime"],
                clearable: true
            )
            if showEndDate {
                DateEntry(
                    label: tr("appointment_end_date_label"),
                    value: $endDate,
                    error: errors["endDate"],
                    clearable: false
                )
            }
            Text(tr("appointment_end_time_hint"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button(showEndDate ? tr("appointment_end_same_day") : tr("appointment_end_other_day")) {
                if showEndDate { endDate = "" }
                showEndDate.toggle()
            }
            .buttonStyle(.borderless)
        }
    }

    private var previewText: some View {
        let preview = model.store.preview(form: form)
        return Text(tr("appointment_preview_title") + ": " + (preview.text.isEmpty ? preview.hint : preview.text))
            .font(.footnote)
            .foregroundStyle(preview.text.isEmpty && !preview.hint.isEmpty ? Color.red : Color.secondary)
    }

    private var form: AppointmentForm {
        AppointmentForm(
            title: title,
            allDay: allDay,
            startDate: startDate,
            startTime: startTime,
            endDate: endDate,
            endTime: endTime,
            location: location,
            notes: notes,
            taskId: task,
            assetId: asset,
            contactId: contact,
            occurrenceKey: occurrence
        )
    }

    private func apply(_ form: AppointmentForm) {
        title = form.title
        allDay = form.allDay
        startDate = form.startDate
        startTime = form.startTime
        endDate = form.endDate
        endTime = form.endTime
        location = form.location
        notes = form.notes
        task = form.taskId
        asset = form.assetId
        contact = form.contactId
        occurrence = form.occurrenceKey
    }

    private func fill(_ initial: AppointmentForm?) {
        guard !loaded, let initial else { return }
        apply(initial)
        showEndDate = !initial.allDay && !initial.endDate.isEmpty
        loaded = true
    }
}
