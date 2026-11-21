package ch.orellbuehler.hauswart.android.ui.parts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.MoneyField
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.inventory.FormDialog
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.feature.parts.PART_MOVEMENT_REASONS
import ch.orellbuehler.hauswart.feature.parts.PartAssetLinkStore
import ch.orellbuehler.hauswart.feature.parts.PartEditStore
import ch.orellbuehler.hauswart.feature.parts.PartOrderedStore
import ch.orellbuehler.hauswart.feature.parts.PartStockStore
import ch.orellbuehler.hauswart.feature.parts.PartTaskLinkStore
import ch.orellbuehler.hauswart.feature.parts.PartTaskQtyStore
import ch.orellbuehler.hauswart.feature.parts.partMovementReasonLabel
import ch.orellbuehler.hauswart.i18n.tr

private val FieldGap = Arrangement.spacedBy(12.dp)

@Composable
private fun LoadFailure(
    error: UiError,
    retry: () -> Unit,
) {
    InlineError(error.message)
    TextButton(onClick = retry) { Text(tr("common_retry")) }
}

/** Creates a part ([id] null) or edits one; [onSaved] gets the id. [nonce] tells two openings apart. */
@Composable
internal fun PartFormDialog(
    id: String?,
    nonce: Int,
    onDismiss: () -> Unit,
    onSaved: (String) -> Unit,
) {
    val store = rememberStore(key = "part-form-${id ?: "new"}-$nonce") { PartEditStore(it, id) }
    val state = store.collect()
    val initial = state.initial
    var form by remember(initial) { mutableStateOf(initial) }
    LaunchedEffect(state.savedId) { state.savedId?.let(onSaved) }
    FormDialog(
        title = tr(if (state.isNew) "part_create_title" else "part_edit_title"),
        onDismiss = onDismiss,
        onSave = { form?.let(store::save) },
        pending = state.saving || form == null,
        saveLabel = tr(if (state.isNew) "common_create" else "common_save"),
    ) {
        val current = form
        when {
            current != null -> {
                Text(
                    tr(if (state.isNew) "part_create_description" else "part_edit_description"),
                    style = MaterialTheme.typography.bodyMedium,
                )
                TextField(
                    label = tr("part_name"),
                    value = current.name,
                    onChange = { form = current.copy(name = it) },
                    error = state.fieldErrors["name"],
                    capitalization = KeyboardCapitalization.Sentences,
                )
                TextField(
                    label = tr("part_number"),
                    value = current.partNumber,
                    onChange = { form = current.copy(partNumber = it) },
                    error = state.fieldErrors["partNumber"],
                )
                TextField(
                    label = tr("part_supplier"),
                    value = current.supplier,
                    onChange = { form = current.copy(supplier = it) },
                    error = state.fieldErrors["supplier"],
                    capitalization = KeyboardCapitalization.Words,
                )
                TextField(
                    label = tr("part_shop_url"),
                    value = current.shopUrl,
                    onChange = { form = current.copy(shopUrl = it) },
                    error = state.fieldErrors["shopUrl"],
                    keyboardType = KeyboardType.Uri,
                )
                MoneyField(
                    label = tr("part_unit_price"),
                    value = current.price,
                    onChange = { form = current.copy(price = it) },
                    currency = state.currency,
                    error = state.fieldErrors["unitPriceMinor"],
                )
                if (state.isNew) {
                    NumberInput(tr("part_initial_stock"), current.stockCount, state.fieldErrors["stockCount"]) {
                        form =
                            current.copy(stockCount = it)
                    }
                }
                NumberInput(tr("part_min_stock"), current.minStock, state.fieldErrors["minStock"]) { form = current.copy(minStock = it) }
                NumberInput(tr("part_reorder_qty"), current.reorderQty, state.fieldErrors["reorderQty"]) {
                    form =
                        current.copy(reorderQty = it)
                }
                NumberInput(tr("part_lead_time"), current.leadTimeDays, state.fieldErrors["leadTimeDays"]) {
                    form =
                        current.copy(leadTimeDays = it)
                }
                Text(
                    tr("part_stock_fields_hint"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextField(
                    label = tr("part_notes"),
                    value = current.notes,
                    onChange = { form = current.copy(notes = it) },
                    error = state.fieldErrors["notes"],
                    singleLine = false,
                    minLines = 3,
                    capitalization = KeyboardCapitalization.Sentences,
                )
                state.error?.let { InlineError(it.message) }
            }
            state.loadError != null -> LoadFailure(state.loadError!!, store::retry)
            else -> LoadingBox()
        }
    }
}

@Composable
private fun NumberInput(
    label: String,
    value: String,
    error: String?,
    onChange: (String) -> Unit,
) {
    TextField(label = label, value = value, onChange = onChange, error = error, keyboardType = KeyboardType.Number)
}

/** Books a stock movement. */
@Composable
internal fun PartStockDialog(
    id: String,
    reason: String,
    qty: Long,
    nonce: Int,
    onDismiss: () -> Unit,
) {
    val store = rememberStore(key = "part-stock-$id-$nonce") { PartStockStore(it, id, reason, qty) }
    val state = store.collect()
    val initial = state.initial
    var form by remember(initial) { mutableStateOf(initial) }
    LaunchedEffect(state.done) { if (state.done) onDismiss() }
    FormDialog(
        title = tr("part_stock_dialog_title"),
        onDismiss = onDismiss,
        onSave = { form?.let(store::save) },
        pending = state.saving || form == null,
        saveLabel = tr("part_stock_submit"),
    ) {
        val current = form
        when {
            current != null -> {
                Text(state.intro, style = MaterialTheme.typography.bodyMedium)
                ChoiceField(
                    label = tr("part_stock_reason"),
                    value = current.reason,
                    options = PART_MOVEMENT_REASONS.map { it to partMovementReasonLabel(it) },
                    onChange = { form = current.copy(reason = it) },
                )
                if (current.reason == "correction") {
                    ChoiceField(
                        label = tr("part_stock_direction"),
                        value = current.direction,
                        options = listOf("more" to tr("part_stock_more"), "less" to tr("part_stock_less")),
                        onChange = { form = current.copy(direction = it) },
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    IconButton(onClick = { form = store.step(current, -1) }) {
                        Icon(Icons.Outlined.Remove, contentDescription = tr("part_stock_decrease"))
                    }
                    TextField(
                        label = tr("part_stock_qty"),
                        value = current.qty,
                        onChange = { form = current.copy(qty = it) },
                        error = state.fieldErrors["delta"],
                        keyboardType = KeyboardType.Number,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(onClick = { form = store.step(current, 1) }) {
                        Icon(Icons.Outlined.Add, contentDescription = tr("part_stock_increase"))
                    }
                }
                Text(store.resultText(current), style = MaterialTheme.typography.bodyMedium)
                TextField(
                    label = tr("part_stock_note"),
                    value = current.note,
                    onChange = { form = current.copy(note = it) },
                    error = state.fieldErrors["note"],
                    capitalization = KeyboardCapitalization.Sentences,
                )
                state.error?.let { InlineError(it.message) }
            }
            state.loadError != null -> LoadFailure(state.loadError!!, store::retry)
            else -> LoadingBox()
        }
    }
}

/** Marks a part as ordered. */
@Composable
internal fun PartOrderedDialog(
    id: String,
    nonce: Int,
    onDismiss: () -> Unit,
) {
    val store = rememberStore(key = "part-ordered-$id-$nonce") { PartOrderedStore(it, id) }
    val state = store.collect()
    var qty by remember(state.initialQty) { mutableStateOf(state.initialQty) }
    LaunchedEffect(state.done) { if (state.done) onDismiss() }
    FormDialog(
        title = tr("part_ordered_dialog_title"),
        onDismiss = onDismiss,
        onSave = { store.save(qty) },
        pending = state.saving || state.loading,
        saveLabel = tr("part_ordered_submit"),
    ) {
        when {
            state.loading && state.loadError == null -> LoadingBox()
            state.loadError != null -> LoadFailure(state.loadError!!, store::retry)
            else -> {
                Text(state.intro, style = MaterialTheme.typography.bodyMedium)
                TextField(
                    label = tr("part_ordered_qty"),
                    value = qty,
                    onChange = { qty = it },
                    error = state.fieldErrors["qty"],
                    keyboardType = KeyboardType.Number,
                )
                state.error?.let { InlineError(it.message) }
            }
        }
    }
}

/** Picks a device to link the part to. */
@Composable
internal fun PartAssetLinkDialog(
    partId: String,
    nonce: Int,
    onDismiss: () -> Unit,
) {
    val store = rememberStore(key = "part-asset-link-$partId-$nonce") { PartAssetLinkStore(it, partId) }
    val state = store.collect()
    var chosen by remember { mutableStateOf("") }
    LaunchedEffect(state.done) { if (state.done) onDismiss() }
    FormDialog(
        title = tr("part_link_asset_title"),
        onDismiss = onDismiss,
        onSave = { store.link(chosen) },
        pending = state.saving || state.loading,
        saveLabel = tr("part_link_submit"),
    ) {
        Column(verticalArrangement = FieldGap) {
            Text(tr("part_link_asset_description"), style = MaterialTheme.typography.bodyMedium)
            when {
                state.loading && state.loadError == null -> LoadingBox()
                state.loadError != null -> LoadFailure(state.loadError!!, store::retry)
                state.options.isEmpty() -> Text(tr("part_link_asset_empty"))
                else -> ChoiceList(state.options, chosen) { chosen = it }
            }
            state.fieldErrors["choice"]?.let { InlineError(it) }
            state.error?.let { InlineError(it.message) }
        }
    }
}

/** Picks a task to link the part to and how many pieces a completion uses. */
@Composable
internal fun PartTaskLinkDialog(
    partId: String,
    nonce: Int,
    onDismiss: () -> Unit,
) {
    val store = rememberStore(key = "part-task-link-$partId-$nonce") { PartTaskLinkStore(it, partId) }
    val state = store.collect()
    var chosen by remember { mutableStateOf("") }
    var qty by remember(state.initialQty) { mutableStateOf(state.initialQty) }
    LaunchedEffect(state.done) { if (state.done) onDismiss() }
    FormDialog(
        title = tr("part_link_task_title"),
        onDismiss = onDismiss,
        onSave = { store.link(chosen, qty) },
        pending = state.saving || state.loading,
        saveLabel = tr("part_link_submit"),
    ) {
        Column(verticalArrangement = FieldGap) {
            Text(tr("task_part_link_description"), style = MaterialTheme.typography.bodyMedium)
            when {
                state.loading && state.loadError == null -> LoadingBox()
                state.loadError != null -> LoadFailure(state.loadError!!, store::retry)
                state.options.isEmpty() -> Text(tr("part_link_task_empty"))
                else -> ChoiceList(state.options, chosen) { chosen = it }
            }
            state.fieldErrors["choice"]?.let { InlineError(it) }
            TextField(
                label = tr("task_part_qty"),
                value = qty,
                onChange = { qty = it },
                error = state.fieldErrors["qty"],
                hint = tr("task_part_qty_hint"),
                keyboardType = KeyboardType.Number,
            )
            state.error?.let { InlineError(it.message) }
        }
    }
}

/** Changes how many pieces a task uses. */
@Composable
internal fun PartTaskQtyDialog(
    partId: String,
    taskId: String,
    title: String,
    initialQty: Long,
    nonce: Int,
    onDismiss: () -> Unit,
) {
    val store = rememberStore(key = "part-task-qty-$partId-$taskId-$nonce") { PartTaskQtyStore(it, partId, taskId, title) }
    val state = store.collect()
    var qty by remember { mutableStateOf(initialQty.toString()) }
    LaunchedEffect(state.done) { if (state.done) onDismiss() }
    FormDialog(
        title = tr("task_part_edit_title"),
        onDismiss = onDismiss,
        onSave = { store.save(qty) },
        pending = state.saving,
    ) {
        Column(verticalArrangement = FieldGap) {
            Text(state.intro, style = MaterialTheme.typography.bodyMedium)
            TextField(
                label = tr("task_part_qty"),
                value = qty,
                onChange = { qty = it },
                error = state.fieldErrors["qty"],
                hint = tr("task_part_qty_hint"),
                keyboardType = KeyboardType.Number,
            )
            state.error?.let { InlineError(it.message) }
        }
    }
}
