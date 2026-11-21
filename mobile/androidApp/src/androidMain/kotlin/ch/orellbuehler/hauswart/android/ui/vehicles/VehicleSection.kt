package ch.orellbuehler.hauswart.android.ui.vehicles

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Insights
import androidx.compose.material.icons.outlined.LocalGasStation
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material.icons.outlined.TireRepair
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LabeledValue
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.RowIcon
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.nav.LocalNav
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.vehicles.VehicleSectionStore
import ch.orellbuehler.hauswart.i18n.tr

/**
 * The vehicle card of the asset screen: plate, odometer with its record dialog, the vehicle's facts and the way to
 * the odometer history, tire sets, fuel log, statistics, details and task setup. Shows nothing for an asset that
 * is no vehicle.
 */
@Composable
fun VehicleSectionCard(assetId: String) {
    val store = rememberStore(key = assetId) { VehicleSectionStore(it, assetId) }
    val state = store.collect()
    var recording by remember { mutableStateOf(false) }
    if (state.notVehicle) return
    val nav: NavController? = LocalNav.current
    SectionCard(title = tr("vehicle_card_title")) {
        val error = state.error
        when {
            state.loading -> CircularProgressIndicator(Modifier.padding(ScreenPadding).align(Alignment.CenterHorizontally))
            error != null -> {
                InlineError(error.message, Modifier.padding(horizontal = ScreenPadding))
                TextButton(onClick = store::refresh, Modifier.padding(horizontal = 8.dp)) { Text(tr("common_retry")) }
            }
            else -> {
                Column(
                    Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    state.plate?.let { StatusChip(it, tone = "normal") }
                    Text(
                        tr("vehicle_odometer_title"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (state.odometer != null) {
                        Text(state.odometer!!, style = MaterialTheme.typography.headlineMedium)
                        state.odometerDate?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    } else {
                        Text(tr("vehicle_odometer_none"), style = MaterialTheme.typography.titleMedium)
                        Text(
                            tr("vehicle_odometer_none_hint"),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Button(onClick = { recording = true }, Modifier.fillMaxWidth()) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(Icons.Outlined.Speed, contentDescription = null)
                            Text(tr("vehicle_record_odometer"), maxLines = 1)
                        }
                    }
                }
                if (state.facts.isEmpty()) {
                    Text(
                        tr("vehicle_facts_empty"),
                        Modifier.padding(horizontal = ScreenPadding, vertical = 4.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                state.facts.forEach { LabeledValue(it.label, it.value) }
                state.notes?.let { LabeledValue(tr("vehicle_notes"), it) }
                if (nav != null) {
                    VehicleLinkRow(Icons.Outlined.Speed, tr("m_vehicle_link_odometer")) { nav.openOdometer(assetId) }
                    VehicleLinkRow(Icons.Outlined.TireRepair, tr("tire_card_title")) { nav.openTireSets(assetId) }
                    VehicleLinkRow(Icons.Outlined.LocalGasStation, tr("fuel_card_title")) { nav.openFuelLog(assetId) }
                    VehicleLinkRow(Icons.Outlined.Insights, tr("m_vehicle_link_stats")) { nav.openVehicleStats(assetId) }
                    VehicleLinkRow(Icons.Outlined.CalendarMonth, tr("vehicle_setup_open")) { nav.openVehicleSetup(assetId) }
                    VehicleLinkRow(Icons.Outlined.Edit, tr("m_vehicle_edit_action")) { nav.openVehicleEdit(assetId) }
                }
            }
        }
    }
    if (recording) OdometerRecordDialog(assetId, onDismiss = { recording = false })
}

@Composable
private fun VehicleLinkRow(
    icon: ImageVector,
    title: String,
    onClick: () -> Unit,
) {
    ListRow(
        title = title,
        leading = { RowIcon(icon) },
        trailing = { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null) },
        onClick = onClick,
    )
}
