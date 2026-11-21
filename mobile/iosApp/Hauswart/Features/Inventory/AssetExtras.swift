import SwiftUI

/// The asset screen is a `ScrollView` of cards (`CardSection`), so an extension returns a card.
///
/// The vehicle card (odometer, facts and the links to the vehicle screens); the asset screen calls it for every
/// asset and it shows something only for a vehicle.
struct AssetVehicleSection: View {
    let assetId: String

    var body: some View {
        VehicleSectionCard(assetId: assetId)
    }
}

/// Extension point at the end of the asset screen for sections other features provide:
/// attachments, comments, document links, appointments. Renders nothing for now.
struct AssetExtras: View {
    let assetId: String

    var body: some View {
        EmptyView()
    }
}

/// Extension point at the end of the room screen (attachments, comments, document links).
struct RoomExtras: View {
    let roomId: String

    var body: some View {
        EmptyView()
    }
}
