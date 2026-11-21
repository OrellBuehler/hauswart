package ch.orellbuehler.hauswart.android.ui.sections

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.documentlinks.DocumentLinkRow
import ch.orellbuehler.hauswart.feature.documentlinks.DocumentLinksStore
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The documents of the person's document system that are linked to one owner, as a card: open the
 * preview in the system viewer, download the original, unlink, and link another one by searching.
 * Shows nothing at all when the person has no document system connected and nothing is linked.
 *
 * Usage: `DocumentLinksSection(ownerType = "asset", ownerId = asset.id)` inside the owner's scrolling
 * column. [ownerType] is `asset`, `room`, `page`, `task`, `defect`, `service_log`, `part`, `contact`,
 * `cost` or `insurance_policy`. It loads and refreshes itself and reports `documents` changes.
 */
@Composable
fun DocumentLinksSection(
    ownerType: String,
    ownerId: String,
    modifier: Modifier = Modifier,
) {
    val store = rememberStore(key = "doclinks-$ownerType-$ownerId") { DocumentLinksStore(it, ownerType, ownerId) }
    val state = store.collect()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var linking by rememberSaveable { mutableStateOf(false) }
    var unlinkId by rememberSaveable { mutableStateOf<String?>(null) }
    var cannotOpen by remember { mutableStateOf(false) }
    var sharing by remember { mutableStateOf(false) }

    LaunchedEffect(state.opened) {
        val opened = state.opened ?: return@LaunchedEffect
        store.clearOpened()
        val asShare = sharing
        sharing = false
        scope.launch {
            val done = if (asShare) context.shareFile(opened) else context.viewFile(opened)
            if (!done) cannotOpen = true
        }
    }

    if (!state.visible) return
    SectionCard(modifier = modifier, title = tr("document_links_title")) {
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            state.error?.let {
                InlineError(it.message)
                TextButton(onClick = store::refresh) { Text(tr("common_retry")) }
            }
            state.actionError?.let {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    InlineError(it.message, Modifier.weight(1f))
                    IconButton(
                        onClick = store::dismissActionError,
                    ) { Icon(Icons.Outlined.Close, contentDescription = tr("m_attach_dismiss")) }
                }
            }
            if (cannotOpen) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    InlineError(tr("m_cannot_open"), Modifier.weight(1f))
                    IconButton(onClick = { cannotOpen = false }) { Icon(Icons.Outlined.Close, contentDescription = tr("m_attach_dismiss")) }
                }
            }
            if (state.rows.isEmpty() && state.error == null) {
                Text(
                    if (state.canLink) tr("document_links_empty_body") else tr("document_links_empty_readonly"),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        state.rows.forEach { row ->
            DocumentLinkItem(
                row = row,
                busy = state.opening == row.id || state.unlinkingId == row.id,
                thumbs = state.thumbs,
                store = store,
                onOpen = { store.open(row.id) },
                onDownload = {
                    sharing = true
                    store.openOriginal(row.id)
                },
                onUnlink = { unlinkId = row.id },
            )
        }
        if (state.canLink) {
            FilledTonalButton(onClick = { linking = true }, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Icon(Icons.Outlined.Add, contentDescription = null, Modifier.size(18.dp))
                Text(tr("document_link_add"), Modifier.padding(start = 8.dp), maxLines = 1)
            }
        }
    }

    val unlinkRow = state.rows.firstOrNull { it.id == unlinkId }
    if (unlinkRow != null) {
        ConfirmDialog(
            title = tr("document_unlink_title"),
            text =
                if (unlinkRow.available) {
                    tr("document_unlink_description", "title" to unlinkRow.title)
                } else {
                    tr("document_unlink_description_unavailable")
                },
            confirmLabel = tr("document_unlink"),
            destructive = true,
            onConfirm = {
                unlinkId = null
                store.unlink(unlinkRow.id)
            },
            onDismiss = { unlinkId = null },
        )
    }
    if (linking) LinkDocumentDialog(ownerType, ownerId, onDismiss = { linking = false })
}

@Composable
private fun DocumentLinkItem(
    row: DocumentLinkRow,
    busy: Boolean,
    thumbs: Int,
    store: DocumentLinksStore,
    onOpen: () -> Unit,
    onDownload: () -> Unit,
    onUnlink: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    ListRow(
        title = row.title,
        subtitle = if (row.available) row.details else tr("document_unavailable_hint"),
        subtitleLines = 2,
        leading = { DocumentThumbnail(row, thumbs, store) },
        trailing = {
            if (busy) {
                CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    StatusChip(row.roleLabel)
                    Box {
                        IconButton(onClick = { menu = true }) {
                            Icon(Icons.Outlined.MoreVert, contentDescription = tr("document_actions_aria", "title" to row.title))
                        }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            if (row.canOpen) {
                                DropdownMenuItem(
                                    text = { Text(tr("document_open_preview")) },
                                    leadingIcon = { Icon(Icons.Outlined.OpenInNew, contentDescription = null) },
                                    onClick = {
                                        menu = false
                                        onOpen()
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text(tr("document_download_original")) },
                                    leadingIcon = { Icon(Icons.Outlined.Download, contentDescription = null) },
                                    onClick = {
                                        menu = false
                                        onDownload()
                                    },
                                )
                            }
                            DropdownMenuItem(
                                text = { Text(tr("document_unlink"), color = MaterialTheme.colorScheme.error) },
                                leadingIcon = {
                                    Icon(
                                        Icons.Outlined.LinkOff,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.error,
                                    )
                                },
                                onClick = {
                                    menu = false
                                    onUnlink()
                                },
                            )
                        }
                    }
                }
            }
        },
        onClick = if (row.canOpen && !busy) onOpen else null,
    )
}

@Composable
private fun DocumentThumbnail(
    row: DocumentLinkRow,
    thumbs: Int,
    store: DocumentLinksStore,
) {
    LaunchedEffect(row.id) { if (row.hasThumb) store.requestThumbnail(row.id) }
    val bytes = if (row.hasThumb) store.thumbnail(row.id) else null
    val bitmap by produceState<ImageBitmap?>(null, bytes, thumbs) {
        value = bytes?.let { data -> withContext(Dispatchers.Default) { decodeSampled(data, 256)?.asImageBitmap() } }
    }
    Box(
        Modifier.size(width = 36.dp, height = 48.dp).clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        val image = bitmap
        if (image != null) {
            Image(image, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth())
        } else {
            Icon(
                if (row.available) Icons.Outlined.Description else Icons.Outlined.Lock,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
