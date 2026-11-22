import shared
import SwiftUI

/// Records a defect (`id` nil) or edits one. A sheet, or with `embedded` a screen that is pushed. `onSaved` gets the
/// id.
struct DefectEditScreen: View {
    private let embedded: Bool
    private let onSaved: ((String) -> Void)?
    @StateObject private var model: Observed<DefectEditStore, DefectEditState>
    @Environment(\.dismiss) private var dismiss

    @State private var loaded = false
    @State private var title = ""
    @State private var details = ""
    @State private var severity = "medium"
    @State private var roomId = ""
    @State private var assetId = ""
    @State private var locationDetail = ""
    @State private var discoveredOn = ""
    @State private var contactId = ""
    @State private var deadlineMode = "none"
    @State private var deadlineDate = ""

    init(id: String?, assetId: String?, roomId: String?, embedded: Bool, onSaved: ((String) -> Void)?) {
        self.embedded = embedded
        self.onSaved = onSaved
        _model = StateObject(wrappedValue: Observed(DefectEditStore(
            app: AppEnv.app,
            id: id,
            assetId: assetId,
            roomId: roomId
        )))
    }

    var body: some View {
        if embedded {
            screen
        } else {
            NavigationStack {
                screen
            }
        }
    }

    private var screen: some View {
        let state = model.state
        return content(state)
            .navigationTitle(state.isNew ? tr("defect_new") : tr("defect_edit_title", ["number": state.number]))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !embedded {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(tr("common_cancel")) { dismiss() }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(state.saving ? tr("common_saving") : tr("common_save")) {
                        model.store.save(form: form)
                    }
                    .disabled(state.saving || !loaded)
                }
            }
            .onAppear { fill(state.initial) }
            .onChange(of: state.initial) { _, initial in
                fill(initial)
            }
            .onChange(of: state.savedId) { _, savedId in
                if let savedId {
                    onSaved?(savedId)
                    dismiss()
                }
            }
    }

    @ViewBuilder
    private func content(_ state: DefectEditState) -> some View {
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
                    TextEntry(label: tr("defect_title"), text: $title, error: state.fieldErrors["title"])
                    TextEntry(
                        label: tr("defect_description"),
                        text: $details,
                        error: state.fieldErrors["descriptionMd"],
                        multiline: true
                    )
                    ChoiceEntry(
                        label: tr("defect_severity"),
                        selection: $severity,
                        options: defectChoices(state.severities)
                    )
                }
                Section(tr("defect_form_place")) {
                    ChoiceEntry(label: tr("defect_room"), selection: $roomId, options: defectChoices(state.rooms))
                    ChoiceEntry(
                        label: tr("defect_asset"),
                        selection: assetBinding,
                        options: defectChoices(state.assets)
                    )
                    TextEntry(
                        label: tr("defect_location_detail"),
                        text: $locationDetail,
                        error: state.fieldErrors["locationDetail"]
                    )
                }
                Section(tr("defect_form_handling")) {
                    DateEntry(
                        label: tr("defect_discovered_on"),
                        value: $discoveredOn,
                        error: state.fieldErrors["discoveredOn"],
                        clearable: false
                    )
                    ChoiceEntry(
                        label: tr("defect_responsible"),
                        selection: $contactId,
                        options: defectChoices(state.contacts)
                    )
                    if state.noContacts {
                        Text(tr("defect_responsible_empty"))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    ChoiceEntry(
                        label: tr("defect_deadline"),
                        selection: $deadlineMode,
                        options: defectChoices(state.deadlineModes)
                    )
                    if deadlineMode == DefectLogicKt.DEADLINE_MODE_MANUAL {
                        DateEntry(
                            label: tr("defect_deadline_date"),
                            value: $deadlineDate,
                            error: state.fieldErrors["deadlineDate"],
                            clearable: false
                        )
                    }
                    ForEach(model.store.deadlineHints(form: form), id: \.self) { hint in
                        Text(hint)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private var assetBinding: Binding<String> {
        Binding(
            get: { assetId },
            set: { value in
                let next = model.store.withAsset(form: form, assetId: value)
                assetId = next.assetId
                roomId = next.roomId
            }
        )
    }

    private var form: DefectForm {
        DefectForm(
            title: title,
            details: details,
            severity: severity,
            roomId: roomId,
            assetId: assetId,
            locationDetail: locationDetail,
            discoveredOn: discoveredOn,
            contactId: contactId,
            deadlineMode: deadlineMode,
            deadlineDate: deadlineDate
        )
    }

    private func fill(_ initial: DefectForm?) {
        guard !loaded, let initial else { return }
        title = initial.title
        details = initial.details
        severity = initial.severity
        roomId = initial.roomId
        assetId = initial.assetId
        locationDetail = initial.locationDetail
        discoveredOn = initial.discoveredOn
        contactId = initial.contactId
        deadlineMode = initial.deadlineMode
        deadlineDate = initial.deadlineDate
        loaded = true
    }
}
