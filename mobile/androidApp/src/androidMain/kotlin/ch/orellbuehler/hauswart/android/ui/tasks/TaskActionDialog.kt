package ch.orellbuehler.hauswart.android.ui.tasks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ch.orellbuehler.hauswart.android.ui.LocalApp
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.DateField
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.feature.tasks.ACTION_COMPLETE
import ch.orellbuehler.hauswart.feature.tasks.ACTION_SNOOZE
import ch.orellbuehler.hauswart.feature.tasks.TaskActionForm
import ch.orellbuehler.hauswart.feature.tasks.TaskActionStore
import ch.orellbuehler.hauswart.feature.tasks.TaskNotice
import ch.orellbuehler.hauswart.feature.tasks.serviceKindOptions
import ch.orellbuehler.hauswart.i18n.tr

/**
 * The dialog that completes, skips or snoozes the task [taskId]. [onDone] gets what to tell the person
 * (and how to undo it) once the action went through; [onDismiss] closes the dialog either way.
 */
@Composable
fun TaskActionDialog(
    taskId: String,
    mode: String,
    onDismiss: () -> Unit,
    onDone: (TaskNotice) -> Unit,
) {
    val app = LocalApp.current
    val store = remember(taskId, mode) { TaskActionStore(app, taskId, mode) }
    DisposableEffect(store) { onDispose { store.close() } }
    val state = store.collect()
    var form by remember(state.initial) { mutableStateOf<TaskActionForm?>(state.initial) }
    LaunchedEffect(state.notice) {
        state.notice?.let {
            onDone(it)
            onDismiss()
        }
    }
    Dialog(onDismissRequest = { if (!state.saving) onDismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            modifier = Modifier.padding(16.dp).fillMaxWidth().imePadding(),
            shape = MaterialTheme.shapes.extraLarge,
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
        ) {
            Column(Modifier.padding(vertical = 20.dp)) {
                val current = form
                val loadError = state.loadError
                when {
                    loadError != null -> ErrorBox(loadError, Modifier.heightIn(min = 160.dp), onRetry = store::retry)
                    current == null -> CircularProgressIndicator(Modifier.padding(32.dp).align(Alignment.CenterHorizontally))
                    else -> {
                        Text(state.title, Modifier.padding(horizontal = 24.dp), style = MaterialTheme.typography.titleLarge)
                        Text(
                            state.description,
                            Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Column(
                            Modifier
                                .weight(
                                    1f,
                                    fill = false,
                                ).verticalScroll(rememberScrollState())
                                .padding(horizontal = 24.dp, vertical = 8.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            ActionFields(store, state, current) { form = it }
                        }
                        state.error?.let { InlineError(it.message, Modifier.padding(horizontal = 24.dp, vertical = 4.dp)) }
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            OutlinedButton(onClick = onDismiss, enabled = !state.saving, modifier = Modifier.weight(1f)) {
                                Text(tr("common_cancel"), maxLines = 1)
                            }
                            Button(onClick = { store.save(current) }, enabled = !state.saving, modifier = Modifier.weight(1f)) {
                                Text(if (state.saving) tr("task_completing") else state.submitLabel, maxLines = 1)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ActionFields(
    store: TaskActionStore,
    state: ch.orellbuehler.hauswart.feature.tasks.TaskActionState,
    form: TaskActionForm,
    onChange: (TaskActionForm) -> Unit,
) {
    if (state.mode == ACTION_SNOOZE) {
        Text(tr("task_snooze_quick"), style = MaterialTheme.typography.labelLarge)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            state.presets.chunked(2).forEach { pair ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    pair.forEach { preset ->
                        FilterChip(
                            selected = form.date == preset.date,
                            onClick = { onChange(form.withField("date", preset.date)) },
                            label = { Text(preset.label, maxLines = 1) },
                        )
                    }
                }
            }
        }
        DateField(tr("task_snooze_until"), form.date, {
            onChange(form.withField("date", it))
        }, error = state.fieldErrors["date"], clearable = false)
        return
    }
    if (state.mode == ACTION_COMPLETE) {
        DateField(tr("task_complete_date"), form.date, {
            onChange(form.withField("date", it))
        }, error = state.fieldErrors["date"], clearable = false)
        Text(tr("task_complete_date_hint"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        state.odometerLabel?.let { label ->
            TextField(
                label = label,
                value = form.odometer,
                onChange = { onChange(form.withField("odometer", it)) },
                error = state.fieldErrors["odometer"],
                hint = state.odometerHint,
                keyboardType = KeyboardType.Decimal,
            )
        }
    }
    TextField(
        label = tr("task_note") + " (" + tr("common_optional") + ")",
        value = form.note,
        onChange = { onChange(form.withField("note", it)) },
        singleLine = false,
        minLines = 3,
        capitalization = KeyboardCapitalization.Sentences,
    )
    if (state.canLogWork) {
        SwitchField(
            label = tr("task_service_log_toggle"),
            hint = state.serviceLogHint,
            checked = form.logWork,
            onChange = {
                if (it) store.prepareServiceLog()
                onChange(form.withField("logWork", it.toString()))
            },
        )
        if (form.logWork) ServiceLogFields(state, form, onChange)
    }
}

@Composable
private fun ServiceLogFields(
    state: ch.orellbuehler.hauswart.feature.tasks.TaskActionState,
    form: TaskActionForm,
    onChange: (TaskActionForm) -> Unit,
) {
    ChoiceField(
        tr("service_kind"),
        form.logKind,
        serviceKindOptions().map {
            it.value to it.label
        },
        { onChange(form.withField("logKind", it)) },
    )
    TextField(
        label = tr("service_title"),
        value = form.logTitle,
        onChange = { onChange(form.withField("logTitle", it)) },
        error = state.fieldErrors["logTitle"],
        capitalization = KeyboardCapitalization.Sentences,
    )
    TextField(
        label = tr("service_description") + " (" + tr("common_optional") + ")",
        value = form.logDescription,
        onChange = { onChange(form.withField("logDescription", it)) },
        singleLine = false,
        minLines = 2,
        capitalization = KeyboardCapitalization.Sentences,
    )
    if (state.logLoading) CircularProgressIndicator(Modifier.padding(8.dp))
    state.logError?.let { InlineError(it.message) }
    if (state.contacts.isNotEmpty()) {
        ChoiceField(
            tr("service_contact"),
            form.logContactId,
            state.contacts.map {
                it.value to it.label
            },
            { onChange(form.withField("logContactId", it)) },
        )
    }
    TextField(
        label = tr("service_cost", "currency" to state.currency),
        value = form.logCost,
        onChange = { onChange(form.withField("logCost", it)) },
        error = state.fieldErrors["logCost"],
        keyboardType = KeyboardType.Decimal,
    )
    if (state.notes.isNotEmpty()) {
        Text(tr("asset_notes_picker_title"), style = MaterialTheme.typography.labelLarge)
        Text(tr("asset_notes_picker_hint"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        state.notes.forEach { note ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = note.value in form.logNoteIds, onCheckedChange = { onChange(form.toggleNote(note.value)) })
                Text(note.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}
