package ch.orellbuehler.hauswart.android.ui.inventory

import androidx.compose.runtime.Composable

/**
 * Extension point: the vehicle sections (odometer, tire sets, fuel log) are attached here by the
 * vehicles feature. It renders nothing until then; the asset screen calls it for every asset and
 * the implementation shows something only for a vehicle.
 */
@Composable
fun AssetVehicleSection(assetId: String) {
    // Filled in by the vehicles feature.
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
