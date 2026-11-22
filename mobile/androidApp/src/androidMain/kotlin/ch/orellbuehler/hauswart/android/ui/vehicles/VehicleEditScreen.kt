package ch.orellbuehler.hauswart.android.ui.vehicles

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.DateField
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.SaveBar
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.vehicles.VehicleEditStore
import ch.orellbuehler.hauswart.i18n.tr

/** Plate, VIN, registration data, tire sizes, location, odometer unit, notes and the cost book of a vehicle. */
@Composable
fun VehicleEditScreen(
    nav: NavController,
    assetId: String,
) {
    val store = rememberStore(key = assetId) { VehicleEditStore(it, assetId) }
    val state = store.collect()
    val initial = state.initial
    val loadError = state.loadError
    var form by remember(initial) { mutableStateOf(initial) }
    LaunchedEffect(state.saved) { if (state.saved) nav.popBackStack() }
    AppScaffold(
        title = tr("m_vehicle_edit_title"),
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
                        tr("vehicle_plate"),
                        current.plate,
                        { form = current.copy(plate = it) },
                        error = errors["plate"],
                        hint = tr("vehicle_plate_placeholder"),
                        capitalization = KeyboardCapitalization.Characters,
                    )
                    DateField(tr("vehicle_first_registration"), current.firstRegistration, {
                        form = current.copy(firstRegistration = it)
                    }, error = errors["firstRegistration"])
                    TextField(tr("vehicle_vin"), current.vin, {
                        form = current.copy(vin = it)
                    }, error = errors["vin"], capitalization = KeyboardCapitalization.Characters)
                    TextField(tr("vehicle_registration_number"), current.registrationNumber, {
                        form = current.copy(registrationNumber = it)
                    }, error = errors["registrationNumber"])
                    ChoiceField(tr("vehicle_fuel"), current.fuelType, state.fuelTypes.pairs(), {
                        form = current.copy(fuelType = it)
                    }, error = errors["fuelType"])
                    TextField(tr("vehicle_tire_summer"), current.tireSizeSummer, {
                        form = current.copy(tireSizeSummer = it)
                    }, error = errors["tireSizeSummer"], hint = tr("vehicle_tire_placeholder"))
                    TextField(tr("vehicle_tire_winter"), current.tireSizeWinter, {
                        form = current.copy(tireSizeWinter = it)
                    }, error = errors["tireSizeWinter"], hint = tr("vehicle_tire_placeholder"))
                    TextField(tr("vehicle_location"), current.location, {
                        form = current.copy(location = it)
                    }, error = errors["location"], hint = tr("vehicle_location_placeholder"))
                    ChoiceField(tr("vehicle_odometer_unit"), current.odometerUnit, state.units.pairs(), {
                        form =
                            current.copy(odometerUnit = it)
                    }, error = errors["odometerUnit"])
                    ChoiceField(tr("vehicle_cost_book"), current.costBookId, state.books.pairs(), {
                        form = current.copy(costBookId = it)
                    }, error = errors["costBookId"])
                    TextField(
                        tr("vehicle_notes"),
                        current.notes,
                        { form = current.copy(notes = it) },
                        error = errors["notes"],
                        hint = tr("vehicle_notes_placeholder"),
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
