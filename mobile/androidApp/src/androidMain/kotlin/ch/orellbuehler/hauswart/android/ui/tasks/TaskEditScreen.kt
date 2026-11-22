package ch.orellbuehler.hauswart.android.ui.tasks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.SaveBar
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.tasks.ChoiceOption
import ch.orellbuehler.hauswart.feature.tasks.TaskEditStore
import ch.orellbuehler.hauswart.feature.tasks.TaskForm
import ch.orellbuehler.hauswart.feature.tasks.assignModeOptions
import ch.orellbuehler.hauswart.feature.tasks.categoryOptions
import ch.orellbuehler.hauswart.feature.tasks.notifyModeOptions
import ch.orellbuehler.hauswart.feature.tasks.preparationKindOptions
import ch.orellbuehler.hauswart.feature.tasks.priorityOptions
import ch.orellbuehler.hauswart.feature.tasks.rotationHint
import ch.orellbuehler.hauswart.feature.tasks.rotationOptions
import ch.orellbuehler.hauswart.i18n.tr
import kotlin.random.Random

private fun List<ChoiceOption>.pairs(): List<Pair<String, String>> = map { it.value to it.label }

/** Creates a task (id null, for [assetId] when given) or edits one. */
@Composable
fun TaskEditScreen(
    nav: NavController,
    id: String?,
    assetId: String?,
) {
    val store = rememberStore(key = (id ?: "new") + (assetId ?: "")) { TaskEditStore(it, id, assetId) }
    val state = store.collect()
    val initial = state.initial
    val loadError = state.loadError
    var form by remember(initial) { mutableStateOf<TaskForm?>(initial) }

    LaunchedEffect(form) { form?.let(store::preview) }
    LaunchedEffect(state.savedId) {
        val saved = state.savedId ?: return@LaunchedEffect
        nav.popBackStack()
        if (id == null) nav.navigate(Routes.task(saved))
    }

    AppScaffold(
        title = tr(if (state.isNew) "task_new" else "common_edit"),
        onBack = { nav.popBackStack() },
        bottomBar = { if (form != null) SaveBar(onSave = { form?.let(store::save) }, pending = state.saving) },
    ) { padding ->
        val current = form
        when {
            current != null ->
                Column(
                    Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(ScreenPadding),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    if (state.billManaged) Text(tr("task_bill_managed"), style = MaterialTheme.typography.bodyMedium)
                    val set = { f: TaskForm -> form = f }
                    BasicsSection(state, current, set)
                    SectionCard(title = tr("task_form_schedule")) {
                        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text(tr("task_form_schedule_description"), style = MaterialTheme.typography.bodySmall)
                            if (state.triggerEditable) {
                                TriggerEditor(
                                    form = current.trigger,
                                    today = state.today,
                                    vehicle = state.vehicleOf(current.assetId),
                                    error = { state.triggerError(it) },
                                    onChange = { set(current.withTrigger(it)) },
                                )
                                state.fieldErrors["trigger"]?.let { InlineError(it) }
                            } else {
                                Text(tr("trigger_managed"), style = MaterialTheme.typography.bodyMedium)
                                Text(state.triggerSummary, style = MaterialTheme.typography.titleSmall)
                            }
                        }
                    }
                    if (state.triggerEditable) PreviewCard(state.preview)
                    AssignmentSection(state, current, set)
                    NotificationSection(state, current, set)
                    PreparationsSection(state, current, set)
                    state.error?.let { InlineError(it.message) }
                    if (state.preparationsFailed) InlineError(tr("task_form_preparations_failed"))
                }
            loadError != null -> ErrorBox(loadError, Modifier.padding(padding), onRetry = store::retry)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }
}

@Composable
private fun BasicsSection(
    state: ch.orellbuehler.hauswart.feature.tasks.TaskEditState,
    form: TaskForm,
    set: (TaskForm) -> Unit,
) {
    SectionCard(title = tr("task_form_basics")) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val text = { name: String -> state.fieldErrors[name] }
            TextField(
                tr("task_title_label"),
                form.title,
                { set(form.withField("title", it)) },
                error = text("title"),
                capitalization = KeyboardCapitalization.Sentences,
            )
            TextField(
                tr("task_description") + " (" + tr("common_optional") + ")",
                form.description,
                { set(form.withField("description", it)) },
                error = text("descriptionMd"),
                singleLine = false,
                minLines = 3,
                capitalization = KeyboardCapitalization.Sentences,
            )
            ChoiceField(tr("task_category"), form.category, categoryOptions().pairs(), { set(form.withField("category", it)) })
            TextField(
                tr("task_effort") + " (" + tr("common_optional") + ")",
                form.effort,
                { set(form.withField("effort", it)) },
                error = text("effortMinutes"),
                hint = tr("task_effort_hint"),
                keyboardType = KeyboardType.Number,
            )
            ChoiceField(tr("task_priority"), form.priority, priorityOptions().pairs(), { set(form.withField("priority", it)) })
            ChoiceField(
                tr("task_asset"),
                form.assetId,
                listOf("" to tr("task_no_asset")) + state.assets.map { it.id to it.label },
                { set(form.withField("assetId", it)) },
                error = text("assetId"),
            )
            ChoiceField(tr("task_room"), form.roomId, state.rooms.pairs(), { set(form.withField("roomId", it)) }, error = text("roomId"))
        }
    }
}

@Composable
private fun AssignmentSection(
    state: ch.orellbuehler.hauswart.feature.tasks.TaskEditState,
    form: TaskForm,
    set: (TaskForm) -> Unit,
) {
    SectionCard(title = tr("task_assignment")) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            ChoiceField(tr("task_assignment"), form.assignMode, assignModeOptions().pairs(), { set(form.withField("assignMode", it)) })
            if (form.assignMode == "fixed") {
                ChoiceField(
                    tr("task_assignee"),
                    form.assigneeUserId,
                    listOf("" to tr("task_assignee_placeholder")) + state.people.pairs(),
                    { set(form.withField("assigneeUserId", it)) },
                    error = state.fieldErrors["assigneeUserId"],
                )
            } else if (form.assignMode == "rotate") {
                Text(tr("task_rotation_members"), style = MaterialTheme.typography.labelLarge)
                Text(
                    tr("task_rotation_hint"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                form.rotationOrder.forEachIndexed { i, userId ->
                    val name = state.people.firstOrNull { it.value == userId }?.label ?: "?"
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("${i + 1}. $name", Modifier.weight(1f), maxLines = 1)
                        IconButton(onClick = { set(form.moveRotation(i, -1)) }, enabled = i > 0) {
                            Icon(Icons.Outlined.ArrowUpward, contentDescription = tr("task_rotation_up", "name" to name))
                        }
                        IconButton(onClick = { set(form.moveRotation(i, 1)) }, enabled = i < form.rotationOrder.size - 1) {
                            Icon(Icons.Outlined.ArrowDownward, contentDescription = tr("task_rotation_down", "name" to name))
                        }
                        IconButton(onClick = { set(form.removeRotation(i)) }) {
                            Icon(Icons.Outlined.Close, contentDescription = tr("task_rotation_remove", "name" to name))
                        }
                    }
                }
                val remaining = state.people.filter { it.value !in form.rotationOrder }
                if (remaining.isNotEmpty()) {
                    ChoiceField(
                        tr("task_rotation_add"),
                        "",
                        remaining.pairs(),
                        { set(form.addRotation(it)) },
                        error = state.fieldErrors["rotationOrder"],
                    )
                } else {
                    state.fieldErrors["rotationOrder"]?.let { InlineError(it) }
                }
                ChoiceField(
                    tr("task_rotation_strategy"),
                    form.rotationStrategy,
                    rotationOptions().pairs(),
                    { set(form.withField("rotationStrategy", it)) },
                )
                Text(
                    rotationHint(form.rotationStrategy),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun NotificationSection(
    state: ch.orellbuehler.hauswart.feature.tasks.TaskEditState,
    form: TaskForm,
    set: (TaskForm) -> Unit,
) {
    SectionCard(title = tr("task_form_notifications")) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            ChoiceField(tr("task_notify"), form.notifyMode, notifyModeOptions().pairs(), { set(form.withField("notifyMode", it)) })
            TextField(
                tr("task_grace_days"),
                form.graceDays,
                { set(form.withField("graceDays", it)) },
                error = state.fieldErrors["graceDays"],
                hint = tr("task_grace_days_hint"),
                keyboardType = KeyboardType.Number,
            )
            TextField(
                tr("task_due_soon_days") + " (" + tr("common_optional") + ")",
                form.dueSoonDays,
                { set(form.withField("dueSoonDays", it)) },
                error = state.fieldErrors["dueSoonDays"],
                hint = tr("task_due_soon_days_hint", "days" to state.dueSoonDefault),
                keyboardType = KeyboardType.Number,
            )
        }
    }
}

@Composable
private fun PreparationsSection(
    state: ch.orellbuehler.hauswart.feature.tasks.TaskEditState,
    form: TaskForm,
    set: (TaskForm) -> Unit,
) {
    SectionCard(title = tr("task_preparations")) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(tr("task_preparations_description"), style = MaterialTheme.typography.bodySmall)
            if (form.preparations.isEmpty()) {
                Text(
                    tr("prep_editor_empty"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            form.preparations.forEach { prep ->
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            TextField(
                                tr("prep_editor_title"),
                                prep.title,
                                { set(form.withPreparation(prep.key, "title", it)) },
                                error = state.fieldErrors["prep.${prep.key}.title"],
                                capitalization = KeyboardCapitalization.Sentences,
                            )
                        }
                        IconButton(onClick = { set(form.removePreparation(prep.key)) }) {
                            Icon(
                                Icons.Outlined.Delete,
                                contentDescription = tr("prep_editor_remove", "title" to prep.title.ifEmpty { "?" }),
                            )
                        }
                    }
                    ChoiceField(
                        tr("prep_editor_kind"),
                        prep.kind,
                        preparationKindOptions().pairs(),
                        { set(form.withPreparation(prep.key, "kind", it)) },
                    )
                    TextField(
                        tr("prep_editor_lead"),
                        prep.leadDays,
                        { set(form.withPreparation(prep.key, "leadDays", it)) },
                        error = state.fieldErrors["prep.${prep.key}.leadDays"],
                        hint = tr("prep_editor_lead_hint"),
                        keyboardType = KeyboardType.Number,
                    )
                }
            }
            OutlinedButton(onClick = {
                set(form.addPreparation(Random.nextLong().toULong().toString(36)))
            }) { Text(tr("prep_editor_add"), maxLines = 1) }
        }
    }
}
