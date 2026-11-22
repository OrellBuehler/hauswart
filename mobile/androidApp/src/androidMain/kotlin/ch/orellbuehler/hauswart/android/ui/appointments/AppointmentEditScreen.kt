package ch.orellbuehler.hauswart.android.ui.appointments

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.DateField
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.SaveBar
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.appointments.APPOINTMENT_LOCATION_MAX
import ch.orellbuehler.hauswart.feature.appointments.APPOINTMENT_NOTES_MAX
import ch.orellbuehler.hauswart.feature.appointments.APPOINTMENT_TITLE_MAX
import ch.orellbuehler.hauswart.feature.appointments.AppointmentEditStore
import ch.orellbuehler.hauswart.feature.appointments.AppointmentForm
import ch.orellbuehler.hauswart.i18n.tr

/**
 * Creates an appointment ([id] empty; [taskId], [assetId], [contactId] and [occurrenceKey] prefill
 * it) or edits one. Times are wall-clock times in the household's time zone.
 */
@Composable
fun AppointmentEditScreen(
    nav: NavController,
    id: String,
    taskId: String,
    assetId: String,
    contactId: String,
    occurrenceKey: String,
) {
    val store =
        rememberStore(
            key = "edit-$id-$taskId-$assetId-$contactId",
        ) { AppointmentEditStore(it, id, taskId, assetId, contactId, occurrenceKey) }
    val state = store.collect()
    val initial = state.initial
    val loadError = state.loadError
    var form by remember(initial) { mutableStateOf(initial) }
    var showEndDate by remember(initial) { mutableStateOf(initial?.endDate?.isNotEmpty() == true) }

    LaunchedEffect(state.savedId) { if (state.savedId != null) nav.popBackStack() }

    AppScaffold(
        title = tr(if (state.isNew) "appointment_create_title" else "appointment_edit_title"),
        onBack = { nav.popBackStack() },
        bottomBar = { if (form != null) SaveBar(onSave = { form?.let(store::save) }, pending = state.saving) },
    ) { padding ->
        val current = form
        when {
            current != null ->
                Column(
                    Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(ScreenPadding),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    val errors = state.fieldErrors
                    TextField(
                        label = tr("appointment_title_label"),
                        value = current.title,
                        onChange = { form = current.copy(title = it.take(APPOINTMENT_TITLE_MAX + 20)) },
                        error = errors["title"],
                        hint = tr("appointment_title_placeholder"),
                        capitalization = KeyboardCapitalization.Sentences,
                    )
                    SwitchField(
                        label = tr("appointment_all_day_label"),
                        hint = tr("appointment_all_day_hint"),
                        checked = current.allDay,
                        onChange = {
                            form = current.copy(allDay = it)
                            showEndDate = !it && current.endDate.isNotEmpty()
                        },
                    )
                    TimesFields(current, errors, showEndDate, { form = it }, { showEndDate = it })
                    val preview = store.preview(current)
                    Text(
                        tr("appointment_preview_title") + ": " + preview.text.ifEmpty { preview.hint },
                        style = MaterialTheme.typography.bodyMedium,
                        color =
                            if (preview.text.isEmpty() &&
                                preview.hint.isNotEmpty()
                            ) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                    )
                    TextField(
                        label = tr("appointment_location_label"),
                        value = current.location,
                        onChange = { form = current.copy(location = it.take(APPOINTMENT_LOCATION_MAX + 20)) },
                        error = errors["location"],
                        hint = tr("appointment_location_placeholder"),
                        capitalization = KeyboardCapitalization.Words,
                    )
                    PickerField(
                        label = tr("appointment_task_label"),
                        value = current.taskId,
                        options = state.tasks,
                        noneLabel = tr("appointment_task_none"),
                        onChange = { form = store.taskChosen(current, it) },
                        loading = state.choicesLoading,
                        error = errors["taskId"],
                    )
                    if (current.taskId.isNotEmpty()) {
                        Text(
                            tr("appointment_task_hint"),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    PickerField(
                        label = tr("appointment_asset_label"),
                        value = current.assetId,
                        options = state.assets,
                        noneLabel = tr("appointment_asset_none"),
                        onChange = { form = current.copy(assetId = it) },
                        loading = state.choicesLoading,
                        error = errors["assetId"],
                    )
                    PickerField(
                        label = tr("appointment_contact_label"),
                        value = current.contactId,
                        options = state.contacts,
                        noneLabel = tr("m_appt_contact_none"),
                        onChange = { form = current.copy(contactId = it) },
                        loading = state.choicesLoading,
                        error = errors["contactId"],
                    )
                    state.choicesError?.let {
                        Row(Modifier.fillMaxWidth()) {
                            InlineError(tr("m_appt_choices_failed"), Modifier.weight(1f))
                            TextButton(onClick = store::retry) { Text(tr("common_retry")) }
                        }
                    }
                    TextField(
                        label = tr("appointment_notes_label"),
                        value = current.notes,
                        onChange = { form = current.copy(notes = it.take(APPOINTMENT_NOTES_MAX + 50)) },
                        error = errors["notes"],
                        hint = tr("appointment_notes_hint"),
                        singleLine = false,
                        minLines = 3,
                        capitalization = KeyboardCapitalization.Sentences,
                    )
                    state.error?.let { InlineError(it.message) }
                }
            loadError != null -> ErrorBox(loadError, Modifier.padding(padding), onRetry = store::retry)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }
}

@Composable
private fun TimesFields(
    form: AppointmentForm,
    errors: Map<String, String>,
    showEndDate: Boolean,
    onForm: (AppointmentForm) -> Unit,
    onShowEndDate: (Boolean) -> Unit,
) {
    if (form.allDay) {
        DateField(
            label = tr("appointment_from_label"),
            value = form.startDate,
            onChange = { onForm(form.copy(startDate = it)) },
            error = errors["startDate"],
            clearable = false,
        )
        DateField(
            label = tr("appointment_to_label"),
            value = form.endDate,
            onChange = { onForm(form.copy(endDate = it)) },
            error = errors["endDate"],
        )
        Text(tr("appointment_to_hint"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    DateField(
        label = tr("appointment_date_label"),
        value = form.startDate,
        onChange = { onForm(form.copy(startDate = it)) },
        error = errors["startDate"],
        clearable = false,
    )
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        TimeField(
            label = tr("appointment_start_time_label"),
            value = form.startTime,
            onChange = { onForm(form.copy(startTime = it)) },
            error = errors["startTime"],
            modifier = Modifier.weight(1f),
        )
        TimeField(
            label = tr("appointment_end_time_label"),
            value = form.endTime,
            onChange = { onForm(form.copy(endTime = it)) },
            error = errors["endTime"],
            clearable = true,
            modifier = Modifier.weight(1f),
        )
    }
    if (showEndDate) {
        DateField(
            label = tr("appointment_end_date_label"),
            value = form.endDate,
            onChange = { onForm(form.copy(endDate = it)) },
            error = errors["endDate"],
            clearable = false,
        )
    }
    Text(tr("appointment_end_time_hint"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    TextButton(
        onClick = {
            if (showEndDate) onForm(form.copy(endDate = ""))
            onShowEndDate(!showEndDate)
        },
    ) { Text(tr(if (showEndDate) "appointment_end_same_day" else "appointment_end_other_day")) }
}
