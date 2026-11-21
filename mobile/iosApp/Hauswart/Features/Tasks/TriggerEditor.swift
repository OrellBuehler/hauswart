import shared
import SwiftUI

/// The form of a task's rhythm. `errors` gives the message of a field (`every`, `seasons.0.unit`, ...);
/// `vehicle` is the task's asset when it is a vehicle, whose odometer a counter can read.
struct TriggerEditor: View {
    @Binding var form: TriggerForm
    let today: String
    let vehicle: AssetOption?
    let errors: (String) -> String?

    var body: some View {
        let types = TriggerFormKt.triggerTypeOptions()
        Section {
            Picker(tr("trigger_form_type"), selection: typeBinding) {
                ForEach(types, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }
            if let hint = types.first(where: { $0.value == form.type })?.hint {
                Text(hint)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        typeFields
        if form.hasAutoComplete {
            autoCompleteSection
        }
        if let generic = errors("") {
            Section {
                FieldError(text: generic)
            }
        }
    }

    // MARK: Bindings

    private var typeBinding: Binding<String> {
        Binding(
            get: { form.type },
            set: { form = TriggerFormKt.changeTriggerType(form: form, type: $0, today: today) }
        )
    }

    private func bind(_ field: String) -> Binding<String> {
        Binding(
            get: { form.valueOf(field: field) },
            set: { form = form.withField(field: field, text: $0) }
        )
    }

    private func flag(_ field: String) -> Binding<Bool> {
        Binding(
            get: { form.valueOf(field: field) == "true" },
            set: { form = form.withField(field: field, text: $0 ? "true" : "false") }
        )
    }

    private func entry(_ field: String, _ label: String, keyboard: UIKeyboardType = .default, hint: String = "") -> some View {
        VStack(alignment: .leading, spacing: 4) {
            TextEntry(label: label, text: bind(field), error: errors(field), keyboard: keyboard, capitalization: .never)
            if !hint.isEmpty {
                Text(hint)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func choice(_ field: String, _ label: String, _ options: [ChoiceOption]) -> some View {
        ChoiceEntry(label: label, selection: bind(field), options: taskChoices(options))
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(.secondary)
    }

    // MARK: Fields by type

    @ViewBuilder
    private var typeFields: some View {
        if form.type == TriggerFormKt.TRIGGER_INTERVAL {
            intervalFields
        } else if form.type == TriggerFormKt.TRIGGER_CALENDAR {
            calendarFields
        } else if form.type == TriggerFormKt.TRIGGER_MIN_PER_PERIOD {
            Section {
                entry("count", tr("trigger_form_count"), keyboard: .numberPad)
                choice("period", tr("trigger_form_period"), TriggerFormKt.periodOptions())
                note(tr("trigger_min_per_period_hint"))
            }
        } else if form.type == TriggerFormKt.TRIGGER_ONE_OFF {
            Section {
                DateEntry(label: tr("trigger_form_date"), value: bind("date"), error: errors("date"), clearable: false)
            }
        } else if form.type == TriggerFormKt.TRIGGER_WARRANTY {
            Section {
                DateEntry(label: tr("trigger_form_warranty_until"), value: bind("until"), error: errors("until"), clearable: false)
                DateEntry(
                    label: tr("trigger_form_warranty_extended") + " (" + tr("common_optional") + ")",
                    value: bind("extendedUntil"),
                    error: errors("extendedUntil")
                )
                entry(
                    "leadDays",
                    tr("trigger_form_warranty_lead") + " (" + tr("common_optional") + ")",
                    keyboard: .numberPad,
                    hint: tr("trigger_form_warranty_lead_hint")
                )
            }
        } else if form.type == TriggerFormKt.TRIGGER_COUNTER_DELTA {
            counterFields
        } else if form.type == TriggerFormKt.TRIGGER_STATE_CONDITION {
            stateFields
        } else if form.type == TriggerFormKt.TRIGGER_HA_CALENDAR {
            Section {
                entry("entityId", tr("trigger_form_calendar_entity"), keyboard: .URL, hint: tr("trigger_form_calendar_entity_hint"))
                entry("offsetDays", tr("trigger_form_offset"), keyboard: .numbersAndPunctuation, hint: tr("trigger_form_offset_hint"))
                entry("summaryMatch", tr("trigger_form_summary_match") + " (" + tr("common_optional") + ")")
            }
        }
    }

    @ViewBuilder
    private var intervalFields: some View {
        Section {
            Text(tr("trigger_presets_label"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            let presets = TriggerFormKt.intervalPresetOptions()
            ChipGrid(
                options: presets,
                chosen: { form.activeIntervalPreset() == Int32($0) ?? -2 },
                onToggle: { form = form.withIntervalPreset(index: Int32($0) ?? -1) }
            )
            entry("every", tr("trigger_form_every"), keyboard: .numberPad)
            choice("unit", tr("trigger_form_unit"), TriggerFormKt.unitOptions())
            choice("anchor", tr("trigger_form_anchor"), TriggerFormKt.anchorOptions())
            note(tr(form.anchor == "schedule" ? "trigger_anchor_schedule_hint" : "trigger_anchor_completion_hint"))
            DateEntry(
                label: tr(form.anchor == "schedule" ? "trigger_form_start_schedule" : "trigger_form_start_completion"),
                value: bind("startDate"),
                error: errors("startDate"),
                clearable: false
            )
        }
        Section(tr("trigger_seasons")) {
            note(tr("trigger_seasons_hint"))
            ForEach(Array(form.seasons.enumerated()), id: \.offset) { index, season in
                seasonRow(index, season)
            }
            Button(tr("trigger_season_add")) { form = form.addSeason() }
        }
    }

    @ViewBuilder
    private func seasonRow(_ index: Int, _ season: SeasonForm) -> some View {
        let months = taskChoices(TriggerFormKt.monthLongOptions())
        let at = Int32(index)
        VStack(alignment: .leading, spacing: 8) {
            ChoiceEntry(
                label: tr("trigger_season_from"),
                selection: Binding(get: { season.fromMonth }, set: { form = form.withSeason(index: at, field: "fromMonth", text: $0) }),
                options: months
            )
            ChoiceEntry(
                label: tr("trigger_season_to"),
                selection: Binding(get: { season.toMonth }, set: { form = form.withSeason(index: at, field: "toMonth", text: $0) }),
                options: months
            )
            TextEntry(
                label: tr("trigger_form_every"),
                text: Binding(get: { season.every }, set: { form = form.withSeason(index: at, field: "every", text: $0) }),
                error: errors("seasons.\(index).every"),
                keyboard: .numberPad,
                capitalization: .never
            )
            ChoiceEntry(
                label: tr("trigger_form_unit"),
                selection: Binding(get: { season.unit }, set: { form = form.withSeason(index: at, field: "unit", text: $0) }),
                options: taskChoices(TriggerFormKt.unitOptions())
            )
            Button(tr("trigger_season_remove"), role: .destructive) { form = form.removeSeason(index: at) }
                .buttonStyle(.borderless)
        }
    }

    @ViewBuilder
    private var calendarFields: some View {
        Section {
            choice("freq", tr("trigger_form_freq"), TriggerFormKt.freqOptions())
            HStack {
                Text(tr("trigger_form_every"))
                TextField("", text: bind("interval"))
                    .keyboardType(.numberPad)
                    .frame(maxWidth: 80)
                Text(TriggerFormKt.calendarIntervalUnit(freq: form.freq))
            }
            FieldError(text: errors("interval"))
            if form.freq == "weekly" {
                Text(tr("trigger_form_weekdays"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                weekdayChips
            } else {
                choice("dayMode", tr("trigger_form_day_mode"), TriggerFormKt.dayModeOptions())
                if form.dayMode == "day" {
                    choice("monthDay", tr("trigger_form_monthday"), TriggerFormKt.monthDayOptions())
                    FieldError(text: errors("monthDay"))
                } else {
                    choice("nth", tr("trigger_form_nth"), TriggerFormKt.nthOptions())
                    FieldError(text: errors("nth"))
                    Text(tr("trigger_form_weekday"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    weekdayChips
                }
                Text(tr(form.freq == "yearly" ? "trigger_form_months_year" : "trigger_form_months_only"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                ChipGrid(
                    options: TriggerFormKt.monthOptions(),
                    chosen: { form.isChosen(field: "months", item: $0) },
                    onToggle: { form = form.toggle(field: "months", item: $0) }
                )
                note(tr(form.freq == "yearly" ? "trigger_form_months_year_hint" : "trigger_form_months_only_hint"))
            }
            DateEntry(label: tr("trigger_form_start_calendar"), value: bind("startDate"), error: errors("startDate"), clearable: false)
            note(tr("trigger_form_start_calendar_hint"))
        }
    }

    private var weekdayChips: some View {
        VStack(alignment: .leading, spacing: 4) {
            ChipGrid(
                options: TriggerFormKt.weekdayOptions(),
                chosen: { form.isChosen(field: "weekdays", item: $0) },
                onToggle: { form = form.toggle(field: "weekdays", item: $0) }
            )
            FieldError(text: errors("weekdays"))
        }
    }

    @ViewBuilder
    private var counterFields: some View {
        Section {
            let usesOdometer = vehicle != nil && form.entityId == TaskFormatKt.odometerSignalKey(assetId: vehicle?.id ?? "")
            if let vehicle {
                Picker(tr("trigger_form_counter_source"), selection: Binding(
                    get: { usesOdometer ? "odometer" : "entity" },
                    set: { source in
                        if source == "odometer" {
                            form = TriggerFormKt.odometerCounterForm(form: form, assetId: vehicle.id, unit: vehicle.odometerUnit)
                        } else {
                            form = form.withField(field: "entityId", text: "")
                        }
                    }
                )) {
                    Text(tr("trigger_form_counter_odometer")).tag("odometer")
                    Text(tr("trigger_form_counter_entity_ha")).tag("entity")
                }
            }
            if usesOdometer {
                note(tr("trigger_form_counter_odometer_hint"))
            } else {
                entry("entityId", tr("trigger_form_counter_entity"), keyboard: .URL, hint: tr("trigger_form_counter_entity_hint"))
                if vehicle == nil {
                    note(tr("trigger_form_counter_vehicle_tip"))
                }
            }
            entry("threshold", tr("trigger_form_threshold"), keyboard: .decimalPad, hint: tr("trigger_form_threshold_hint"))
            entry("counterUnit", tr("trigger_form_counter_unit") + " (" + tr("common_optional") + ")")
            ToggleEntry(label: tr("trigger_form_or_every"), isOn: flag("orEvery"), hint: tr("trigger_form_or_every_hint"))
            if form.orEvery {
                entry("orEveryEvery", tr("trigger_form_or_every_every"), keyboard: .numberPad)
                choice("orEveryUnit", tr("trigger_form_unit"), TriggerFormKt.unitOptions())
            }
        }
    }

    @ViewBuilder
    private var stateFields: some View {
        Section {
            entry("entityId", tr("trigger_form_state_entity"), keyboard: .URL, hint: tr("trigger_form_entity_hint"))
            choice("op", tr("trigger_form_op"), TriggerFormKt.opOptions())
            entry("value", tr("trigger_form_value"), hint: tr("trigger_form_value_hint"))
            entry(
                "forMinutes",
                tr("trigger_form_for_minutes") + " (" + tr("common_optional") + ")",
                keyboard: .numberPad,
                hint: tr("trigger_form_for_minutes_hint")
            )
            ToggleEntry(label: tr("trigger_estimate_title"), isOn: flag("estimate"), hint: tr("trigger_estimate_hint"))
            if form.estimate {
                entry("estimateEntityId", tr("trigger_estimate_entity"), keyboard: .URL)
                choice("estimateDirection", tr("trigger_estimate_direction"), TriggerFormKt.directionOptions())
                entry("estimateTarget", tr("trigger_estimate_target"), keyboard: .decimalPad)
            }
        }
    }

    // MARK: Auto-completion

    @ViewBuilder
    private var autoCompleteSection: some View {
        Section(tr("auto_complete_title") + " (" + tr("common_optional") + ")") {
            note(tr("auto_complete_description"))
            if !form.legacyResetDrop.isEmpty {
                HStack {
                    Text(tr("auto_complete_legacy", ["minDrop": form.legacyResetDrop]))
                        .font(.footnote)
                    Spacer()
                    Button(tr("auto_complete_remove")) {
                        form = form.withField(field: "legacyResetDrop", text: "")
                    }
                    .buttonStyle(.borderless)
                }
            }
            ForEach(Array(form.autoComplete.enumerated()), id: \.offset) { index, rule in
                ruleRow(index, rule)
            }
            if form.canAddRule {
                Button(tr("auto_complete_add_counter_reset")) {
                    form = form.addRule(ruleType: TriggerFormKt.RULE_COUNTER_RESET)
                }
                Button(tr("auto_complete_add_state_change")) {
                    form = form.addRule(ruleType: TriggerFormKt.RULE_STATE_CHANGE)
                }
            }
        }
    }

    @ViewBuilder
    private func ruleRow(_ index: Int, _ rule: AutoCompleteRuleForm) -> some View {
        let at = Int32(index)
        let isReset = rule.type == TriggerFormKt.RULE_COUNTER_RESET
        VStack(alignment: .leading, spacing: 8) {
            ChoiceEntry(
                label: tr("auto_complete_rule_label", ["n": index + 1]),
                selection: Binding(get: { rule.type }, set: { form = form.withRule(index: at, field: "type", text: $0) }),
                options: taskChoices(TriggerFormKt.ruleTypeOptions())
            )
            TextEntry(
                label: tr(isReset ? "auto_complete_counter_entity" : "auto_complete_state_entity"),
                text: Binding(get: { rule.entityId }, set: { form = form.withRule(index: at, field: "entityId", text: $0) }),
                error: errors("autoComplete.\(index).entityId"),
                keyboard: .URL,
                capitalization: .never
            )
            if isReset {
                TextEntry(
                    label: tr("auto_complete_min_drop"),
                    text: Binding(get: { rule.minDrop }, set: { form = form.withRule(index: at, field: "minDrop", text: $0) }),
                    error: errors("autoComplete.\(index).minDrop"),
                    keyboard: .decimalPad,
                    capitalization: .never
                )
            } else {
                TextEntry(
                    label: tr("auto_complete_to"),
                    text: Binding(get: { rule.to }, set: { form = form.withRule(index: at, field: "to", text: $0) }),
                    error: errors("autoComplete.\(index).to"),
                    capitalization: .never
                )
                TextEntry(
                    label: tr("auto_complete_from") + " (" + tr("common_optional") + ")",
                    text: Binding(get: { rule.from }, set: { form = form.withRule(index: at, field: "from", text: $0) }),
                    capitalization: .never
                )
            }
            Button(tr("auto_complete_remove_rule", ["n": index + 1]), role: .destructive) {
                form = form.removeRule(index: at)
            }
            .buttonStyle(.borderless)
        }
    }
}
