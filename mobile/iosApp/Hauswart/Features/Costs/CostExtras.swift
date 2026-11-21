import SwiftUI

/// The extension point of the entry detail screen: attachments, comments and document links of an entry are rendered
/// here by the features that provide them. It renders nothing until they do.
struct CostExtras: View {
    let costId: String

    var body: some View {
        EmptyView()
    }
}
