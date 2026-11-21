import shared
import SwiftUI

/// The sheet that completes, skips or snoozes one task. `onDone` gets what to tell the person once it went through.
struct TaskActionSheet: View {
    private let mode: String
    private let onDone: (TaskNotice) -> Void
    @StateObject private var model: Observed<TaskActionStore, TaskActionState>
    @Environment(\.dismiss) private var dismiss
    @State private var form: TaskActionForm? = nil

    init(taskId: String, mode: String, onDone: @escaping (TaskNotice) -> Void) {
        self.mode = mode
        self.onDone = onDone
        _model = StateObject(wrappedValue: Observed(TaskActionStore(app: AppEnv.app, taskId: taskId, mode: mode)))
    }

    var body: some View {
        let state = model.state
        NavigationStack {
            content(state)
                .navigationTitle(state.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(tr("common_cancel")) { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(state.saving ? tr("task_completing") : state.submitLabel) {
                            if let form {
                                model.store.save(form: form)
                            }
                        }
                        .disabled(state.saving || form == nil)
                    }
                }
        }
        .onAppear { fill(state.initial) }
        .onChange(of: state.initial) { _, initial in
            fill(initial)
        }
        .onChange(of: state.notice) { _, notice in
            if let notice {
                onDone(notice)
                dismiss()
            }
        }
    }

    @ViewBuilder
    private func content(_ state: TaskActionState) -> some View {
        if let error = state.loadError {
            ErrorView(error: error) { model.store.retry() }
        } else if form == nil {
            LoadingView()
        } else {
            Form {
                Section {
                    Text(state.description_)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if mode == TaskActionStoreKt.ACTION_SNOOZE {
                    snoozeFields(state)
                } else {
                    completeFields(state)
                }
                if let error = state.error {
                    Section {
                        ErrorBanner(error: error)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func snoozeFields(_ state: TaskActionState) -> some View {
        Section(tr("task_snooze_quick")) {
            ForEach(state.presets, id: \.date) { preset in
                Button {
                    set("date", preset.date)
                } label: {
                    HStack {
                        Text(preset.label)
                        Spacer()
                        if value("date") == preset.date {
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
        }
        Section {
            DateEntry(label: tr("task_snooze_until"), value: bind("date"), error: state.fieldErrors["date"], clearable: false)
        }
    }

    @ViewBuilder
    private func completeFields(_ state: TaskActionState) -> some View {
        if mode == TaskActionStoreKt.ACTION_COMPLETE {
            Section {
                DateEntry(label: tr("task_complete_date"), value: bind("date"), error: state.fieldErrors["date"], clearable: false)
                Text(tr("task_complete_date_hint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if let label = state.odometerLabel {
                    TextEntry(
                        label: label,
                        text: bind("odometer"),
                        error: state.fieldErrors["odometer"],
                        keyboard: .decimalPad,
                        capitalization: .never
                    )
                    Text(state.odometerHint)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
        Section {
            TextEntry(label: tr("task_note") + " (" + tr("common_optional") + ")", text: bind("note"), multiline: true)
        }
        if state.canLogWork {
            Section {
                ToggleEntry(
                    label: tr("task_service_log_toggle"),
                    isOn: Binding(
                        get: { value("logWork") == "true" },
                        set: { on in
                            if on { model.store.prepareServiceLog() }
                            set("logWork", on ? "true" : "false")
                        }
                    ),
                    hint: state.serviceLogHint
                )
            }
            if value("logWork") == "true" {
                serviceLogFields(state)
            }
        }
    }

    @ViewBuilder
    private func serviceLogFields(_ state: TaskActionState) -> some View {
        Section {
            ChoiceEntry(label: tr("service_kind"), selection: bind("logKind"), options: taskChoices(TaskFormatKt.serviceKindOptions()))
            TextEntry(label: tr("service_title"), text: bind("logTitle"), error: state.fieldErrors["logTitle"])
            TextEntry(label: tr("service_description") + " (" + tr("common_optional") + ")", text: bind("logDescription"), multiline: true)
            if state.logLoading {
                ProgressView()
            }
            if let error = state.logError {
                ErrorBanner(error: error)
            }
            if !state.contacts.isEmpty {
                ChoiceEntry(label: tr("service_contact"), selection: bind("logContactId"), options: taskChoices(state.contacts))
            }
            MoneyEntry(label: tr("service_cost", ["currency": state.currency]), text: bind("logCost"), currency: state.currency, error: state.fieldErrors["logCost"])
        }
        if !state.notes.isEmpty {
            Section(tr("asset_notes_picker_title")) {
                Text(tr("asset_notes_picker_hint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                ForEach(state.notes, id: \.value) { note in
                    Button {
                        if let current = form {
                            form = current.toggleNote(id: note.value)
                        }
                    } label: {
                        HStack(alignment: .top) {
                            Image(systemName: isNoteChosen(note.value) ? "checkmark.square" : "square")
                            Text(note.label)
                                .foregroundStyle(Color.primary)
                        }
                    }
                }
            }
        }
    }

    private func isNoteChosen(_ id: String) -> Bool {
        guard let form else { return false }
        return form.logNoteIds.contains(id)
    }

    private func value(_ field: String) -> String {
        form?.valueOf(field: field) ?? ""
    }

    private func set(_ field: String, _ text: String) {
        if let current = form {
            form = current.withField(field: field, text: text)
        }
    }

    private func bind(_ field: String) -> Binding<String> {
        Binding(
            get: { value(field) },
            set: { set(field, $0) }
        )
    }

    private func fill(_ initial: TaskActionForm?) {
        guard form == nil, let initial else { return }
        form = initial
    }
}
