package ch.orellbuehler.hauswart.android.ui.costs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.sections.AttachmentsSection
import ch.orellbuehler.hauswart.android.ui.sections.CommentsSection
import ch.orellbuehler.hauswart.android.ui.sections.DocumentLinksSection

/** The sections at the end of the entry detail screen: the receipts and files of the entry, its comments and linked documents. */
@Composable
fun CostExtras(
    costId: String,
    modifier: Modifier = Modifier,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        AttachmentsSection(ownerType = "cost", ownerId = costId)
        CommentsSection(ownerType = "cost", ownerId = costId)
        DocumentLinksSection(ownerType = "cost", ownerId = costId)
    }
}
