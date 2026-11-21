package ch.orellbuehler.hauswart.android.ui.sections

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.outlined.AddAPhoto
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
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
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.attachments.ATTACHMENT_CAPTION_MAX
import ch.orellbuehler.hauswart.feature.attachments.AttachmentRow
import ch.orellbuehler.hauswart.feature.attachments.AttachmentUploadRow
import ch.orellbuehler.hauswart.feature.attachments.AttachmentsStore
import ch.orellbuehler.hauswart.feature.attachments.OpenedAttachment
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * The files of one owner as a card: thumbnails (loaded lazily), upload from the camera, the photo
 * library or the file picker, open (an image full screen with zoom, a PDF or other file in the
 * system viewer), share, caption, guest visibility where the owner has it, delete.
 *
 * Usage: `AttachmentsSection(ownerType = "task", ownerId = task.id)` inside the owner's scrolling
 * column. [ownerType] is the attachment owner type (`asset`, `room`, `page`, `task`, `defect`,
 * `service_log`, `part`, `asset_hint`, `contact`, `cost`, `insurance_policy`, `asset_note`,
 * `tire_set`, `appointment`). It loads and refreshes itself and reports `attachments` changes.
 */
@Composable
fun AttachmentsSection(
    ownerType: String,
    ownerId: String,
    modifier: Modifier = Modifier,
) {
    val store = rememberStore(key = "attachments-$ownerType-$ownerId") { AttachmentsStore(it, ownerType, ownerId) }
    val state = store.collect()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var menuOpen by remember { mutableStateOf(false) }
    var captionId by rememberSaveable { mutableStateOf<String?>(null) }
    var caption by rememberSaveable { mutableStateOf("") }
    var deleteId by rememberSaveable { mutableStateOf<String?>(null) }
    var viewing by remember { mutableStateOf<OpenedAttachment?>(null) }
    var cannotOpen by remember { mutableStateOf(false) }

    fun upload(uri: Uri?) {
        if (uri == null) return
        scope.launch {
            val picked = context.readPickedFile(uri)
            when {
                picked == null -> cannotOpen = true
                picked.bytes == null -> store.rejectTooLarge(picked.name)
                else -> store.upload(picked.name, picked.mime, picked.bytes)
            }
        }
    }

    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { upload(it) }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { upload(it) }
    var capture by remember { mutableStateOf<Pair<File, Uri>?>(null) }
    val takePhoto =
        rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { taken ->
            val target = capture
            capture = null
            if (taken && target != null) upload(target.second)
        }

    OnValueChange(state.captioned) { captionId = null }
    LaunchedEffect(state.opened) {
        val opened = state.opened ?: return@LaunchedEffect
        store.clearOpened()
        if (opened.file.isImage && !opened.share) {
            viewing = opened
        } else {
            scope.launch {
                val done = if (opened.share) context.shareFile(opened.file) else context.viewFile(opened.file)
                if (!done) cannotOpen = true
            }
        }
    }

    SectionCard(modifier = modifier, title = tr("attach_title")) {
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box {
                FilledTonalButton(onClick = { menuOpen = true }) {
                    Icon(Icons.Outlined.AttachFile, contentDescription = null, Modifier.size(18.dp))
                    Text(tr("m_attach_add"), Modifier.padding(start = 8.dp), maxLines = 1)
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(
                        text = { Text(tr("attach_take_photo")) },
                        leadingIcon = { Icon(Icons.Outlined.AddAPhoto, contentDescription = null) },
                        onClick = {
                            menuOpen = false
                            val target = context.newCaptureTarget()
                            capture = target
                            takePhoto.launch(target.second)
                        },
                    )
                    DropdownMenuItem(
                        text = { Text(tr("m_attach_from_library")) },
                        leadingIcon = { Icon(Icons.Outlined.PhotoLibrary, contentDescription = null) },
                        onClick = {
                            menuOpen = false
                            pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        },
                    )
                    DropdownMenuItem(
                        text = { Text(tr("attach_choose_file")) },
                        leadingIcon = { Icon(Icons.Outlined.InsertDriveFile, contentDescription = null) },
                        onClick = {
                            menuOpen = false
                            pickFile.launch(arrayOf("application/pdf", "image/*"))
                        },
                    )
                }
            }
            state.uploads.forEach { upload ->
                UploadItem(upload, onRetry = { store.retryUpload(upload.id) }, onDismiss = { store.dismissUpload(upload.id) })
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
        }
        val error = state.error
        when {
            state.loading -> LoadingBox(Modifier.size(96.dp).align(Alignment.CenterHorizontally))
            error != null && state.rows.isEmpty() ->
                Column(Modifier.padding(horizontal = 16.dp)) {
                    InlineError(error.message)
                    TextButton(onClick = store::refresh) { Text(tr("common_retry")) }
                }
            state.rows.isEmpty() && state.uploads.isEmpty() ->
                Text(
                    tr("attach_empty_title"),
                    Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            else ->
                state.rows.forEach { row ->
                    AttachmentItem(
                        row = row,
                        busy = state.busyId == row.id || state.opening == row.id,
                        guestOwner = state.guestOwner,
                        thumbs = state.thumbs,
                        store = store,
                        onOpen = { store.open(row.id) },
                        onShare = { store.share(row.id) },
                        onCaption = {
                            caption = row.caption
                            captionId = row.id
                        },
                        onGuest = { store.setGuestVisible(row.id, !row.guestVisible) },
                        onDelete = { deleteId = row.id },
                    )
                }
        }
    }

    val captionRow = state.rows.firstOrNull { it.id == captionId }
    if (captionRow != null) {
        AlertDialog(
            onDismissRequest = { captionId = null },
            title = { Text(tr("attach_edit_caption")) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextField(
                        label = tr("attach_caption_label"),
                        value = caption,
                        onChange = { caption = it.take(ATTACHMENT_CAPTION_MAX + 50) },
                        hint = tr("attach_caption_placeholder"),
                        error = state.captionError,
                        capitalization = KeyboardCapitalization.Sentences,
                        enabled = !state.captionSaving,
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { store.saveCaption(captionRow.id, caption) }, enabled = !state.captionSaving) {
                    Text(if (state.captionSaving) tr("common_saving") else tr("common_save"))
                }
            },
            dismissButton = { TextButton(onClick = { captionId = null }) { Text(tr("common_cancel")) } },
        )
    }

    val deleteRow = state.rows.firstOrNull { it.id == deleteId }
    if (deleteRow != null) {
        ConfirmDialog(
            title = tr("attach_delete_title"),
            text = tr("attach_delete_description", "name" to deleteRow.label),
            confirmLabel = tr("common_delete"),
            destructive = true,
            onConfirm = {
                deleteId = null
                store.delete(deleteRow.id)
            },
            onDismiss = { deleteId = null },
        )
    }

    viewing?.let { opened ->
        ImageViewer(
            file = opened.file,
            onShare = {
                scope.launch { if (!context.shareFile(opened.file)) cannotOpen = true }
            },
            onDismiss = { viewing = null },
        )
    }
}

@Composable
private fun UploadItem(
    upload: AttachmentUploadRow,
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (upload.failed) {
            Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = MaterialTheme.colorScheme.error)
        } else {
            CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
        }
        Column(Modifier.weight(1f)) {
            Text(upload.name, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
            Text(
                if (upload.failed) upload.error else tr("m_attach_uploading"),
                style = MaterialTheme.typography.bodySmall,
                color = if (upload.failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (upload.failed) {
            if (upload.canRetry) {
                IconButton(onClick = onRetry) { Icon(Icons.Outlined.Refresh, contentDescription = tr("m_attach_retry")) }
            }
            IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, contentDescription = tr("m_attach_dismiss")) }
        }
    }
}

@Composable
private fun AttachmentItem(
    row: AttachmentRow,
    busy: Boolean,
    guestOwner: Boolean,
    thumbs: Int,
    store: AttachmentsStore,
    onOpen: () -> Unit,
    onShare: () -> Unit,
    onCaption: () -> Unit,
    onGuest: () -> Unit,
    onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    ListRow(
        title = row.label,
        subtitle = listOfNotNull(row.sizeText, if (row.guestVisible) tr("attach_guest_badge") else null).joinToString(" · "),
        leading = { Thumbnail(row, thumbs, store) },
        trailing = {
            if (busy) {
                CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            } else {
                Box {
                    IconButton(onClick = { menu = true }) {
                        Icon(Icons.Outlined.MoreVert, contentDescription = tr("attach_actions_aria", "name" to row.label))
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(
                            text = { Text(tr("m_attach_open")) },
                            leadingIcon = { Icon(Icons.Outlined.Image, contentDescription = null) },
                            onClick = {
                                menu = false
                                onOpen()
                            },
                        )
                        DropdownMenuItem(
                            text = { Text(tr("m_attach_share")) },
                            leadingIcon = { Icon(Icons.Outlined.Share, contentDescription = null) },
                            onClick = {
                                menu = false
                                onShare()
                            },
                        )
                        DropdownMenuItem(
                            text = { Text(tr("attach_edit_caption")) },
                            leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                            onClick = {
                                menu = false
                                onCaption()
                            },
                        )
                        if (guestOwner) {
                            DropdownMenuItem(
                                text = { Text(tr("attach_guest_visible")) },
                                leadingIcon = { Checkbox(checked = row.guestVisible, onCheckedChange = null) },
                                onClick = {
                                    menu = false
                                    onGuest()
                                },
                            )
                        }
                        DropdownMenuItem(
                            text = { Text(tr("common_delete"), color = MaterialTheme.colorScheme.error) },
                            leadingIcon = {
                                Icon(
                                    Icons.Outlined.Delete,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.error,
                                )
                            },
                            onClick = {
                                menu = false
                                onDelete()
                            },
                        )
                    }
                }
            }
        },
        onClick = if (busy) null else onOpen,
    )
}

/** A 48 dp preview: the thumbnail once it arrived (decoded off the main thread), else an icon for the kind of file. */
@Composable
private fun Thumbnail(
    row: AttachmentRow,
    thumbs: Int,
    store: AttachmentsStore,
) {
    val wantsThumb = row.hasThumb
    LaunchedEffect(row.id) { if (wantsThumb) store.requestThumbnail(row.id) }
    val bytes = if (wantsThumb) store.thumbnail(row.id) else null
    val bitmap by produceState<ImageBitmap?>(null, bytes, thumbs) {
        value = bytes?.let { data -> withContext(Dispatchers.Default) { decodeSampled(data, 256)?.asImageBitmap() } }
    }
    Box(
        Modifier.size(48.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        val image = bitmap
        if (image != null) {
            Image(image, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.size(48.dp))
        } else {
            Icon(
                when (row.kind) {
                    "image" -> Icons.Outlined.Image
                    "pdf" -> Icons.Outlined.PictureAsPdf
                    else -> Icons.Outlined.InsertDriveFile
                },
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
