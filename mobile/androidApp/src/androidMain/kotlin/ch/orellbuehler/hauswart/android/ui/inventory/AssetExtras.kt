package ch.orellbuehler.hauswart.android.ui.inventory

import androidx.compose.runtime.Composable
import ch.orellbuehler.hauswart.android.ui.appointments.AppointmentsSection
import ch.orellbuehler.hauswart.android.ui.nav.LocalNav
import ch.orellbuehler.hauswart.android.ui.sections.AttachmentsSection
import ch.orellbuehler.hauswart.android.ui.sections.CommentsSection
import ch.orellbuehler.hauswart.android.ui.sections.DocumentLinksSection
import ch.orellbuehler.hauswart.android.ui.vehicles.VehicleSectionCard

/** The vehicle card (odometer, facts and the links to the vehicle screens); it shows something only for a vehicle. */
@Composable
fun AssetVehicleSection(assetId: String) {
    VehicleSectionCard(assetId)
}

/**
 * The end of the asset screen: appointments, files, linked documents and comments of the device, in the order of the
 * web page. The sections load and refresh themselves.
 */
@Composable
fun AssetExtras(assetId: String) {
    AppointmentsSection(LocalNav.current, assetId = assetId)
    AttachmentsSection(ownerType = "asset", ownerId = assetId)
    DocumentLinksSection(ownerType = "asset", ownerId = assetId)
    CommentsSection(ownerType = "asset", ownerId = assetId)
}

/** The end of the room screen: the linked documents, which is all the web room page has besides its own lists. */
@Composable
fun RoomExtras(roomId: String) {
    DocumentLinksSection(ownerType = "room", ownerId = roomId)
}
