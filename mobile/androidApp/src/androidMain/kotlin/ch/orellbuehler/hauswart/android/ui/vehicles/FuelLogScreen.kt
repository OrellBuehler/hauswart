package ch.orellbuehler.hauswart.android.ui.vehicles

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.LocalGasStation
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Receipt
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
import androidx.compose.ui.Alignment
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
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.inventory.ErrorEffect
import ch.orellbuehler.hauswart.android.ui.inventory.FormDialog
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.vehicles.FuelLogState
import ch.orellbuehler.hauswart.feature.vehicles.FuelLogStore
import ch.orellbuehler.hauswart.feature.vehicles.FuelPanel
import ch.orellbuehler.hauswart.feature.vehicles.FuelRow
import ch.orellbuehler.hauswart.i18n.tr

private data class FuelDialog(
    val id: String?,
)

@Composable
fun FuelLogScreen(
    nav: NavController,
    assetId: String,
) {
    val store = rememberStore(key = assetId) { FuelLogStore(it, assetId) }
    val state = store.collect()
    val snackbar = remember { SnackbarHostState() }
    var dialog by remember { mutableStateOf<FuelDialog?>(null) }
    var deleting by remember { mutableStateOf<FuelRow?>(null) }
    MessageEffect(state.notice, snackbar, store::dismissNotice)
    ErrorEffect(state.actionError, snackbar, store::dismissActionError)
    LaunchedEffect(state.done) {
        if (state.done) {
            dialog = null
            store.ackDone()
        }
    }

    fun open(id: String?) {
        store.clearForm()
        dialog = FuelDialog(id)
    }
    AppScaffold(
        title = tr("fuel_card_title"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            IconButton(onClick = { open(null) }, enabled = !state.loading && state.error == null) {
                Icon(Icons.Outlined.Add, contentDescription = tr("fuel_add"))
            }
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
                        Text(
                            tr("fuel_card_description"),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        state.panels.forEach { PanelCard(it) }
                        if (state.rows.isEmpty()) {
                            EmptyState(
                                tr("fuel_empty_title"),
                                tr("fuel_empty_body"),
                                icon = Icons.Outlined.LocalGasStation,
                                action = { TextButton(onClick = { open(null) }) { Text(tr("fuel_add")) } },
                            )
                        }
                        SectionCard {
                            state.rows.forEach { row ->
                                FuelRowItem(
                                    row,
                                    onEdit = { open(row.id) },
                                    onDelete = { deleting = row },
                                    onOpenCost = row.costEntryId?.let { id -> { nav.navigate(Routes.cost(id)) } },
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
    }
    dialog?.let { open -> FuelFormDialog(store, state, open.id) { dialog = null } }
    deleting?.let { row ->
        ConfirmDialog(
            title = tr("fuel_delete_title"),
            text = row.deleteText,
            confirmLabel = tr("common_delete"),
            destructive = true,
            onConfirm = {
                deleting = null
                store.delete(row.id)
            },
            onDismiss = { deleting = null },
        )
    }
}

@Composable
private fun PanelCard(panel: FuelPanel) {
    SectionCard {
        Column(Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(tr("fuel_avg_title"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (panel.average != null) {
                Text(panel.average!!, style = MaterialTheme.typography.headlineSmall)
                panel.stretches?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                Sparkline(panel.consumptionSpark)
                panel.consumptionRange?.let { Text(it, style = MaterialTheme.typography.labelSmall) }
            } else {
                Text(tr("fuel_avg_none"), style = MaterialTheme.typography.titleSmall)
                Text(
                    tr("fuel_avg_none_hint"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                panel.priceTitle,
                Modifier.padding(top = 8.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (panel.price != null) {
                Text(panel.price!!, style = MaterialTheme.typography.headlineSmall)
                Sparkline(panel.priceSpark)
                panel.priceRange?.let { Text(it, style = MaterialTheme.typography.labelSmall) }
            } else {
                Text(tr("fuel_price_none"), style = MaterialTheme.typography.titleSmall)
            }
        }
    }
}

@Composable
private fun FuelRowItem(
    row: FuelRow,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onOpenCost: (() -> Unit)?,
) {
    var menu by remember { mutableStateOf(false) }
    ListRow(
        title = row.dateText,
        subtitle = listOfNotNull(row.place, row.quantityLine, row.stretchLine, row.notes).joinToString("\n"),
        subtitleLines = 4,
        leading = { RowIcon(Icons.Outlined.LocalGasStation) },
        trailing = {
            Column(horizontalAlignment = Alignment.End) {
                Text(row.amountText, style = MaterialTheme.typography.bodyMedium)
                row.rateText?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (row.partial) StatusChip(tr("fuel_partial"))
                if (row.missedPrevious) StatusChip(tr("fuel_missed_badge"))
            }
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
                if (onOpenCost != null) {
                    DropdownMenuItem(
                        text = { Text(tr("fuel_cost_entry_open")) },
                        leadingIcon = { Icon(Icons.Outlined.Receipt, contentDescription = null) },
                        onClick = {
                            menu = false
                            onOpenCost()
                        },
                    )
                }
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
    )
}

@Composable
private fun FuelFormDialog(
    store: FuelLogStore,
    state: FuelLogState,
    id: String?,
    onDismiss: () -> Unit,
) {
    var form by remember { mutableStateOf(if (id == null) store.newForm() else store.editForm(id) ?: store.newForm()) }
    val view = store.view(form, id)
    val errors = state.fieldErrors
    FormDialog(
        title = tr(if (id == null) "fuel_create_title" else "fuel_edit_title"),
        onDismiss = onDismiss,
        onSave = { store.save(id, form) },
        pending = state.saving,
        saveLabel = tr(if (id == null) "fuel_save" else "common_save"),
    ) {
        Text(tr("fuel_form_description"), style = MaterialTheme.typography.bodySmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextField(view.amountLabel, form.amount, {
                form = form.copy(amount = it)
            }, Modifier.weight(1f), error = errors["amountMinor"], keyboardType = KeyboardType.Decimal)
            TextField(view.quantityLabel, form.quantity, {
                form = form.copy(quantity = it)
            }, Modifier.weight(1f), error = errors["quantity"], keyboardType = KeyboardType.Decimal)
        }
        TextField(view.odometerLabel, form.odometer, {
            form = form.copy(odometer = it)
        }, error = errors["odometer"], hint = state.readingHint, keyboardType = KeyboardType.Decimal)
        SwitchField(tr("fuel_full_tank"), form.fullTank, { form = form.copy(fullTank = it) }, hint = tr("fuel_full_tank_hint"))
        DateField(tr("fuel_date"), form.date, { form = form.copy(date = it) }, error = errors["date"], clearable = false)
        if (view.showBook) {
            ChoiceField(
                label = tr("cost_book"),
                value = form.bookId,
                options = store.bookChoices(id).pairs(),
                onChange = { form = store.withBook(form, it, creating = id == null) },
                error = errors["bookId"],
            )
            Text(tr("fuel_book_hint"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        ChoiceField(tr("fuel_unit"), form.unit, store.unitChoices().pairs(), { form = form.copy(unit = it) }, error = errors["unit"])
        TextField(tr("fuel_station"), form.station, {
            form = form.copy(station = it)
        }, error = errors["station"], hint = tr("fuel_station_placeholder"))
        SwitchField(tr("fuel_missed_previous"), form.missedPrevious, {
            form = form.copy(missedPrevious = it)
        }, hint = tr("fuel_missed_previous_hint"))
        TextField(tr("fuel_notes"), form.notes, { form = form.copy(notes = it) }, error = errors["notes"], singleLine = false, minLines = 2)
        ChoiceField(tr("cost_paid_by"), form.paidByUserId, store.payerChoices(id != null).pairs(), {
            form = form.copy(paidByUserId = it)
        }, error = errors["paidByUserId"])
        TextField(tr("cost_currency"), form.currency, { form = store.withCurrency(form, it) }, error = errors["currency"])
        if (view.showSplit) {
            ChoiceField(tr("cost_split"), form.splitMode, store.splitChoices().pairs(), {
                form = store.withSplitMode(form, it)
            }, error = errors["splitMode"])
            Text(view.splitHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (view.showShares) {
                state.people.forEach { person ->
                    TextField(
                        label = tr("cost_shares_person", "name" to person.label),
                        value = form.shares[person.value].orEmpty(),
                        onChange = { form = store.withShare(form, person.value, it) },
                        keyboardType = KeyboardType.Decimal,
                    )
                }
                OutlinedButton(onClick = { form = store.equalizeShares(form) }) { Text(tr("cost_shares_equalize"), maxLines = 1) }
                view.sharesStatus?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                errors["shares"]?.let { InlineError(it) }
            }
        }
        view.costEntryHint?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        state.formError?.let { InlineError(it.message) }
    }
}
