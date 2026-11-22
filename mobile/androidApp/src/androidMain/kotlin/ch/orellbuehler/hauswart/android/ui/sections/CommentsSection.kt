package ch.orellbuehler.hauswart.android.ui.sections

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.PrimaryButton
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.comments.CommentRow
import ch.orellbuehler.hauswart.feature.comments.CommentsStore
import ch.orellbuehler.hauswart.i18n.tr

/**
 * The comments of one entity as a card: the thread, with edit and delete on the person's own
 * comments, and a field to write a new one.
 *
 * Usage: `CommentsSection(ownerType = "task", ownerId = task.id)` inside the owner's scrolling
 * column. [ownerType] is the comments registry's entity type (`task`, `defect`, `asset`, `room`,
 * `part`, `contact`, `service_log`, `asset_hint`, `doc_page`, `cost`, `insurance_policy`,
 * `appointment`). It loads and refreshes itself and reports `comments` changes through the app.
 */
@Composable
fun CommentsSection(
    ownerType: String,
    ownerId: String,
    modifier: Modifier = Modifier,
) {
    val store = rememberStore(key = "comments-$ownerType-$ownerId") { CommentsStore(it, ownerType, ownerId) }
    val state = store.collect()
    var draft by rememberSaveable { mutableStateOf("") }
    var editingId by rememberSaveable { mutableStateOf<String?>(null) }
    var editDraft by rememberSaveable { mutableStateOf("") }
    var deleteId by rememberSaveable { mutableStateOf<String?>(null) }

    OnValueChange(state.added) { draft = "" }
    OnValueChange(state.edited) { editingId = null }

    val title = tr("comments_title") + if (state.count > 0) " · ${state.count}" else ""
    SectionCard(modifier = modifier, title = title) {
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            val error = state.error
            when {
                state.loading ->
                    CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))
                error != null && state.rows.isEmpty() -> {
                    InlineError(error.message)
                    TextButton(onClick = store::refresh) { Text(tr("common_retry")) }
                }
                else -> {
                    if (state.rows.isEmpty()) {
                        Text(
                            tr("comments_empty"),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    state.rows.forEach { row ->
                        CommentItem(
                            row = row,
                            editing = editingId == row.id,
                            editDraft = editDraft,
                            onEditDraft = { editDraft = it },
                            saving = state.savingId == row.id,
                            editError = if (editingId == row.id) state.editError?.message else null,
                            onStartEdit = {
                                editDraft = row.body
                                editingId = row.id
                                store.dismissEditError()
                            },
                            onCancelEdit = {
                                editingId = null
                                store.dismissEditError()
                            },
                            onSave = { store.edit(row.id, editDraft) },
                            onDelete = { deleteId = row.id },
                        )
                    }
                    state.actionError?.let { InlineError(it.message) }
                    TextField(
                        label = tr("comments_composer_label"),
                        value = draft,
                        onChange = { draft = it },
                        singleLine = false,
                        minLines = 2,
                        capitalization = KeyboardCapitalization.Sentences,
                        hint = tr("comments_composer_placeholder"),
                        enabled = !state.adding,
                    )
                    state.addError?.let { InlineError(it.message) }
                    PrimaryButton(
                        text = tr("comments_send"),
                        pendingText = tr("comments_sending"),
                        onClick = { store.add(draft) },
                        pending = state.adding,
                        enabled = draft.isNotBlank(),
                    )
                }
            }
        }
    }

    val pendingDelete = state.rows.firstOrNull { it.id == deleteId }
    if (pendingDelete != null) {
        ConfirmDialog(
            title = tr("comments_delete_title"),
            text = tr("comments_delete_description"),
            confirmLabel = tr("common_delete"),
            destructive = true,
            onConfirm = {
                deleteId = null
                store.delete(pendingDelete.id)
            },
            onDismiss = { deleteId = null },
        )
    }
}

@Composable
private fun CommentItem(
    row: CommentRow,
    editing: Boolean,
    editDraft: String,
    onEditDraft: (String) -> Unit,
    saving: Boolean,
    editError: String?,
    onStartEdit: () -> Unit,
    onCancelEdit: () -> Unit,
    onSave: () -> Unit,
    onDelete: () -> Unit,
) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(row.author, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Medium)
                Text(
                    listOfNotNull(row.whenText, if (row.edited) "(${tr("comments_edited")})" else null).joinToString(" "),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (!editing && row.canEdit) {
                IconButton(onClick = onStartEdit) { Icon(Icons.Outlined.Edit, contentDescription = tr("comments_edit")) }
            }
            if (!editing && row.canDelete) {
                IconButton(onClick = onDelete) { Icon(Icons.Outlined.Delete, contentDescription = tr("comments_delete")) }
            }
        }
        when {
            row.deleted ->
                Text(
                    tr("comments_deleted"),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            editing -> {
                TextField(
                    label = tr("comments_edit_label"),
                    value = editDraft,
                    onChange = onEditDraft,
                    singleLine = false,
                    minLines = 3,
                    capitalization = KeyboardCapitalization.Sentences,
                    enabled = !saving,
                )
                editError?.let { InlineError(it) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), modifier = Modifier.fillMaxWidth()) {
                    TextButton(onClick = onCancelEdit, enabled = !saving) { Text(tr("common_cancel")) }
                    TextButton(onClick = onSave, enabled = !saving && editDraft.isNotBlank()) {
                        Text(if (saving) tr("common_saving") else tr("common_save"))
                    }
                }
            }
            else -> CommentBody(row)
        }
    }
}

@Composable
private fun CommentBody(row: CommentRow) {
    val link = MaterialTheme.colorScheme.primary
    val text =
        buildAnnotatedString {
            row.segments.forEach { segment ->
                val href = segment.href
                if (href == null) {
                    append(segment.text)
                } else {
                    withLink(LinkAnnotation.Url(href, TextLinkStyles(SpanStyle(color = link, textDecoration = TextDecoration.Underline)))) {
                        append(segment.text)
                    }
                }
            }
        }
    Text(text, style = MaterialTheme.typography.bodyMedium)
}
