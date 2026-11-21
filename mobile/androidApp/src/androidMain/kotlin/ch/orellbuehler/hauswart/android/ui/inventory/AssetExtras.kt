package ch.orellbuehler.hauswart.android.ui.inventory

import androidx.compose.runtime.Composable
import ch.orellbuehler.hauswart.android.ui.vehicles.VehicleSectionCard

/** The vehicle card (odometer, facts and the links to the vehicle screens); it shows something only for a vehicle. */
@Composable
fun AssetVehicleSection(assetId: String) {
    VehicleSectionCard(assetId)
}

/**
 * Extension point at the end of the asset screen for sections other features provide:
 * attachments, comments, document links, appointments. Renders nothing for now.
 */
@Composable
fun AssetExtras(assetId: String) {
    // Filled in by the features that attach to an asset.
}

/** Extension point at the end of the room screen (attachments, comments, document links). Renders nothing for now. */
@Composable
fun RoomExtras(roomId: String) {
    // Filled in by the features that attach to a room.
}
