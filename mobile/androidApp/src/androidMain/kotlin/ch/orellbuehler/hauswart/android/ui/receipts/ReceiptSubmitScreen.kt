package ch.orellbuehler.hauswart.android.ui.receipts

import android.content.ActivityNotFoundException
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddAPhoto
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PrimaryButton
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.android.ui.sections.captureUri
import ch.orellbuehler.hauswart.android.ui.sections.newCaptureTarget
import ch.orellbuehler.hauswart.android.ui.sections.readPickedFile
import ch.orellbuehler.hauswart.feature.receipts.ReceiptForm
import ch.orellbuehler.hauswart.feature.receipts.ReceiptSubmitStore
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.launch

/** Takes a photo of a receipt (or picks a picture or PDF) and puts it in the queue. */
@Composable
fun ReceiptSubmitScreen(nav: NavController) {
    val store = rememberStore { ReceiptSubmitStore(it) }
    val state = store.collect()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var note by rememberSaveable { mutableStateOf("") }
    var bookId by rememberSaveable { mutableStateOf("") }
    var assetId by rememberSaveable { mutableStateOf("") }
    val loadError = state.loadError

    fun pick(uri: Uri?) {
        if (uri == null) return
        scope.launch {
            val picked = context.readPickedFile(uri)
            when {
                picked == null -> store.rejectUnreadable()
                picked.bytes == null -> store.rejectTooLarge(picked.name)
                else -> store.pickFile(picked.name, picked.mime, picked.bytes)
            }
        }
    }

    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { pick(it) }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { pick(it) }
    var capture by rememberSaveable { mutableStateOf<String?>(null) }
    var noCamera by rememberSaveable { mutableStateOf(false) }
    val takePhoto =
        rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { taken ->
            val path = capture
            capture = null
            if (taken && path != null) pick(context.captureUri(path))
        }

    AppScaffold(
        title = tr("receipts_submit"),
        onBack = { nav.popBackStack() },
        bottomBar = {
            if (!state.loading && state.createdId == null) {
                Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
                    PrimaryButton(
                        text = tr("quick_receipt_submit"),
                        pendingText = tr("quick_receipt_sending"),
                        onClick = { store.submit(ReceiptForm(note, bookId, assetId)) },
                        pending = state.saving,
                        enabled = state.fileProblem == null,
                        modifier = Modifier.padding(horizontal = ScreenPadding, vertical = 12.dp),
                    )
                }
            }
        },
    ) { padding ->
        when {
            state.createdId != null || state.undone ->
                Column(
                    Modifier.padding(padding).padding(ScreenPadding),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        tr(if (state.undone) "quick_receipt_undone_toast" else "quick_receipt_sent_toast"),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    state.error?.let { InlineError(it) }
                    if (!state.undone) {
                        OutlinedButton(onClick = store::undo) { Text(tr("common_undo"), maxLines = 1) }
                    }
                    PrimaryButton(
                        text = tr("quick_receipt_another"),
                        onClick = {
                            note = ""
                            store.reset()
                        },
                    )
                    TextButton(onClick = {
                        nav.popBackStack()
                        nav.navigate(Routes.costsReceipts("pending"))
                    }) { Text(tr("m_receipts_sent_open"), maxLines = 1) }
                }
            loadError != null -> ErrorBox(loadError, Modifier.padding(padding), onRetry = store::retry)
            state.loading -> LoadingBox(Modifier.padding(padding))
            else ->
                Column(
                    Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(ScreenPadding),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        tr("quick_receipt_explainer"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(tr("quick_receipt_file"), style = MaterialTheme.typography.titleSmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilledTonalButton(onClick = {
                            val target = context.newCaptureTarget()
                            capture = target.first.path
                            noCamera = false
                            try {
                                takePhoto.launch(target.second)
                            } catch (_: ActivityNotFoundException) {
                                capture = null
                                noCamera = true
                            }
                        }) {
                            Icon(Icons.Outlined.AddAPhoto, contentDescription = null)
                            Text(tr("quick_receipt_camera"), Modifier.padding(start = 8.dp), maxLines = 1)
                        }
                        FilledTonalButton(
                            onClick = { pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                        ) {
                            Icon(Icons.Outlined.PhotoLibrary, contentDescription = tr("m_attach_from_library"))
                        }
                        FilledTonalButton(onClick = { pickFile.launch(arrayOf("application/pdf", "image/*")) }) {
                            Icon(Icons.Outlined.InsertDriveFile, contentDescription = tr("attach_choose_file"))
                        }
                    }
                    Text(
                        state.fileName?.let { it + (state.fileSizeText?.let { size -> " ($size)" } ?: "") } ?: tr("m_receipts_file_none"),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    if (noCamera) InlineError(tr("m_attach_no_camera"))
                    state.fileProblem?.let { InlineError(it) }
                    state.fileWarning?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                    state.fieldErrors["file"]?.let { if (it != state.fileProblem) InlineError(it) }
                    if (state.fileName != null) {
                        TextButton(onClick = store::clearFile) { Text(tr("quick_receipt_remove"), maxLines = 1) }
                    }
                    TextField(
                        label = tr("quick_receipt_note"),
                        value = note,
                        onChange = { note = it },
                        hint = tr("quick_receipt_note_hint"),
                        error = state.fieldErrors["note"],
                        singleLine = false,
                        minLines = 3,
                        capitalization = KeyboardCapitalization.Sentences,
                    )
                    if (state.books.isNotEmpty()) {
                        ChoiceField(
                            label = tr("cost_book"),
                            value = bookId,
                            options = state.books.map { it.value to it.label },
                            onChange = { bookId = it },
                            error = state.fieldErrors["bookId"],
                        )
                        Text(
                            tr("quick_receipt_book_hint"),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    ChoiceField(
                        label = tr("cost_asset"),
                        value = assetId,
                        options = state.assets.map { it.value to it.label },
                        onChange = { assetId = it },
                        error = state.fieldErrors["assetId"],
                    )
                    state.error?.let { InlineError(it) }
                    if (state.noAnswer) {
                        TextButton(onClick = {
                            nav.popBackStack()
                            nav.navigate(Routes.costsReceipts("pending"))
                        }) { Text(tr("quick_receipt_check_list"), maxLines = 1) }
                    }
                }
        }
    }
}
