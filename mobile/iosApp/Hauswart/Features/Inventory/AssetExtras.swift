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

/// The end of the asset screen. The shared sections are `Section`s of a `List`, the asset screen is a `ScrollView` of
/// cards: one row opens a small list screen that holds appointments, files, linked documents and comments.
struct AssetExtras: View {
    let assetId: String

    var body: some View {
        CardSection(title: "") {
            NavigationLink {
                AssetExtrasScreen(assetId: assetId)
            } label: {
                HStack {
                    Label(tr("m_asset_extras"), systemImage: "paperclip")
                        .lineLimit(2)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }
}

/// The end of the room screen, which is a `List`: the linked documents, which is all the web room page has besides its
/// own lists.
struct RoomExtras: View {
    let roomId: String

    var body: some View {
        DocumentLinksSection(ownerType: "room", ownerId: roomId)
    }
}

private struct AssetExtrasScreen: View {
    let assetId: String

    var body: some View {
        List {
            AppointmentsSection(assetId: assetId)
            AttachmentsSection(ownerType: "asset", ownerId: assetId)
            DocumentLinksSection(ownerType: "asset", ownerId: assetId)
            CommentsSection(ownerType: "asset", ownerId: assetId)
        }
        .navigationTitle(tr("m_asset_extras"))
        .navigationBarTitleDisplayMode(.inline)
    }
}
