import shared
import SwiftUI

/// Creates a task (`id` nil, for `assetId` when given) or edits one. Presented in a sheet's navigation stack, or pushed.
struct TaskEditScreen: View {
    @StateObject private var model: Observed<TaskEditStore, TaskEditState>
    @Environment(\.dismiss) private var dismiss
    @State private var form: TaskForm? = nil

    init(id: String?, assetId: String?) {
        _model = StateObject(wrappedValue: Observed(TaskEditStore(app: AppEnv.app, id: id, assetId: assetId)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(state.isNew ? tr("task_new") : tr("common_edit"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(tr("common_cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(state.saving ? tr("common_saving") : tr("common_save")) {
                        if let form {
                            model.store.save(form: form)
                        }
                    }
                    .disabled(state.saving || form == nil)
                }
            }
            .onAppear { fill(state.initial) }
            .onChange(of: state.initial) { _, initial in
                fill(initial)
            }
            .onChange(of: form) { _, next in
                if let next {
                    model.store.preview(form: next)
                }
            }
            .onChange(of: state.savedId) { _, savedId in
                if savedId != nil { dismiss() }
            }
    }

    @ViewBuilder
    private func content(_ state: TaskEditState) -> some View {
        if let error = state.loadError {
            ErrorView(error: error) { model.store.retry() }
        } else if form == nil {
            LoadingView()
        } else {
            Form {
                if state.billManaged {
                    Section {
                        Text(tr("task_bill_managed"))
                            .font(.footnote)
                    }
                }
                basics(state)
                if state.triggerEditable {
                    Section {
                        Text(tr("task_form_schedule_description"))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } header: {
                        Text(tr("task_form_schedule"))
                    }
                    TriggerEditor(
                        form: triggerBinding,
                        today: state.today,
                        vehicle: state.vehicleOf(assetId: value("assetId")),
                        errors: { state.triggerError(field: $0) }
                    )
                    FieldError(text: state.fieldErrors["trigger"])
                    PreviewSection(preview: state.preview)
                } else {
                    Section(tr("task_form_schedule")) {
                        Text(tr("trigger_managed"))
                            .font(.footnote)
                        Text(state.triggerSummary)
                            .font(.subheadline.weight(.semibold))
                    }
                }
                assignment(state)
                notifications(state)
                preparations(state)
                if let error = state.error {
                    Section {
                        ErrorBanner(error: error)
                    }
                }
                if state.preparationsFailed {
                    Section {
                        FieldError(text: tr("task_form_preparations_failed"))
                    }
                }
            }
        }
    }

    // MARK: Sections

    @ViewBuilder
    private func basics(_ state: TaskEditState) -> some View {
        Section(tr("task_form_basics")) {
            TextEntry(label: tr("task_title_label"), text: bind("title"), error: state.fieldErrors["title"])
            TextEntry(
                label: tr("task_description") + " (" + tr("common_optional") + ")",
                text: bind("description"),
                error: state.fieldErrors["descriptionMd"],
                multiline: true
            )
            ChoiceEntry(label: tr("task_category"), selection: bind("category"), options: taskChoices(TaskFormatKt.categoryOptions()))
            TextEntry(
                label: tr("task_effort") + " (" + tr("common_optional") + ")",
                text: bind("effort"),
                error: state.fieldErrors["effortMinutes"],
                keyboard: .numberPad,
                capitalization: .never
            )
            Text(tr("task_effort_hint"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            ChoiceEntry(label: tr("task_priority"), selection: bind("priority"), options: taskChoices(TaskFormatKt.priorityOptions()))
            ChoiceEntry(label: tr("task_asset"), selection: bind("assetId"), options: assetChoices(state))
            ChoiceEntry(label: tr("task_room"), selection: bind("roomId"), options: taskChoices(state.rooms))
            FieldError(text: state.fieldErrors["roomId"])
        }
    }

    private func assetChoices(_ state: TaskEditState) -> [Choice] {
        var options = [Choice(value: "", label: tr("task_no_asset"))]
        for asset in state.assets {
            options.append(Choice(value: asset.id, label: asset.label))
        }
        return options
    }

    @ViewBuilder
    private func assignment(_ state: TaskEditState) -> some View {
        Section(tr("task_assignment")) {
            ChoiceEntry(label: tr("task_assignment"), selection: bind("assignMode"), options: taskChoices(TaskFormatKt.assignModeOptions()))
            if value("assignMode") == "fixed" {
                ChoiceEntry(
                    label: tr("task_assignee"),
                    selection: bind("assigneeUserId"),
                    options: [Choice(value: "", label: tr("task_assignee_placeholder"))] + taskChoices(state.people)
                )
                FieldError(text: state.fieldErrors["assigneeUserId"])
            } else if value("assignMode") == "rotate" {
                rotation(state)
            }
        }
    }

    @ViewBuilder
    private func rotation(_ state: TaskEditState) -> some View {
        let order = form?.rotationOrder ?? []
        Text(tr("task_rotation_members"))
            .font(.footnote)
            .foregroundStyle(.secondary)
        Text(tr("task_rotation_hint"))
            .font(.footnote)
            .foregroundStyle(.secondary)
        ForEach(Array(order.enumerated()), id: \.offset) { index, userId in
            let name = state.people.first(where: { $0.value == userId })?.label ?? "?"
            HStack {
                Text(String(index + 1) + ". " + name)
                Spacer()
                Button {
                    update { $0.moveRotation(index: Int32(index), delta: -1) }
                } label: {
                    Image(systemName: "arrow.up")
                }
                .buttonStyle(.borderless)
                .disabled(index == 0)
                .accessibilityLabel(tr("task_rotation_up", ["name": name]))
                Button {
                    update { $0.moveRotation(index: Int32(index), delta: 1) }
                } label: {
                    Image(systemName: "arrow.down")
                }
                .buttonStyle(.borderless)
                .disabled(index == order.count - 1)
                .accessibilityLabel(tr("task_rotation_down", ["name": name]))
                Button {
                    update { $0.removeRotation(index: Int32(index)) }
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(tr("task_rotation_remove", ["name": name]))
            }
        }
        let remaining = state.people.filter { !order.contains($0.value) }
        if !remaining.isEmpty {
            Menu(tr("task_rotation_add")) {
                ForEach(remaining, id: \.value) { person in
                    Button(person.label) {
                        update { $0.addRotation(userId: person.value) }
                    }
                }
            }
        }
        FieldError(text: state.fieldErrors["rotationOrder"])
        ChoiceEntry(
            label: tr("task_rotation_strategy"),
            selection: bind("rotationStrategy"),
            options: taskChoices(TaskFormatKt.rotationOptions())
        )
        Text(TaskFormatKt.rotationHint(strategy: value("rotationStrategy")))
            .font(.footnote)
            .foregroundStyle(.secondary)
    }

    @ViewBuilder
    private func notifications(_ state: TaskEditState) -> some View {
        Section(tr("task_form_notifications")) {
            ChoiceEntry(label: tr("task_notify"), selection: bind("notifyMode"), options: taskChoices(TaskFormatKt.notifyModeOptions()))
            TextEntry(
                label: tr("task_grace_days"),
                text: bind("graceDays"),
                error: state.fieldErrors["graceDays"],
                keyboard: .numberPad,
                capitalization: .never
            )
            Text(tr("task_grace_days_hint"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            TextEntry(
                label: tr("task_due_soon_days") + " (" + tr("common_optional") + ")",
                text: bind("dueSoonDays"),
                error: state.fieldErrors["dueSoonDays"],
                keyboard: .numberPad,
                capitalization: .never
            )
            Text(tr("task_due_soon_days_hint", ["days": state.dueSoonDefault]))
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func preparations(_ state: TaskEditState) -> some View {
        Section(tr("task_preparations")) {
            Text(tr("task_preparations_description"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            let items = form?.preparations ?? []
            if items.isEmpty {
                Text(tr("prep_editor_empty"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(items, id: \.key) { prep in
                VStack(alignment: .leading, spacing: 8) {
                    TextEntry(
                        label: tr("prep_editor_title"),
                        text: Binding(get: { prep.title }, set: { text in update { $0.withPreparation(key: prep.key, field: "title", text: text) } }),
                        error: state.fieldErrors["prep." + prep.key + ".title"]
                    )
                    ChoiceEntry(
                        label: tr("prep_editor_kind"),
                        selection: Binding(get: { prep.kind }, set: { text in update { $0.withPreparation(key: prep.key, field: "kind", text: text) } }),
                        options: taskChoices(TaskFormatKt.preparationKindOptions())
                    )
                    TextEntry(
                        label: tr("prep_editor_lead"),
                        text: Binding(get: { prep.leadDays }, set: { text in update { $0.withPreparation(key: prep.key, field: "leadDays", text: text) } }),
                        error: state.fieldErrors["prep." + prep.key + ".leadDays"],
                        keyboard: .numberPad,
                        capitalization: .never
                    )
                    Button(tr("prep_editor_remove", ["title": prep.title.isEmpty ? "?" : prep.title]), role: .destructive) {
                        update { $0.removePreparation(key: prep.key) }
                    }
                    .buttonStyle(.borderless)
                }
            }
            Button(tr("prep_editor_add")) {
                update { $0.addPreparation(key: UUID().uuidString) }
            }
        }
    }

    // MARK: Form access

    private var triggerBinding: Binding<TriggerForm> {
        Binding(
            get: { form?.trigger ?? TriggerFormKt.defaultTriggerForm(type: TriggerFormKt.TRIGGER_INTERVAL, today: "") },
            set: { next in update { $0.withTrigger(next: next) } }
        )
    }

    private func value(_ field: String) -> String {
        form?.valueOf(field: field) ?? ""
    }

    private func update(_ change: (TaskForm) -> TaskForm) {
        if let current = form {
            form = change(current)
        }
    }

    private func bind(_ field: String) -> Binding<String> {
        Binding(
            get: { value(field) },
            set: { text in update { $0.withField(field: field, text: text) } }
        )
    }

    private func fill(_ initial: TaskForm?) {
        guard form == nil, let initial else { return }
        form = initial
    }
}
