package ch.orellbuehler.hauswart.android.ui.vehicles

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.DateField
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.RowIcon
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.inventory.ErrorEffect
import ch.orellbuehler.hauswart.android.ui.inventory.FormDialog
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.vehicles.OdometerLine
import ch.orellbuehler.hauswart.feature.vehicles.OdometerRecordStore
import ch.orellbuehler.hauswart.feature.vehicles.OdometerStore
import ch.orellbuehler.hauswart.i18n.tr

/** The dialog that records an odometer reading. Compose it while it is open; it loads the vehicle when it appears. */
@Composable
internal fun OdometerRecordDialog(
    assetId: String,
    onDismiss: () -> Unit,
    onSaved: (String) -> Unit = {},
) {
    val store = rememberStore(key = "record-$assetId") { OdometerRecordStore(it, assetId) }
    val state = store.collect()
    LaunchedEffect(Unit) { store.reset() }
    LaunchedEffect(state.savedText) {
        val text = state.savedText ?: return@LaunchedEffect
        store.ackSaved()
        onSaved(text)
        onDismiss()
    }
    val initial = state.initial
    var form by remember(initial) { mutableStateOf(initial) }
    val current = form
    FormDialog(
        title = tr("vehicle_record_odometer"),
        onDismiss = onDismiss,
        onSave = { current?.let(store::save) },
        pending = state.saving || current == null,
        saveLabel = tr(if (current != null && store.isForced(current)) "vehicle_odometer_save_anyway" else "common_save"),
    ) {
        when {
            current != null -> {
                Text(tr("vehicle_odometer_dialog_description"), style = MaterialTheme.typography.bodyMedium)
                state.refusalText?.let { InlineError(it) }
                TextField(
                    label = tr("vehicle_odometer_value", "unit" to state.unit),
                    value = current.value,
                    onChange = { form = current.copy(value = it) },
                    error = state.fieldErrors["value"],
                    hint = state.hint,
                    keyboardType = KeyboardType.Decimal,
                )
                DateField(
                    label = tr("vehicle_odometer_date"),
                    value = current.date,
                    onChange = { form = current.copy(date = it) },
                    error = state.fieldErrors["date"],
                    clearable = false,
                )
                TextField(
                    label = tr("vehicle_odometer_note"),
                    value = current.note,
                    onChange = { form = current.copy(note = it) },
                    error = state.fieldErrors["note"],
                    hint = tr("vehicle_odometer_note_placeholder"),
                )
                if (state.refusalText == null) state.error?.let { InlineError(it.message) }
            }
            state.loadError != null -> {
                InlineError(state.loadError!!.message)
                TextButton(onClick = store::reset) { Text(tr("common_retry")) }
            }
            else -> CircularProgressIndicator(Modifier.padding(16.dp))
        }
    }
}

@Composable
fun OdometerScreen(
    nav: NavController,
    assetId: String,
) {
    val store = rememberStore(key = assetId) { OdometerStore(it, assetId) }
    val state = store.collect()
    val snackbar = remember { SnackbarHostState() }
    var recording by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<OdometerLine?>(null) }
    MessageEffect(state.notice, snackbar, store::dismissNotice)
    ErrorEffect(state.actionError, snackbar, store::dismissActionError)
    AppScaffold(
        title = tr("m_vehicle_odometer_screen_title"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            IconButton(onClick = { recording = true }) { Icon(Icons.Outlined.Add, contentDescription = tr("vehicle_record_odometer")) }
        },
    ) { padding ->
        val error = state.error
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(0.dp)) {
                        if (state.lines.isEmpty()) {
                            EmptyState(
                                tr("vehicle_history_empty"),
                                tr("vehicle_odometer_none_hint"),
                                icon = Icons.Outlined.Speed,
                                action = { TextButton(onClick = { recording = true }) { Text(tr("vehicle_record_odometer")) } },
                            )
                        }
                        state.lines.forEach { line ->
                            ListRow(
                                title = line.valueText,
                                subtitle = listOfNotNull(line.dateText, line.note).joinToString(" · "),
                                subtitleLines = 2,
                                leading = { RowIcon(Icons.Outlined.Speed) },
                                trailing = {
                                    line.sourceLabel?.let { StatusChip(it) }
                                    IconButton(onClick = { deleting = line }, enabled = !state.deleting) {
                                        Icon(Icons.Outlined.Delete, contentDescription = line.deleteLabel)
                                    }
                                },
                            )
                        }
                        if (state.hasMore) {
                            TextButton(
                                onClick = store::loadMore,
                                enabled = !state.loadingMore,
                                modifier = Modifier.align(Alignment.CenterHorizontally),
                            ) { Text(tr("common_load_more")) }
                        }
                    }
                }
        }
    }
    if (recording) OdometerRecordDialog(assetId, onDismiss = { recording = false })
    deleting?.let { line ->
        ConfirmDialog(
            title = tr("vehicle_history_delete_title"),
            text = line.confirmText,
            confirmLabel = tr("common_delete"),
            destructive = true,
            onConfirm = {
                deleting = null
                store.delete(line.id)
            },
            onDismiss = { deleting = null },
        )
    }
}
