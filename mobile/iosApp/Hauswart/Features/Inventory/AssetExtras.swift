import SwiftUI

/// The asset screen is a `ScrollView` of cards (`CardSection`), so an extension returns a card.
///
/// Extension point: the vehicle sections (odometer, tire sets, fuel log) are attached here by the
/// vehicles feature. It renders nothing until then; the asset screen calls it for every asset.
struct AssetVehicleSection: View {
    let assetId: String

    var body: some View {
        EmptyView()
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
