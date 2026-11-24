@file:OptIn(ExperimentalLayoutApi::class)

package ch.orellbuehler.hauswart.android.ui.tasks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.DateField
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.feature.tasks.AssetOption
import ch.orellbuehler.hauswart.feature.tasks.ChoiceOption
import ch.orellbuehler.hauswart.feature.tasks.RULE_COUNTER_RESET
import ch.orellbuehler.hauswart.feature.tasks.RULE_STATE_CHANGE
import ch.orellbuehler.hauswart.feature.tasks.TRIGGER_CALENDAR
import ch.orellbuehler.hauswart.feature.tasks.TRIGGER_COUNTER_DELTA
import ch.orellbuehler.hauswart.feature.tasks.TRIGGER_HA_CALENDAR
import ch.orellbuehler.hauswart.feature.tasks.TRIGGER_INTERVAL
import ch.orellbuehler.hauswart.feature.tasks.TRIGGER_MIN_PER_PERIOD
import ch.orellbuehler.hauswart.feature.tasks.TRIGGER_ONE_OFF
import ch.orellbuehler.hauswart.feature.tasks.TRIGGER_STATE_CONDITION
import ch.orellbuehler.hauswart.feature.tasks.TRIGGER_WARRANTY
import ch.orellbuehler.hauswart.feature.tasks.TriggerForm
import ch.orellbuehler.hauswart.feature.tasks.anchorOptions
import ch.orellbuehler.hauswart.feature.tasks.calendarIntervalUnit
import ch.orellbuehler.hauswart.feature.tasks.changeTriggerType
import ch.orellbuehler.hauswart.feature.tasks.dayModeOptions
import ch.orellbuehler.hauswart.feature.tasks.directionOptions
import ch.orellbuehler.hauswart.feature.tasks.freqOptions
import ch.orellbuehler.hauswart.feature.tasks.intervalPresetOptions
import ch.orellbuehler.hauswart.feature.tasks.monthDayOptions
import ch.orellbuehler.hauswart.feature.tasks.monthLongOptions
import ch.orellbuehler.hauswart.feature.tasks.monthOptions
import ch.orellbuehler.hauswart.feature.tasks.nthOptions
import ch.orellbuehler.hauswart.feature.tasks.odometerCounterForm
import ch.orellbuehler.hauswart.feature.tasks.odometerSignalKey
import ch.orellbuehler.hauswart.feature.tasks.opOptions
import ch.orellbuehler.hauswart.feature.tasks.periodOptions
import ch.orellbuehler.hauswart.feature.tasks.ruleTypeOptions
import ch.orellbuehler.hauswart.feature.tasks.triggerTypeOptions
import ch.orellbuehler.hauswart.feature.tasks.unitOptions
import ch.orellbuehler.hauswart.feature.tasks.weekdayOptions
import ch.orellbuehler.hauswart.i18n.tr

private fun List<ChoiceOption>.pairs(): List<Pair<String, String>> = map { it.value to it.label }

/**
 * The form of a task's rhythm. [error] gives the message of a field (`every`, `seasons.0.unit`, ...);
 * [vehicle] is the task's asset when it is a vehicle, whose odometer a counter can read.
 */
@Composable
fun TriggerEditor(
    form: TriggerForm,
    today: String,
    vehicle: AssetOption?,
    error: (String) -> String?,
    onChange: (TriggerForm) -> Unit,
) {
    val types = triggerTypeOptions()
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ChoiceField(
            label = tr("trigger_form_type"),
            value = form.type,
            options = types.map { it.value to it.label },
            onChange = { onChange(changeTriggerType(form, it, today)) },
        )
        Text(
            types.firstOrNull { it.value == form.type }?.hint.orEmpty(),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        val field: @Composable (String, String, KeyboardType, String?) -> Unit = { name, label, keyboard, hint ->
            TextField(
                label = label,
                value = form.valueOf(name),
                onChange = { onChange(form.withField(name, it)) },
                error = error(name),
                hint = hint,
                keyboardType = keyboard,
            )
        }
        when (form.type) {
            TRIGGER_INTERVAL -> IntervalFields(form, today, error, onChange)
            TRIGGER_CALENDAR -> CalendarFields(form, error, onChange)
            TRIGGER_MIN_PER_PERIOD -> {
                field("count", tr("trigger_form_count"), KeyboardType.Number, null)
                ChoiceField(tr("trigger_form_period"), form.period, periodOptions().pairs(), {
                    onChange(form.withField("period", it))
                }, error = error("period"))
                Text(
                    tr("trigger_min_per_period_hint"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TRIGGER_ONE_OFF ->
                DateField(tr("trigger_form_date"), form.date, {
                    onChange(form.withField("date", it))
                }, error = error("date"), clearable = false)
            TRIGGER_WARRANTY -> {
                DateField(tr("trigger_form_warranty_until"), form.until, {
                    onChange(form.withField("until", it))
                }, error = error("until"), clearable = false)
                DateField(
                    tr("trigger_form_warranty_extended") + " (" + tr("common_optional") + ")",
                    form.extendedUntil,
                    { onChange(form.withField("extendedUntil", it)) },
                    error = error("extendedUntil"),
                )
                field(
                    "leadDays",
                    tr("trigger_form_warranty_lead") + " (" + tr("common_optional") + ")",
                    KeyboardType.Number,
                    tr("trigger_form_warranty_lead_hint"),
                )
            }
            TRIGGER_COUNTER_DELTA -> CounterFields(form, vehicle, error, onChange, field)
            TRIGGER_STATE_CONDITION -> StateFields(form, error, onChange, field)
            TRIGGER_HA_CALENDAR -> {
                field("entityId", tr("trigger_form_calendar_entity"), KeyboardType.Uri, tr("trigger_form_calendar_entity_hint"))
                field("offsetDays", tr("trigger_form_offset"), KeyboardType.Number, tr("trigger_form_offset_hint"))
                field("summaryMatch", tr("trigger_form_summary_match") + " (" + tr("common_optional") + ")", KeyboardType.Text, null)
            }
        }
        if (form.hasAutoComplete) AutoCompleteFields(form, error, onChange)
        error("")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
    }
}

@Composable
private fun IntervalFields(
    form: TriggerForm,
    today: String,
    error: (String) -> String?,
    onChange: (TriggerForm) -> Unit,
) {
    val presets = intervalPresetOptions()
    Text(tr("trigger_presets_label"), style = MaterialTheme.typography.labelLarge)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        presets.forEachIndexed { i, p ->
            FilterChip(selected = form.activeIntervalPreset() == i, onClick = {
                onChange(form.withIntervalPreset(i))
            }, label = { Text(p.label, maxLines = 1) })
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(Modifier.weight(1f)) {
            TextField(tr("trigger_form_every"), form.every, {
                onChange(form.withField("every", it))
            }, error = error("every"), keyboardType = KeyboardType.Number)
        }
        Column(Modifier.weight(2f)) {
            ChoiceField(
                tr("trigger_form_unit"),
                form.unit,
                unitOptions().pairs(),
                { onChange(form.withField("unit", it)) },
                error = error("unit"),
            )
        }
    }
    ChoiceField(tr("trigger_form_anchor"), form.anchor, anchorOptions().pairs(), { onChange(form.withField("anchor", it)) })
    Text(
        tr(if (form.anchor == "schedule") "trigger_anchor_schedule_hint" else "trigger_anchor_completion_hint"),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    DateField(
        tr(if (form.anchor == "schedule") "trigger_form_start_schedule" else "trigger_form_start_completion"),
        form.startDate,
        { onChange(form.withField("startDate", it)) },
        error = error("startDate"),
        clearable = false,
    )
    Text(tr("trigger_seasons"), style = MaterialTheme.typography.labelLarge)
    Text(tr("trigger_seasons_hint"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    form.seasons.forEachIndexed { i, s ->
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    ChoiceField(
                        tr("trigger_season_from"),
                        s.fromMonth,
                        monthLongOptions().pairs(),
                        { onChange(form.withSeason(i, "fromMonth", it)) },
                    )
                }
                Column(Modifier.weight(1f)) {
                    ChoiceField(
                        tr("trigger_season_to"),
                        s.toMonth,
                        monthLongOptions().pairs(),
                        { onChange(form.withSeason(i, "toMonth", it)) },
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    TextField(
                        tr("trigger_form_every"),
                        s.every,
                        { onChange(form.withSeason(i, "every", it)) },
                        error = error("seasons.$i.every"),
                        keyboardType = KeyboardType.Number,
                    )
                }
                Column(Modifier.weight(1f)) {
                    ChoiceField(tr("trigger_form_unit"), s.unit, unitOptions().pairs(), { onChange(form.withSeason(i, "unit", it)) })
                }
            }
            OutlinedButton(onClick = { onChange(form.removeSeason(i)) }) { Text(tr("trigger_season_remove"), maxLines = 1) }
        }
    }
    OutlinedButton(onClick = { onChange(form.addSeason()) }) {
        Icon(Icons.Outlined.Add, contentDescription = null)
        Text(tr("trigger_season_add"), Modifier.padding(start = 8.dp), maxLines = 1)
    }
}

@Composable
private fun CalendarFields(
    form: TriggerForm,
    error: (String) -> String?,
    onChange: (TriggerForm) -> Unit,
) {
    ChoiceField(tr("trigger_form_freq"), form.freq, freqOptions().pairs(), { onChange(form.withField("freq", it)) })
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(tr("trigger_form_every"))
        Column(Modifier.weight(1f)) {
            TextField(
                tr("trigger_form_repeat"),
                form.interval,
                { onChange(form.withField("interval", it)) },
                error = error("interval"),
                keyboardType = KeyboardType.Number,
            )
        }
        Text(calendarIntervalUnit(form.freq))
    }
    if (form.freq == "weekly") {
        Text(tr("trigger_form_weekdays"), style = MaterialTheme.typography.labelLarge)
        ChipRow(weekdayOptions(), { form.isChosen("weekdays", it) }) { onChange(form.toggle("weekdays", it)) }
        error("weekdays")?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
    } else {
        ChoiceField(tr("trigger_form_day_mode"), form.dayMode, dayModeOptions().pairs(), { onChange(form.withField("dayMode", it)) })
        if (form.dayMode == "day") {
            ChoiceField(tr("trigger_form_monthday"), form.monthDay, monthDayOptions().pairs(), {
                onChange(form.withField("monthDay", it))
            }, error = error("monthDay"))
        } else {
            ChoiceField(
                tr("trigger_form_nth"),
                form.nth,
                nthOptions().pairs(),
                { onChange(form.withField("nth", it)) },
                error = error("nth"),
            )
            Text(tr("trigger_form_weekday"), style = MaterialTheme.typography.labelLarge)
            ChipRow(weekdayOptions(), { form.isChosen("weekdays", it) }) { onChange(form.toggle("weekdays", it)) }
            error("weekdays")?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
        Text(
            tr(
                if (form.freq ==
                    "yearly"
                ) {
                    "trigger_form_months_year"
                } else {
                    "trigger_form_months_only"
                },
            ),
            style = MaterialTheme.typography.labelLarge,
        )
        ChipRow(monthOptions(), { form.isChosen("months", it) }) { onChange(form.toggle("months", it)) }
        Text(
            tr(if (form.freq == "yearly") "trigger_form_months_year_hint" else "trigger_form_months_only_hint"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    DateField(tr("trigger_form_start_calendar"), form.startDate, {
        onChange(form.withField("startDate", it))
    }, error = error("startDate"), clearable = false)
    Text(
        tr("trigger_form_start_calendar_hint"),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun ChipRow(
    options: List<ChoiceOption>,
    chosen: (String) -> Boolean,
    onToggle: (String) -> Unit,
) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { o ->
            FilterChip(selected = chosen(o.value), onClick = { onToggle(o.value) }, label = { Text(o.label, maxLines = 1) })
        }
    }
}

@Composable
private fun CounterFields(
    form: TriggerForm,
    vehicle: AssetOption?,
    error: (String) -> String?,
    onChange: (TriggerForm) -> Unit,
    field: @Composable (String, String, KeyboardType, String?) -> Unit,
) {
    val usesOdometer = vehicle != null && form.entityId == odometerSignalKey(vehicle.id)
    if (vehicle != null) {
        ChoiceField(
            tr("trigger_form_counter_source"),
            if (usesOdometer) "odometer" else "entity",
            listOf("odometer" to tr("trigger_form_counter_odometer"), "entity" to tr("trigger_form_counter_entity_ha")),
            {
                onChange(
                    if (it ==
                        "odometer"
                    ) {
                        odometerCounterForm(form, vehicle.id, vehicle.odometerUnit)
                    } else {
                        form.withField("entityId", "")
                    },
                )
            },
        )
    }
    if (usesOdometer) {
        Text(
            tr("trigger_form_counter_odometer_hint"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    } else {
        field("entityId", tr("trigger_form_counter_entity"), KeyboardType.Uri, tr("trigger_form_counter_entity_hint"))
        if (vehicle == null) {
            Text(
                tr("trigger_form_counter_vehicle_tip"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
    field("threshold", tr("trigger_form_threshold"), KeyboardType.Decimal, tr("trigger_form_threshold_hint"))
    field("counterUnit", tr("trigger_form_counter_unit") + " (" + tr("common_optional") + ")", KeyboardType.Text, null)
    SwitchField(
        label = tr("trigger_form_or_every"),
        hint = tr("trigger_form_or_every_hint"),
        checked = form.orEvery,
        onChange = { onChange(form.withField("orEvery", it.toString())) },
    )
    if (form.orEvery) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                TextField(
                    tr("trigger_form_or_every_every"),
                    form.orEveryEvery,
                    { onChange(form.withField("orEveryEvery", it)) },
                    error = error("orEveryEvery"),
                    keyboardType = KeyboardType.Number,
                )
            }
            Column(Modifier.weight(2f)) {
                ChoiceField(
                    tr("trigger_form_unit"),
                    form.orEveryUnit,
                    unitOptions().pairs(),
                    { onChange(form.withField("orEveryUnit", it)) },
                )
            }
        }
    }
}

@Composable
private fun StateFields(
    form: TriggerForm,
    error: (String) -> String?,
    onChange: (TriggerForm) -> Unit,
    field: @Composable (String, String, KeyboardType, String?) -> Unit,
) {
    field("entityId", tr("trigger_form_state_entity"), KeyboardType.Uri, tr("trigger_form_entity_hint"))
    ChoiceField(tr("trigger_form_op"), form.op, opOptions().pairs(), { onChange(form.withField("op", it)) }, error = error("op"))
    field("value", tr("trigger_form_value"), KeyboardType.Text, tr("trigger_form_value_hint"))
    field(
        "forMinutes",
        tr("trigger_form_for_minutes") + " (" + tr("common_optional") + ")",
        KeyboardType.Number,
        tr("trigger_form_for_minutes_hint"),
    )
    SwitchField(
        label = tr("trigger_estimate_title"),
        hint = tr("trigger_estimate_hint"),
        checked = form.estimate,
        onChange = { onChange(form.withField("estimate", it.toString())) },
    )
    if (form.estimate) {
        field("estimateEntityId", tr("trigger_estimate_entity"), KeyboardType.Uri, null)
        ChoiceField(tr("trigger_estimate_direction"), form.estimateDirection, directionOptions().pairs(), {
            onChange(form.withField("estimateDirection", it))
        })
        field("estimateTarget", tr("trigger_estimate_target"), KeyboardType.Decimal, null)
    }
}

@Composable
private fun AutoCompleteFields(
    form: TriggerForm,
    error: (String) -> String?,
    onChange: (TriggerForm) -> Unit,
) {
    Text(tr("auto_complete_title") + " (" + tr("common_optional") + ")", style = MaterialTheme.typography.labelLarge)
    Text(tr("auto_complete_description"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (form.legacyResetDrop.isNotEmpty()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                tr("auto_complete_legacy", "minDrop" to form.legacyResetDrop),
                Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium,
            )
            IconButton(onClick = { onChange(form.withField("legacyResetDrop", "")) }) {
                Icon(Icons.Outlined.Delete, contentDescription = tr("auto_complete_remove"))
            }
        }
    }
    form.autoComplete.forEachIndexed { i, rule ->
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    ChoiceField(tr("auto_complete_rule_label", "n" to (i + 1)), rule.type, ruleTypeOptions().pairs(), {
                        onChange(form.withRule(i, "type", it))
                    })
                }
                IconButton(onClick = { onChange(form.removeRule(i)) }) {
                    Icon(Icons.Outlined.Delete, contentDescription = tr("auto_complete_remove_rule", "n" to (i + 1)))
                }
            }
            TextField(
                label = tr(if (rule.type == RULE_COUNTER_RESET) "auto_complete_counter_entity" else "auto_complete_state_entity"),
                value = rule.entityId,
                onChange = { onChange(form.withRule(i, "entityId", it)) },
                error = error("autoComplete.$i.entityId"),
                keyboardType = KeyboardType.Uri,
            )
            if (rule.type == RULE_COUNTER_RESET) {
                TextField(
                    label = tr("auto_complete_min_drop"),
                    value = rule.minDrop,
                    onChange = { onChange(form.withRule(i, "minDrop", it)) },
                    error = error("autoComplete.$i.minDrop"),
                    hint = tr("auto_complete_min_drop_hint"),
                    keyboardType = KeyboardType.Decimal,
                )
            } else {
                TextField(tr("auto_complete_to"), rule.to, { onChange(form.withRule(i, "to", it)) }, error = error("autoComplete.$i.to"))
                TextField(
                    tr("auto_complete_from") + " (" + tr("common_optional") + ")",
                    rule.from,
                    { onChange(form.withRule(i, "from", it)) },
                    hint = tr("auto_complete_from_hint"),
                )
            }
        }
    }
    if (form.canAddRule) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                onClick = { onChange(form.addRule(RULE_COUNTER_RESET)) },
            ) { Text(tr("auto_complete_add_counter_reset"), maxLines = 1) }
            OutlinedButton(
                onClick = { onChange(form.addRule(RULE_STATE_CHANGE)) },
            ) { Text(tr("auto_complete_add_state_change"), maxLines = 1) }
        }
    }
}
