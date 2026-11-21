package ch.orellbuehler.hauswart.android.ui.receipts

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.ReceiptLong
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.costs.AmountText
import ch.orellbuehler.hauswart.android.ui.inventory.FormDialog
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.android.ui.sections.ImageViewer
import ch.orellbuehler.hauswart.android.ui.sections.decodeSampled
import ch.orellbuehler.hauswart.android.ui.sections.shareFile
import ch.orellbuehler.hauswart.android.ui.sections.viewFile
import ch.orellbuehler.hauswart.feature.receipts.ReceiptRowView
import ch.orellbuehler.hauswart.feature.receipts.ReceiptsStore
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun ReceiptsScreen(
    nav: NavController,
    status: String?,
) {
    val store = rememberStore(key = status ?: "all") { ReceiptsStore(it, status) }
    val state = store.collect()
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var dismissId by rememberSaveable { mutableStateOf<String?>(null) }
    var reason by rememberSaveable { mutableStateOf("") }
    var deleteId by rememberSaveable { mutableStateOf<String?>(null) }
    var viewing by remember { mutableStateOf<ch.orellbuehler.hauswart.feature.attachments.OpenedAttachment?>(null) }
    val error = state.error
    val cannotOpen = tr("m_cannot_open")

    LaunchedEffect(state.notice) {
        state.notice?.let {
            snackbar.showSnackbar(it)
            store.dismissNotice()
        }
    }
    LaunchedEffect(state.actionError) {
        state.actionError?.let {
            snackbar.showSnackbar(it.message)
            store.dismissActionError()
        }
    }
    LaunchedEffect(state.opened) {
        val opened = state.opened ?: return@LaunchedEffect
        store.clearOpened()
        if (opened.file.isImage) {
            viewing = opened
        } else if (!context.viewFile(opened.file)) {
            snackbar.showSnackbar(cannotOpen)
        }
    }

    AppScaffold(
        title = tr("receipts_title"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        floatingActionButton = {
            FloatingActionButton(onClick = { nav.openReceiptSubmit() }) {
                Icon(Icons.Outlined.Add, contentDescription = tr("receipts_submit"))
            }
        },
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.rows.isEmpty() -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn(
                        contentPadding = PaddingValues(start = ScreenPadding, end = ScreenPadding, bottom = 88.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        item {
                            Text(
                                tr("receipts_explainer"),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                state.views.forEach { view ->
                                    FilterChip(
                                        selected = view.value == state.view,
                                        onClick = { store.selectView(view.value) },
                                        label = { Text(view.label + (view.badge?.let { " ($it)" } ?: ""), maxLines = 1) },
                                    )
                                }
                            }
                        }
                        if (state.rows.isEmpty()) {
                            item {
                                EmptyState(
                                    title = state.emptyTitle,
                                    body = state.emptyBody,
                                    icon = Icons.Outlined.ReceiptLong,
                                    action = {
                                        TextButton(
                                            onClick = { nav.openReceiptSubmit() },
                                        ) { Text(tr("receipts_submit"), maxLines = 1) }
                                    },
                                )
                            }
                        } else {
                            item { Text(state.countText, style = MaterialTheme.typography.bodySmall) }
                            items(state.rows, key = { it.id }) { row ->
                                ReceiptCard(
                                    row = row,
                                    store = store,
                                    thumbs = state.thumbs,
                                    busy = state.busyId == row.id || state.opening == row.id,
                                    onOpen = { store.open(row.id) },
                                    onDismiss = {
                                        reason = ""
                                        dismissId = row.id
                                    },
                                    onDelete = { deleteId = row.id },
                                    onOpenCost = { id -> nav.navigate(Routes.cost(id)) },
                                )
                            }
                            if (state.hasMore) {
                                item {
                                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                                        state.moreError?.let { InlineError(it.message) }
                                        OutlinedButton(onClick = store::loadMore, enabled = !state.loadingMore) {
                                            Text(tr(if (state.loadingMore) "common_loading" else "common_load_more"), maxLines = 1)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
        }
    }

    dismissId?.let { id ->
        FormDialog(
            title = tr("receipts_dismiss_title"),
            onDismiss = { dismissId = null },
            onSave = {
                if (store.dismiss(id, reason)) dismissId = null
            },
            pending = false,
            saveLabel = tr("receipts_dismiss"),
        ) {
            Text(tr("receipts_dismiss_description"), style = MaterialTheme.typography.bodyMedium)
            TextField(
                label = tr("receipts_dismiss_reason"),
                value = reason,
                onChange = { reason = it },
                hint = tr("receipts_dismiss_reason_hint"),
                singleLine = false,
                minLines = 2,
                capitalization = KeyboardCapitalization.Sentences,
            )
        }
    }
    deleteId?.let { id ->
        val row = state.rows.firstOrNull { it.id == id }
        ConfirmDialog(
            title = tr("receipts_delete_title"),
            text = row?.deleteText ?: tr("receipts_delete_description"),
            confirmLabel = tr("common_delete"),
            destructive = true,
            onConfirm = {
                deleteId = null
                store.delete(id)
            },
            onDismiss = { deleteId = null },
        )
    }
    viewing?.let { opened ->
        ImageViewer(
            file = opened.file,
            onShare = { scope.launch { if (!context.shareFile(opened.file)) snackbar.showSnackbar(cannotOpen) } },
            onDismiss = { viewing = null },
        )
    }
}

@Composable
private fun ReceiptCard(
    row: ReceiptRowView,
    store: ReceiptsStore,
    thumbs: Int,
    busy: Boolean,
    onOpen: () -> Unit,
    onDismiss: () -> Unit,
    onDelete: () -> Unit,
    onOpenCost: (String) -> Unit,
) {
    SectionCard {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Thumbnail(row, store, thumbs, enabled = row.hasFile && !busy, onClick = onOpen)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        StatusChip(row.statusLabel, tone = row.statusTone)
                        Text(row.createdText, style = MaterialTheme.typography.bodySmall, maxLines = 1)
                    }
                    Text(row.byText, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    row.note?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                    row.hints?.let {
                        Text(
                            it,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    row.claimText?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                    if (row.hasFile && !row.isImage) {
                        TextButton(onClick = onOpen, enabled = !busy) { Text(tr("receipts_open_pdf"), maxLines = 1) }
                    }
                    if (!row.hasFile) {
                        Text(tr("receipts_no_file"), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            row.resultTitle?.let { title ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(title, style = MaterialTheme.typography.labelLarge)
                    row.costs.forEach { cost ->
                        Row(
                            Modifier.fillMaxWidth().clickable { onOpenCost(cost.id) }.padding(vertical = 4.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(cost.title, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text(cost.date, style = MaterialTheme.typography.bodySmall)
                                    if (cost.reviewNeeded) StatusChip(tr("cost_badge_review"), tone = "due")
                                }
                            }
                            AmountText(cost.amount, false)
                        }
                    }
                    row.resultGone?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    row.resultNote?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                }
            }
            row.closedLine?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            row.dismissReason?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (row.canDismiss) OutlinedButton(onClick = onDismiss, enabled = !busy) { Text(tr("receipts_dismiss"), maxLines = 1) }
                if (row.canDelete) TextButton(onClick = onDelete, enabled = !busy) { Text(tr("common_delete"), maxLines = 1) }
                if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            }
        }
    }
}

/** A 64 dp preview of the file: the picture once it arrived, else an icon for the kind of file. */
@Composable
private fun Thumbnail(
    row: ReceiptRowView,
    store: ReceiptsStore,
    thumbs: Int,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    LaunchedEffect(row.id) { if (row.hasThumb) store.requestThumbnail(row.id) }
    val bytes = if (row.hasThumb) store.thumbnail(row.id) else null
    val bitmap by produceState<ImageBitmap?>(null, bytes, thumbs) {
        value = bytes?.let { data -> withContext(Dispatchers.Default) { decodeSampled(data, 256)?.asImageBitmap() } }
    }
    Box(
        Modifier
            .size(64.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable(enabled = enabled, onClickLabel = tr("receipts_open_file"), onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        val image = bitmap
        if (image != null) {
            Image(image, contentDescription = tr("receipts_open_file"), contentScale = ContentScale.Crop, modifier = Modifier.size(64.dp))
        } else {
            Icon(
                if (row.hasFile && !row.isImage) Icons.Outlined.PictureAsPdf else Icons.Outlined.InsertDriveFile,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
