package ch.orellbuehler.hauswart.android.ui.inventory

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.DateField
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.SaveBar
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.inventory.AssetEditStore
import ch.orellbuehler.hauswart.i18n.tr

/** Creates an asset ([id] null, starting as [kind] in [roomId]) or edits one. */
@Composable
fun AssetEditScreen(
    nav: NavController,
    id: String?,
    kind: String?,
    roomId: String?,
) {
    val store = rememberStore(key = id ?: "new-$kind-$roomId") { AssetEditStore(it, id, kind ?: "device", roomId) }
    val state = store.collect()
    val initial = state.initial
    val loadError = state.loadError
    var form by remember(initial) { mutableStateOf(initial) }
    val errors = state.fieldErrors

    LaunchedEffect(state.savedId) {
        val saved = state.savedId
        if (saved != null) {
            if (state.isNew) {
                nav.navigate(Routes.asset(saved)) {
                    popUpTo(Routes.ASSET_NEW_ROUTE) { inclusive = true }
                }
            } else {
                nav.popBackStack()
            }
        }
    }

    val current = form
    AppScaffold(
        title = tr(if (state.isNew) "inventory_create" else "common_edit"),
        onBack = { nav.popBackStack() },
        bottomBar = { if (current != null) SaveBar(onSave = { form?.let(store::save) }, pending = state.saving) },
    ) { padding ->
        when {
            current != null -> {
                val isPlant = current.kind == "plant"
                val isVehicle = current.kind == "vehicle"
                Column(
                    Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(ScreenPadding),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    TextField(
                        label = tr("asset_name"),
                        value = current.name,
                        onChange = { form = current.copy(name = it) },
                        error = errors["name"],
                        capitalization = KeyboardCapitalization.Words,
                    )
                    ChoiceField(tr("asset_kind"), current.kind, state.kindOptions.map { it.value to it.label }, {
                        form =
                            current.copy(kind = it)
                    }, error = errors["kind"])
                    ChoiceField(tr("asset_room"), current.roomId, state.roomOptions.map { it.value to it.label }, {
                        form =
                            current.copy(roomId = it)
                    }, error = errors["roomId"])
                    if (!isPlant) {
                        TextField(
                            label = tr("asset_category"),
                            value = current.category,
                            onChange = { form = current.copy(category = it) },
                            error = errors["category"],
                            hint = tr("asset_category_placeholder"),
                            capitalization = KeyboardCapitalization.Sentences,
                        )
                    }
                    if (isPlant) {
                        Text(tr("asset_form_care"), style = MaterialTheme.typography.titleSmall)
                        TextField(tr("asset_species"), current.species, { form = current.copy(species = it) }, error = errors["species"])
                        TextField(
                            tr("asset_light"),
                            current.light,
                            { form = current.copy(light = it) },
                            error = errors["light"],
                            hint = tr("asset_light_placeholder"),
                        )
                        TextField(
                            tr("asset_water_notes"),
                            current.waterNotes,
                            { form = current.copy(waterNotes = it) },
                            error = errors["waterNotes"],
                            singleLine = false,
                            minLines = 2,
                            capitalization = KeyboardCapitalization.Sentences,
                        )
                        if (state.isNew) {
                            Text(tr("asset_form_plan"), style = MaterialTheme.typography.titleSmall)
                            SwitchField(
                                tr("asset_form_plan_enable"),
                                current.makePlan,
                                { form = current.copy(makePlan = it) },
                                hint = tr("asset_form_plan_description"),
                            )
                            if (current.makePlan) {
                                TextField(
                                    tr("asset_form_plan_every"),
                                    current.everyDays,
                                    { form = current.copy(everyDays = it) },
                                    error = errors["everyDays"],
                                    hint = tr(if (current.seasonal) "asset_form_plan_every_winter" else "asset_form_plan_every_year"),
                                    keyboardType = KeyboardType.Number,
                                )
                                SwitchField(tr("asset_form_plan_seasonal"), current.seasonal, { form = current.copy(seasonal = it) })
                                if (current.seasonal) {
                                    TextField(
                                        tr("asset_form_plan_summer"),
                                        current.summerEveryDays,
                                        { form = current.copy(summerEveryDays = it) },
                                        error = errors["summerEveryDays"],
                                        hint = tr("asset_form_plan_summer_hint"),
                                        keyboardType = KeyboardType.Number,
                                    )
                                }
                            }
                        }
                    } else {
                        Text(tr(if (isVehicle) "asset_form_vehicle" else "asset_form_device"), style = MaterialTheme.typography.titleSmall)
                        TextField(
                            tr(if (isVehicle) "vehicle_make" else "asset_manufacturer"),
                            current.manufacturer,
                            { form = current.copy(manufacturer = it) },
                            error = errors["manufacturer"],
                            capitalization = KeyboardCapitalization.Words,
                        )
                        TextField(tr("asset_model"), current.model, { form = current.copy(model = it) }, error = errors["model"])
                        if (!isVehicle) {
                            TextField(
                                tr("asset_serial"),
                                current.serialNumber,
                                { form = current.copy(serialNumber = it) },
                                error = errors["serialNumber"],
                            )
                        }
                        Text(tr("asset_form_purchase"), style = MaterialTheme.typography.titleSmall)
                        DateField(
                            tr("asset_purchase_date"),
                            current.purchaseDate,
                            { form = current.copy(purchaseDate = it) },
                            error = errors["purchaseDate"],
                        )
                        if (!isVehicle) {
                            DateField(
                                tr("asset_installed_date"),
                                current.installedDate,
                                { form = current.copy(installedDate = it) },
                                error = errors["installedDate"],
                            )
                        }
                        DateField(
                            tr("asset_warranty_until"),
                            current.warrantyUntil,
                            { form = current.copy(warrantyUntil = it) },
                            error = errors["warrantyUntil"],
                        )
                        DateField(
                            tr("asset_warranty_extended"),
                            current.warrantyExtendedUntil,
                            { form = current.copy(warrantyExtendedUntil = it) },
                            error = errors["warrantyExtendedUntil"],
                        )
                        Text(
                            tr("asset_warranty_extended_hint"),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text(tr("asset_form_more"), style = MaterialTheme.typography.titleSmall)
                    if (!isVehicle || current.notes.isNotEmpty()) {
                        TextField(
                            tr("asset_notes"),
                            current.notes,
                            { form = current.copy(notes = it) },
                            error = errors["notes"],
                            singleLine = false,
                            minLines = 3,
                            capitalization = KeyboardCapitalization.Sentences,
                        )
                    }
                    SwitchField(
                        tr("asset_emergency"),
                        current.showOnEmergency,
                        { form = current.copy(showOnEmergency = it) },
                        hint = tr("asset_emergency_hint"),
                    )
                    if (isVehicle) {
                        Text(
                            tr("m_asset_vehicle_hint"),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    state.error?.let { InlineError(it.message) }
                }
            }
            loadError != null -> ErrorBox(loadError, Modifier.padding(padding), onRetry = store::retry)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }
}
