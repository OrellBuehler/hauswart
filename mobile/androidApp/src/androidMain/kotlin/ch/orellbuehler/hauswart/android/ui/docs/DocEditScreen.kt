package ch.orellbuehler.hauswart.android.ui.docs

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.SaveBar
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.android.ui.sections.AttachmentsSection
import ch.orellbuehler.hauswart.feature.attachments.AttachmentsStore
import ch.orellbuehler.hauswart.feature.docs.DOC_SECTIONS
import ch.orellbuehler.hauswart.feature.docs.DOC_TITLE_MAX
import ch.orellbuehler.hauswart.feature.docs.DocEditStore
import ch.orellbuehler.hauswart.feature.docs.docAttachmentMarkdown
import ch.orellbuehler.hauswart.feature.docs.docSectionLabel
import ch.orellbuehler.hauswart.feature.docs.docSizeText
import ch.orellbuehler.hauswart.feature.docs.docSizeWarning
import ch.orellbuehler.hauswart.i18n.tr

/** Creates a page when [slug] is null, else edits it: the fields of the web form and a plain Markdown text, with a rendered preview. */
@Composable
fun DocEditScreen(
    nav: NavController,
    slug: String?,
    section: String,
    assetId: String,
    roomId: String,
    title: String,
) {
    val store = rememberStore(key = slug ?: "new") { DocEditStore(it, slug, section, assetId, roomId, title) }
    val state = store.collect()
    val initial = state.initial
    var form by remember(state.initialVersion) { mutableStateOf(initial) }
    var preview by remember { mutableStateOf(false) }
    var confirmLeave by remember { mutableStateOf(false) }
    var inserting by remember { mutableStateOf(false) }
    val dirty = form != null && form != initial

    LaunchedEffect(state.savedSlug) {
        val saved = state.savedSlug ?: return@LaunchedEffect
        if (slug == null) {
            nav.navigate(Routes.doc(saved)) { popUpTo(nav.currentBackStackEntry?.destination?.id ?: 0) { inclusive = true } }
        } else {
            nav.popBackStack()
        }
    }
    val leave: () -> Unit = {
        if (dirty) confirmLeave = true else nav.popBackStack()
    }
    BackHandler(enabled = dirty) { confirmLeave = true }

    AppScaffold(
        title = tr(if (state.isNew) "editor_new_title" else "editor_edit_title"),
        onBack = leave,
        bottomBar = { if (form != null) SaveBar(onSave = { form?.let(store::save) }, pending = state.saving) },
    ) { padding ->
        val current = form
        val loadError = state.loadError
        when {
            current != null && preview ->
                Column(Modifier.padding(padding).fillMaxSize().padding(horizontal = ScreenPadding)) {
                    ModeChips(preview, onWrite = { preview = false }, onPreview = { store.preview(current.body) })
                    DocPreview(nav, store, state.previewHtml, state.previewLoading, state.previewError, Modifier.weight(1f).fillMaxWidth())
                }
            current != null ->
                Column(
                    Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(ScreenPadding),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    TextField(
                        label = tr("docs_field_title"),
                        value = current.title,
                        onChange = { form = current.copy(title = it.take(DOC_TITLE_MAX)) },
                        error = state.fieldErrors["title"],
                        capitalization = KeyboardCapitalization.Sentences,
                    )
                    ChoiceField(
                        label = tr("docs_field_section"),
                        value = current.section,
                        options = DOC_SECTIONS.map { it to docSectionLabel(it) },
                        onChange = { form = current.copy(section = it) },
                        error = state.fieldErrors["section"],
                    )
                    ChoicePicker(
                        label = tr("docs_field_asset"),
                        value = current.assetId,
                        options = state.assets.map { PickOption(it.id, it.label, "") },
                        noneLabel = tr("docs_field_none"),
                        onChange = { form = current.copy(assetId = it) },
                        error = state.fieldErrors["assetId"],
                    )
                    ChoicePicker(
                        label = tr("docs_field_room"),
                        value = current.roomId,
                        options = state.rooms.map { PickOption(it.id, it.label, "") },
                        noneLabel = tr("docs_field_none"),
                        onChange = { form = current.copy(roomId = it) },
                        error = state.fieldErrors["roomId"],
                    )
                    SwitchField(
                        label = tr("docs_field_pinned"),
                        hint = tr("docs_field_pinned_hint"),
                        checked = current.pinned,
                        onChange = { form = current.copy(pinned = it) },
                    )
                    SwitchField(
                        label = tr("docs_field_guest"),
                        hint = tr("docs_field_guest_hint"),
                        checked = current.guestVisible,
                        onChange = { form = current.copy(guestVisible = it) },
                    )
                    ModeChips(preview, onWrite = { preview = false }, onPreview = {
                        preview = true
                        store.preview(current.body)
                    })
                    TextField(
                        label = tr("editor_text"),
                        value = current.body,
                        onChange = { form = current.copy(body = it) },
                        error = state.fieldErrors["bodyMd"],
                        hint = tr("editor_placeholder"),
                        singleLine = false,
                        minLines = 12,
                        capitalization = KeyboardCapitalization.Sentences,
                    )
                    Text(
                        docSizeText(current.body),
                        style = MaterialTheme.typography.bodySmall,
                        color =
                            if (docSizeWarning(
                                    current.body,
                                )
                            ) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                    )
                    if (state.pageId.isNotEmpty()) {
                        OutlinedButton(onClick = { inserting = true }) { Text(tr("editor_insert_attachment"), maxLines = 1) }
                    }
                    state.error?.let { InlineError(it.message) }
                    if (state.pageId.isNotEmpty()) {
                        AttachmentsSection(ownerType = "page", ownerId = state.pageId)
                    } else {
                        Text(
                            tr("editor_new_uploads_hint"),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            loadError != null -> ErrorBox(loadError, Modifier.padding(padding), onRetry = store::retry)
            else -> LoadingBox(Modifier.padding(padding))
        }
        if (inserting && current != null) {
            InsertAttachmentDialog(
                pageId = state.pageId,
                onPick = { markdown ->
                    inserting = false
                    form = current.copy(body = current.body.trimEnd() + (if (current.body.isBlank()) "" else "\n\n") + markdown + "\n")
                },
                onDismiss = { inserting = false },
            )
        }
    }

    if (confirmLeave) {
        ConfirmDialog(
            title = tr("editor_leave_title"),
            text = tr("editor_leave_description"),
            confirmLabel = tr("editor_leave_confirm"),
            destructive = true,
            onConfirm = {
                confirmLeave = false
                nav.popBackStack()
            },
            onDismiss = { confirmLeave = false },
        )
    }
    if (state.conflict) {
        AlertDialog(
            onDismissRequest = store::dismissConflict,
            title = { Text(tr("editor_conflict_title")) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(state.conflictMessage)
                    Text(
                        tr("editor_conflict_reload_hint"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        tr("editor_conflict_keep_hint"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            },
            confirmButton = {
                Column(horizontalAlignment = androidx.compose.ui.Alignment.End) {
                    TextButton(onClick = { form?.let(store::keepMine) }, enabled = !state.resolving) {
                        Text(tr("editor_conflict_keep"), maxLines = 2)
                    }
                    TextButton(onClick = store::reloadTheirs, enabled = !state.resolving) {
                        Text(tr("editor_conflict_reload"), maxLines = 2)
                    }
                    TextButton(onClick = store::dismissConflict) { Text(tr("editor_conflict_close"), maxLines = 1) }
                }
            },
        )
    }
}

@Composable
private fun ModeChips(
    preview: Boolean,
    onWrite: () -> Unit,
    onPreview: () -> Unit,
) {
    Row(Modifier.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(selected = !preview, onClick = onWrite, label = { Text(tr("editor_tab_write")) })
        FilterChip(selected = preview, onClick = onPreview, label = { Text(tr("editor_tab_preview")) })
    }
}

/** The rendered preview fills the rest of the screen; the web view scrolls by itself. */
@Composable
private fun DocPreview(
    nav: NavController,
    store: DocEditStore,
    html: String,
    loading: Boolean,
    error: String?,
    modifier: Modifier,
) {
    val cannotOpen = remember { mutableStateOf(false) }
    val onLink = rememberDocLinkHandler(nav, store::linkTarget, { }, { cannotOpen.value = true })
    error?.let { InlineError(it) }
    if (html.isBlank() && !loading && error == null) {
        Text(tr("editor_preview_empty"), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (loading) Text(tr("common_loading"), color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (html.isNotBlank()) DocWebView(bodyHtml = html, onLink = onLink, modifier = modifier)
}

@Composable
private fun InsertAttachmentDialog(
    pageId: String,
    onPick: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val store = rememberStore(key = "attachments-page-$pageId") { AttachmentsStore(it, "page", pageId) }
    val state = store.collect()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr("editor_attachment_title")) },
        text = {
            Column {
                if (state.rows.isEmpty()) Text(tr("editor_attachment_empty"))
                state.rows.forEach { row ->
                    ListRow(
                        title = row.label,
                        subtitle = row.sizeText,
                        onClick = { onPick(docAttachmentMarkdown(row.id, row.filename, row.caption, row.kind == "image")) },
                    )
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr("common_cancel")) } },
    )
}
