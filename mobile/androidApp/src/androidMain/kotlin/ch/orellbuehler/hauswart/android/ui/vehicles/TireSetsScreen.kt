package ch.orellbuehler.hauswart.android.ui.vehicles

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.TireRepair
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.DateField
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.RowIcon
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.inventory.ErrorEffect
import ch.orellbuehler.hauswart.android.ui.inventory.FormDialog
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.vehicles.TireSetRow
import ch.orellbuehler.hauswart.feature.vehicles.TireSetsState
import ch.orellbuehler.hauswart.feature.vehicles.TireSetsStore
import ch.orellbuehler.hauswart.i18n.tr

private sealed interface TireDialog {
    data class SetForm(
        val id: String?,
    ) : TireDialog

    data class Mount(
        val id: String,
    ) : TireDialog

    data class Measure(
        val id: String,
    ) : TireDialog
}

@Composable
fun TireSetsScreen(
    nav: NavController,
    assetId: String,
) {
    val store = rememberStore(key = assetId) { TireSetsStore(it, assetId) }
    val state = store.collect()
    val snackbar = remember { SnackbarHostState() }
    var dialog by remember { mutableStateOf<TireDialog?>(null) }
    var deleting by remember { mutableStateOf<TireSetRow?>(null) }
    var retiring by remember { mutableStateOf<TireSetRow?>(null) }
    MessageEffect(state.notice, snackbar, store::dismissNotice)
    ErrorEffect(state.actionError, snackbar, store::dismissActionError)
    LaunchedEffect(state.done) {
        if (state.done) {
            dialog = null
            store.ackDone()
        }
    }

    fun open(next: TireDialog) {
        store.clearForm()
        if (next is TireDialog.SetForm) store.prepareForm()
        dialog = next
    }
    AppScaffold(
        title = tr("tire_card_title"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            IconButton(onClick = { open(TireDialog.SetForm(null)) }) { Icon(Icons.Outlined.Add, contentDescription = tr("tire_add")) }
        },
    ) { padding ->
        val error = state.error
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    Column(
                        Modifier.verticalScroll(rememberScrollState()).padding(ScreenPadding),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        state.summary?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                        if (state.warnings.isNotEmpty()) {
                            SectionCard(title = tr("tire_alert_title")) {
                                state.warnings.forEach {
                                    Text(
                                        it,
                                        Modifier.padding(horizontal = ScreenPadding, vertical = 4.dp),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.error,
                                    )
                                }
                            }
                        }
                        if (state.rows.isEmpty()) {
                            EmptyState(
                                tr("tire_empty_title"),
                                tr("tire_empty_body"),
                                icon = Icons.Outlined.TireRepair,
                                action = { TextButton(onClick = { open(TireDialog.SetForm(null)) }) { Text(tr("tire_add")) } },
                            )
                        }
                        state.visible.forEach { row ->
                            TireSetCard(
                                row,
                                onOpen = { nav.openTireSet(assetId, row.id) },
                                onEdit = { open(TireDialog.SetForm(row.id)) },
                                onMount = { open(TireDialog.Mount(row.id)) },
                                onMeasure = { open(TireDialog.Measure(row.id)) },
                                onRetire = { if (row.mounted) retiring = row else store.setRetired(row.id, true) },
                                onRestore = { store.setRetired(row.id, false) },
                                onDelete = { deleting = row },
                            )
                        }
                        if (state.retiredCount > 0) {
                            TextButton(onClick = store::toggleRetired) {
                                Text(
                                    state.retiredToggle,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                }
        }
    }
    when (val open = dialog) {
        is TireDialog.SetForm -> TireSetFormDialog(store, state, open.id) { dialog = null }
        is TireDialog.Mount -> TireMountDialog(store, state, open.id) { dialog = null }
        is TireDialog.Measure -> TireMeasureDialog(store, state, open.id) { dialog = null }
        null -> Unit
    }
    deleting?.let { row ->
        ConfirmDialog(
            title = tr("tire_delete_title"),
            text = tr("tire_delete_description", "name" to row.title),
            confirmLabel = tr("common_delete"),
            destructive = true,
            onConfirm = {
                deleting = null
                store.delete(row.id)
            },
            onDismiss = { deleting = null },
        )
    }
    retiring?.let { row ->
        ConfirmDialog(
            title = tr("tire_retire_title"),
            text = tr("tire_retire_description", "name" to row.title),
            confirmLabel = tr("tire_retire"),
            onConfirm = {
                retiring = null
                store.setRetired(row.id, true)
            },
            onDismiss = { retiring = null },
        )
    }
}

@Composable
private fun TireSetCard(
    row: TireSetRow,
    onOpen: () -> Unit,
    onEdit: () -> Unit,
    onMount: () -> Unit,
    onMeasure: () -> Unit,
    onRetire: () -> Unit,
    onRestore: () -> Unit,
    onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    SectionCard {
        ListRow(
            title = row.title,
            subtitle = row.make.ifEmpty { null },
            leading = { RowIcon(Icons.Outlined.TireRepair) },
            trailing = {
                row.badge?.let { StatusChip(it, tone = if (row.mounted) "ok" else "muted") }
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = row.actionsLabel) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text(tr("common_edit")) },
                        leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                        onClick = {
                            menu = false
                            onEdit()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text(tr(if (row.retired) "tire_unretire" else "tire_retire")) },
                        leadingIcon = {
                            Icon(
                                if (row.retired) Icons.Outlined.Unarchive else Icons.Outlined.Archive,
                                contentDescription = null,
                            )
                        },
                        onClick = {
                            menu = false
                            if (row.retired) onRestore() else onRetire()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text(tr("common_delete")) },
                        leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                        onClick = {
                            menu = false
                            onDelete()
                        },
                    )
                }
            },
            onClick = onOpen,
        )
        FactRows(row.facts)
        row.notes?.let {
            Text(it, Modifier.padding(horizontal = ScreenPadding, vertical = 4.dp), style = MaterialTheme.typography.bodySmall)
        }
        if (row.canMount || row.canMeasure) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = ScreenPadding, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (row.canMount) OutlinedButton(onClick = onMount) { Text(tr("tire_mount"), maxLines = 1) }
                if (row.canMeasure) OutlinedButton(onClick = onMeasure) { Text(tr("tire_measure"), maxLines = 1) }
            }
        }
    }
}

@Composable
private fun TireSetFormDialog(
    store: TireSetsStore,
    state: TireSetsState,
    id: String?,
    onDismiss: () -> Unit,
) {
    var form by remember { mutableStateOf(if (id == null) store.blankForm("winter") else store.editForm(id) ?: store.blankForm("winter")) }
    val errors = state.fieldErrors
    FormDialog(
        title = tr(if (id == null) "tire_form_create_title" else "tire_form_edit_title"),
        onDismiss = onDismiss,
        onSave = { store.save(id, form) },
        pending = state.saving,
        saveLabel = tr(if (id == null) "common_create" else "common_save"),
    ) {
        Text(tr("tire_form_description"), style = MaterialTheme.typography.bodySmall)
        ChoiceField(
            label = tr("tire_season"),
            value = form.season,
            options = store.seasonChoices().pairs(),
            onChange = { form = store.withSeason(form, it) },
            error = errors["season"],
        )
        TextField(tr("tire_brand"), form.brand, { form = form.copy(brand = it) }, error = errors["brand"])
        TextField(tr("tire_model"), form.model, { form = form.copy(model = it) }, error = errors["model"])
        TextField(
            tr("tire_size"),
            form.size,
            { form = form.copy(size = it) },
            error = errors["size"],
            hint = tr("vehicle_tire_placeholder"),
        )
        TextField(
            tr("tire_dot"),
            form.dot,
            { form = form.copy(dot = it) },
            error = errors["dot"],
            hint = tr("tire_dot_hint"),
            keyboardType = KeyboardType.Number,
        )
        if (id == null) {
            TextField(
                tr("tire_tread_first"),
                form.treadDepth,
                { form = form.copy(treadDepth = it) },
                error = errors["treadDepthMm"],
                hint = tr("tire_tread_first_hint"),
                keyboardType = KeyboardType.Decimal,
            )
            if (form.treadDepth.isNotBlank()) {
                DateField(tr("tire_tread_date"), form.treadMeasuredOn, {
                    form = form.copy(treadMeasuredOn = it)
                }, error = errors["treadMeasuredOn"], clearable = false)
            }
        }
        TextField(tr("tire_storage"), form.storageLocation, {
            form = form.copy(storageLocation = it)
        }, error = errors["storageLocation"], hint = tr("tire_storage_placeholder"))
        ChoiceField(
            label = tr("tire_storage_contact"),
            value = form.storageContactId,
            options = state.contacts.pairs().ifEmpty { listOf("" to tr("m_vehicle_none")) },
            onChange = { form = form.copy(storageContactId = it) },
            error = errors["storageContactId"],
        )
        DateField(tr("tire_purchased"), form.purchasedOn, { form = form.copy(purchasedOn = it) }, error = errors["purchasedOn"])
        TextField(tr("tire_notes"), form.notes, { form = form.copy(notes = it) }, error = errors["notes"], singleLine = false, minLines = 3)
        state.formError?.let { InlineError(it.message) }
    }
}

@Composable
private fun TireMountDialog(
    store: TireSetsStore,
    state: TireSetsState,
    id: String,
    onDismiss: () -> Unit,
) {
    var form by remember { mutableStateOf(store.blankMountForm()) }
    FormDialog(
        title = tr("tire_mount_title"),
        onDismiss = onDismiss,
        onSave = { store.mount(id, form) },
        pending = state.saving,
        saveLabel = tr("tire_mount_submit"),
    ) {
        Text(tr("tire_mount_description", "name" to store.titleOf(id)), style = MaterialTheme.typography.bodySmall)
        DateField(
            tr("tire_mount_date"),
            form.date,
            { form = form.copy(date = it) },
            error = state.fieldErrors["date"],
            clearable = false,
        )
        TextField(
            tr("vehicle_odometer_value", "unit" to state.unit),
            form.odometer,
            { form = form.copy(odometer = it) },
            error = state.fieldErrors["odometer"],
            hint = state.readingHint,
            keyboardType = KeyboardType.Decimal,
        )
        state.formError?.let { InlineError(it.message) }
    }
}

@Composable
private fun TireMeasureDialog(
    store: TireSetsStore,
    state: TireSetsState,
    id: String,
    onDismiss: () -> Unit,
) {
    var form by remember { mutableStateOf(store.blankTreadForm()) }
    FormDialog(
        title = tr("tire_tread_title"),
        onDismiss = onDismiss,
        onSave = { store.measure(id, form) },
        pending = state.saving,
    ) {
        Text(tr("tire_tread_description", "name" to store.titleOf(id)), style = MaterialTheme.typography.bodySmall)
        TextField(
            tr("tire_tread_depth"),
            form.depth,
            { form = form.copy(depth = it) },
            error = state.fieldErrors["treadDepthMm"],
            hint = state.treadHint,
            keyboardType = KeyboardType.Decimal,
        )
        DateField(tr("tire_tread_date"), form.date, { form = form.copy(date = it) }, error = state.fieldErrors["date"], clearable = false)
        TextField(
            tr("vehicle_odometer_value", "unit" to state.unit),
            form.odometer,
            { form = form.copy(odometer = it) },
            error = state.fieldErrors["odometer"],
            hint = state.readingHint,
            keyboardType = KeyboardType.Decimal,
        )
        state.formError?.let { InlineError(it.message) }
    }
}
