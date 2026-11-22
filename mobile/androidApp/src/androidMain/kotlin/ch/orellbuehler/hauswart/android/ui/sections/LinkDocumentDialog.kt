package ch.orellbuehler.hauswart.android.ui.sections

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ch.orellbuehler.hauswart.android.ui.LocalApp
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.PrimaryButton
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.feature.documentlinks.DOCUMENT_LINK_ROLES
import ch.orellbuehler.hauswart.feature.documentlinks.DocumentChoiceRow
import ch.orellbuehler.hauswart.feature.documentlinks.LinkDocumentForm
import ch.orellbuehler.hauswart.feature.documentlinks.LinkDocumentStore
import ch.orellbuehler.hauswart.feature.documentlinks.documentRoleLabel
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Search the document system, choose a document, say what it is for and link it to the owner. */
@Composable
internal fun LinkDocumentDialog(
    ownerType: String,
    ownerId: String,
    onDismiss: () -> Unit,
) {
    val app = LocalApp.current
    val store = remember { LinkDocumentStore(app, ownerType, ownerId) }
    DisposableEffect(store) { onDispose { store.close() } }
    val state = store.collect()
    var role by remember { mutableStateOf(state.initial.role) }
    var label by remember { mutableStateOf(state.initial.label) }

    OnValueChange(state.linked) { onDismiss() }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(
                Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .navigationBarsPadding()
                    .imePadding(),
            ) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, contentDescription = tr("common_close")) }
                    Text(
                        tr("document_link_title"),
                        style = MaterialTheme.typography.titleLarge,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                    )
                }
                Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextField(
                        label = tr("document_link_search"),
                        value = state.query,
                        onChange = store::setQuery,
                        hint = if (state.query.isBlank()) tr("document_link_search_hint") else tr("document_link_search_live"),
                        leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                    )
                }
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    val error = state.error
                    when {
                        error != null -> ErrorBox(error, onRetry = store::retry)
                        state.loading && state.rows.isEmpty() ->
                            CircularProgressIndicator(Modifier.align(Alignment.Center))
                        state.rows.isEmpty() ->
                            Text(
                                if (state.query.isBlank()) tr("document_link_none_synced") else tr("document_link_no_match"),
                                Modifier.align(Alignment.Center).padding(24.dp),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        else ->
                            LazyColumn(Modifier.fillMaxSize()) {
                                items(state.rows, key = { it.id }) { row ->
                                    ChoiceRow(row, state.selectedId == row.id, state.thumbs, store) { store.select(row.id) }
                                    HorizontalDivider()
                                }
                                item {
                                    if (state.moreError != null) {
                                        Column(Modifier.padding(16.dp)) {
                                            InlineError(state.moreError?.message.orEmpty())
                                            TextButton(onClick = store::loadMore) { Text(tr("common_retry")) }
                                        }
                                    } else if (state.hasMore) {
                                        TextButton(
                                            onClick = store::loadMore,
                                            enabled = !state.loadingMore,
                                            modifier = Modifier.padding(8.dp),
                                        ) {
                                            Text(tr("common_load_more"))
                                        }
                                    }
                                }
                            }
                    }
                }
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        state.selectedTitle?.let { tr("document_link_selected", "title" to it) } ?: tr("document_link_none_selected"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                    )
                    ChoiceField(
                        label = tr("document_link_role"),
                        value = role,
                        options = DOCUMENT_LINK_ROLES.map { it to documentRoleLabel(it) },
                        onChange = { role = it },
                    )
                    TextField(
                        label = tr("document_link_label"),
                        value = label,
                        onChange = { label = it },
                        hint = tr("document_link_label_hint"),
                    )
                    state.submitError?.let { InlineError(it) }
                    PrimaryButton(
                        text = tr("document_link_submit"),
                        pendingText = tr("common_saving"),
                        onClick = { store.submit(LinkDocumentForm(role, label)) },
                        pending = state.submitting,
                        enabled = state.selectedId.isNotEmpty(),
                    )
                }
            }
        }
    }
}

@Composable
private fun ChoiceRow(
    row: DocumentChoiceRow,
    selected: Boolean,
    thumbs: Int,
    store: LinkDocumentStore,
    onSelect: () -> Unit,
) {
    LaunchedEffect(row.id) { if (row.hasThumb) store.requestThumbnail(row.id) }
    val bytes = if (row.hasThumb) store.thumbnail(row.id) else null
    val bitmap by produceState<ImageBitmap?>(null, bytes, thumbs) {
        value = bytes?.let { data -> withContext(Dispatchers.Default) { decodeSampled(data, 256)?.asImageBitmap() } }
    }
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onSelect).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        RadioButton(selected = selected, onClick = null)
        Box(
            Modifier
                .size(
                    width = 36.dp,
                    height = 48.dp,
                ).clip(RoundedCornerShape(6.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.Center,
        ) {
            val image = bitmap
            if (image != null) {
                Image(image, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            } else {
                Icon(Icons.Outlined.Description, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Column(Modifier.weight(1f)) {
            Text(row.title, style = MaterialTheme.typography.bodyMedium, maxLines = 2)
            if (row.details.isNotBlank()) {
                Text(
                    row.details,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
            if (row.tags.isNotBlank()) {
                Text(
                    row.tags,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
            if (row.linkedHere) {
                Text(
                    tr("document_link_already_here"),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            } else if (row.usedIn.isNotBlank()) {
                Text(
                    row.usedIn,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
        }
    }
}
