package ch.orellbuehler.hauswart.android.ui.vehicles

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import ch.orellbuehler.hauswart.android.ui.components.DateField
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PrimaryButton
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.vehicles.VehicleSetupForm
import ch.orellbuehler.hauswart.feature.vehicles.VehicleSetupRow
import ch.orellbuehler.hauswart.feature.vehicles.VehicleSetupStore
import ch.orellbuehler.hauswart.i18n.tr

/** Sets up the recurring tasks of a vehicle from templates: tires, service, inspection, vignette, tax and more. */
@Composable
fun VehicleSetupScreen(
    nav: NavController,
    assetId: String,
) {
    val store = rememberStore(key = assetId) { VehicleSetupStore(it, assetId) }
    val state = store.collect()
    val snackbar = remember { SnackbarHostState() }
    val initial = state.initial
    val loadError = state.loadError
    var form by remember(initial) { mutableStateOf(initial) }
    MessageEffect(state.notice, snackbar, store::dismissNotice)
    AppScaffold(
        title = tr("m_vehicle_setup_title"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
    ) { padding ->
        val current = form
        when {
            current != null ->
                Column(
                    Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(ScreenPadding),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(tr("vehicle_setup_description", "name" to state.assetName), style = MaterialTheme.typography.bodyMedium)
                    state.rows.forEach { row ->
                        SetupRowCard(store, state.fieldErrors, state.unit, state.firstRegistration != null, row, current) {
                            form =
                                it
                        }
                    }
                    if (state.nothingLeft) Text(tr("vehicle_setup_nothing_left"), style = MaterialTheme.typography.bodyMedium)
                    state.message?.let { InlineError(it) }
                    PrimaryButton(
                        text = tr("vehicle_setup_submit"),
                        pendingText = tr("vehicle_setup_pending"),
                        onClick = { store.submit(current) },
                        pending = state.running,
                        enabled = !state.nothingLeft,
                    )
                }
            loadError != null -> ErrorBox(loadError, Modifier.padding(padding), onRetry = store::retry)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }
}

@Composable
private fun SetupRowCard(
    store: VehicleSetupStore,
    errors: Map<String, String>,
    unit: String,
    knownRegistration: Boolean,
    row: VehicleSetupRow,
    form: VehicleSetupForm,
    onChange: (VehicleSetupForm) -> Unit,
) {
    val params = form.params
    val on = row.id in form.selected && !row.locked
    SectionCard {
        Column(Modifier.padding(horizontal = ScreenPadding, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Checkbox(
                    checked = on,
                    onCheckedChange = { onChange(store.withSelected(form, row.id, it)) },
                    enabled = !row.locked && row.state != "running",
                )
                Text(row.title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, maxLines = 2)
                when {
                    row.existingTitle != null -> StatusChip(tr("vehicle_setup_exists"))
                    row.state == "created" -> StatusChip(tr("vehicle_setup_created"), tone = "ok")
                    row.state == "running" -> StatusChip(tr("vehicle_setup_running"))
                }
            }
            if (row.existingTitle != null) {
                Text(tr("vehicle_setup_exists_hint", "title" to row.existingTitle!!), style = MaterialTheme.typography.bodySmall)
            } else {
                store.summary(row.id, form)?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                row.preparations.forEach {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            row.error?.let { InlineError(it) }
            row.preparationErrors.forEach { InlineError(it) }
            if (on) {
                when (row.id) {
                    "service" -> {
                        TextField(
                            tr("vehicle_setup_service_distance", "unit" to unit),
                            params.serviceDistance,
                            { onChange(form.copy(params = params.copy(serviceDistance = it))) },
                            error = errors["serviceDistance"],
                            keyboardType = KeyboardType.Decimal,
                        )
                        TextField(
                            tr("vehicle_setup_service_months"),
                            params.serviceMonths,
                            { onChange(form.copy(params = params.copy(serviceMonths = it))) },
                            error = errors["serviceMonths"],
                            keyboardType = KeyboardType.Number,
                        )
                    }
                    "mfk" ->
                        DateField(
                            tr("vehicle_setup_mfk_date"),
                            params.mfkDate,
                            { onChange(form.copy(params = params.copy(mfkDate = it))) },
                            error = errors["mfkDate"],
                            clearable = false,
                        )
                    "vehicle_tax" -> {
                        TextField(
                            tr("vehicle_setup_month"),
                            params.taxMonth,
                            { onChange(form.copy(params = params.copy(taxMonth = it))) },
                            error = errors["taxMonth"],
                            keyboardType = KeyboardType.Number,
                        )
                        TextField(
                            tr("vehicle_setup_day"),
                            params.taxDay,
                            { onChange(form.copy(params = params.copy(taxDay = it))) },
                            error = errors["taxDay"],
                            hint = tr("vehicle_setup_tax_hint"),
                            keyboardType = KeyboardType.Number,
                        )
                    }
                    "brake_fluid" ->
                        DateField(
                            tr("vehicle_setup_last_done"),
                            params.brakeFluidLastDone,
                            { onChange(form.copy(params = params.copy(brakeFluidLastDone = it))) },
                            error = errors["brakeFluidLastDone"],
                        )
                    "ac_service" ->
                        DateField(
                            tr("vehicle_setup_last_done"),
                            params.acServiceLastDone,
                            { onChange(form.copy(params = params.copy(acServiceLastDone = it))) },
                            error = errors["acServiceLastDone"],
                        )
                }
                if (row.id == "mfk" && !knownRegistration) Text(tr("vehicle_setup_mfk_unknown"), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
