import SwiftUI

/// The sections at the end of the entry detail screen: the receipts and files of the entry, its comments and linked
/// documents. They are `Section`s, so this sits inside the screen's `List`.
struct CostExtras: View {
    let costId: String

    var body: some View {
        AttachmentsSection(ownerType: "cost", ownerId: costId)
        CommentsSection(ownerType: "cost", ownerId: costId)
        DocumentLinksSection(ownerType: "cost", ownerId: costId)
    }
}
