import shared
import SwiftUI

/// Creates a policy (`id` nil) or edits one. Presented as a sheet; `onSaved` gets the id of the saved policy.
struct InsuranceEditScreen: View {
    @StateObject private var model: Observed<InsuranceEditStore, InsuranceEditState>
    @Environment(\.dismiss) private var dismiss

    private let onSaved: (String) -> Void

    @State private var loaded = false
    @State private var title = ""
    @State private var type = "other"
    @State private var insurerContactId = ""
    @State private var policyNumber = ""
    @State private var premium = ""
    @State private var currency = "CHF"
    @State private var premiumPeriod = "annual"
    @State private var deductible = ""
    @State private var startDate = ""
    @State private var endDate = ""
    @State private var renewal = "auto"
    @State private var noticeMonths = ""
    @State private var assistancePhone = ""
    @State private var showOnEmergency = false
    @State private var notes = ""
    @State private var assetIds: [String] = []

    init(id: String?, assetId: String, type: String, onSaved: @escaping (String) -> Void) {
        self.onSaved = onSaved
        _model = StateObject(wrappedValue: Observed(InsuranceEditStore(app: AppEnv.app, id: id, assetId: assetId, type: type)))
    }

    var body: some View {
        let state = model.state
        NavigationStack {
            content(state)
                .navigationTitle(tr(state.isNew ? "insurance_new" : "insurance_edit_title"))
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
            if let savedId {
                onSaved(savedId)
                dismiss()
            }
        }
    }

    @ViewBuilder
    private func content(_ state: InsuranceEditState) -> some View {
        if let error = state.loadError {
            ErrorView(error: error) { model.store.retry() }
        } else if !loaded {
            LoadingView()
        } else {
            let preview = model.store.preview(form: form)
            let errors = state.fieldErrors
            Form {
                if state.error != nil {
                    Section {
                        ErrorBanner(error: state.error)
                    }
                }
                Section(tr("insurance_form_basics")) {
                    TextEntry(label: tr("insurance_title_label"), text: $title, error: errors["title"])
                    ChoiceEntry(label: tr("insurance_type_label"), selection: $type, options: typeChoices)
                    TextEntry(
                        label: tr("insurance_policy_number_label"),
                        text: $policyNumber,
                        error: errors["policyNumber"],
                        capitalization: .never
                    )
                    PickEntry(
                        label: tr("insurance_insurer_label"),
                        noneLabel: tr("m_insurance_insurer_none"),
                        options: state.contacts.map { PickChoice(id: $0.id, label: $0.label, detail: $0.detail) },
                        selection: $insurerContactId,
                        error: errors["insurerContactId"]
                    )
                    Text(tr("insurance_insurer_hint"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Section {
                    MultiPickEntry(
                        label: tr("insurance_assets_label"),
                        emptyText: tr("insurance_assets_none"),
                        options: state.assets.map { PickChoice(id: $0.id, label: $0.label, detail: $0.detail) },
                        selection: $assetIds,
                        error: errors["assetIds"]
                    )
                } header: {
                    Text(tr("insurance_form_cover"))
                } footer: {
                    Text(tr("insurance_assets_hint"))
                }
                Section(tr("insurance_form_premium")) {
                    MoneyEntry(label: tr("insurance_premium_label"), text: $premium, currency: currency, error: errors["premiumMinor"])
                    TextEntry(
                        label: tr("insurance_currency_label"),
                        text: currencyBinding,
                        error: errors["currency"],
                        capitalization: .characters
                    )
                    if !preview.otherCurrency.isEmpty {
                        Text(preview.otherCurrency)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    ChoiceEntry(label: tr("insurance_period_label"), selection: $premiumPeriod, options: periodChoices)
                    if !preview.annual.isEmpty {
                        Text(preview.annual)
                    }
                    MoneyEntry(
                        label: tr("insurance_deductible_label"),
                        text: $deductible,
                        currency: currency,
                        error: errors["deductibleMinor"]
                    )
                }
                Section {
                    DateEntry(label: tr("insurance_start_label"), value: $startDate, error: errors["startDate"], clearable: false)
                    DateEntry(label: tr("insurance_end_label"), value: $endDate, error: errors["endDate"])
                    ChoiceEntry(label: tr("insurance_renewal_label"), selection: $renewal, options: renewalChoices)
                    if renewal == "auto" {
                        TextEntry(
                            label: tr("insurance_notice_label"),
                            text: noticeBinding,
                            error: errors["cancellationNoticeMonths"],
                            keyboard: .numberPad
                        )
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(tr("insurance_deadline_preview_title"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(preview.deadline)
                            .foregroundStyle(Tone.color(preview.deadlineTone))
                        if !preview.reminder.isEmpty {
                            Text(preview.reminder)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                } header: {
                    Text(tr("insurance_form_term"))
                } footer: {
                    Text(tr("insurance_end_label_hint"))
                }
                Section(tr("insurance_form_help")) {
                    TextEntry(
                        label: tr("insurance_assistance_label"),
                        text: $assistancePhone,
                        error: errors["assistancePhone"],
                        keyboard: .phonePad
                    )
                    ToggleEntry(
                        label: tr("insurance_emergency_label"),
                        isOn: $showOnEmergency,
                        hint: tr("insurance_emergency_hint")
                    )
                }
                Section {
                    TextEntry(label: tr("insurance_notes_label"), text: $notes, error: errors["notes"], multiline: true)
                } header: {
                    Text(tr("insurance_form_more"))
                } footer: {
                    if state.isNew {
                        Text(tr("insurance_files_after_create"))
                    }
                }
            }
        }
    }

    private var currencyBinding: Binding<String> {
        Binding(
            get: { currency },
            set: { value in
                let letters = value.uppercased().filter { character in character >= "A" && character <= "Z" }
                currency = String(letters.prefix(3))
            }
        )
    }

    private var noticeBinding: Binding<String> {
        Binding(
            get: { noticeMonths },
            set: { value in
                let digits = value.filter { character in character.isNumber }
                noticeMonths = String(digits.prefix(3))
            }
        )
    }

    private var typeChoices: [Choice] {
        InsuranceLogicKt.INSURANCE_TYPES.map { Choice(value: $0, label: InsuranceLogicKt.insuranceTypeLabel(type: $0)) }
    }

    private var periodChoices: [Choice] {
        InsuranceLogicKt.INSURANCE_PERIODS.map { Choice(value: $0, label: InsuranceLogicKt.insurancePeriodLabel(period: $0)) }
    }

    private var renewalChoices: [Choice] {
        InsuranceLogicKt.INSURANCE_RENEWALS.map { Choice(value: $0, label: InsuranceLogicKt.insuranceRenewalLabel(renewal: $0)) }
    }

    private var form: PolicyForm {
        PolicyForm(
            title: title,
            type: type,
            insurerContactId: insurerContactId,
            policyNumber: policyNumber,
            premium: premium,
            currency: currency,
            premiumPeriod: premiumPeriod,
            deductible: deductible,
            startDate: startDate,
            endDate: endDate,
            renewal: renewal,
            noticeMonths: noticeMonths,
            assistancePhone: assistancePhone,
            showOnEmergency: showOnEmergency,
            notes: notes,
            assetIds: assetIds
        )
    }

    private func fill(_ initial: PolicyForm?) {
        guard !loaded, let initial else { return }
        title = initial.title
        type = initial.type
        insurerContactId = initial.insurerContactId
        policyNumber = initial.policyNumber
        premium = initial.premium
        currency = initial.currency
        premiumPeriod = initial.premiumPeriod
        deductible = initial.deductible
        startDate = initial.startDate
        endDate = initial.endDate
        renewal = initial.renewal
        noticeMonths = initial.noticeMonths
        assistancePhone = initial.assistancePhone
        showOnEmergency = initial.showOnEmergency
        notes = initial.notes
        assetIds = initial.assetIds
        loaded = true
    }
}
