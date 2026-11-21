package ch.orellbuehler.hauswart.android.ui.defects

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.DateField
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.inventory.FormDialog
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.defects.DefectCorrespondenceForm
import ch.orellbuehler.hauswart.feature.defects.DefectCorrespondenceStore
import ch.orellbuehler.hauswart.feature.defects.DefectStatusStore
import ch.orellbuehler.hauswart.i18n.tr

/** The dialog that moves a defect to [target]; [nonce] tells two openings apart. */
@Composable
internal fun DefectStatusDialog(
    id: String,
    target: String,
    nonce: Int,
    onDismiss: () -> Unit,
) {
    val store = rememberStore(key = "status-$id-$target-$nonce") { DefectStatusStore(it, id, target) }
    val state = store.collect()
    val initial = state.initial
    var form by remember(initial) { mutableStateOf(initial) }
    LaunchedEffect(state.done) { if (state.done) onDismiss() }
    FormDialog(
        title = state.title.ifEmpty { tr("nav_defects") },
        onDismiss = onDismiss,
        onSave = { form?.let(store::save) },
        pending = state.saving || form == null,
        saveLabel = state.submitLabel.ifEmpty { tr("common_save") },
    ) {
        val current = form
        when {
            current != null -> {
                Text(state.intro)
                if (state.needsDate) {
                    DateField(
                        label = state.dateLabel,
                        value = current.date,
                        onChange = { form = current.copy(date = it) },
                        error = state.fieldErrors["date"],
                        clearable = false,
                    )
                }
                TextField(
                    label = state.textLabel,
                    value = current.text,
                    onChange = { form = current.copy(text = it) },
                    error = state.fieldErrors["note"] ?: state.fieldErrors["resolutionMd"],
                    singleLine = false,
                    minLines = 3,
                    capitalization = KeyboardCapitalization.Sentences,
                )
                state.error?.let { InlineError(it.message) }
            }
            state.loadError != null -> ErrorBox(state.loadError!!, Modifier.padding(0.dp), onRetry = store::retry)
            else -> LoadingBox()
        }
    }
}

/** The dialog that notes a letter sent or received. */
@Composable
internal fun DefectCorrespondenceDialog(
    id: String,
    nonce: Int,
    onDismiss: () -> Unit,
) {
    val store = rememberStore(key = "correspondence-$id-$nonce") { DefectCorrespondenceStore(it, id) }
    val state = store.collect()
    var form by remember { mutableStateOf(DefectCorrespondenceForm()) }
    LaunchedEffect(state.done) { if (state.done) onDismiss() }
    FormDialog(
        title = tr("defect_correspondence_title"),
        onDismiss = onDismiss,
        onSave = { store.save(form) },
        pending = state.saving,
        saveLabel = tr("defect_correspondence_submit"),
    ) {
        Column(verticalArrangement = verticalArrangementSpacing()) {
            Text(tr("defect_correspondence_description"))
            TextField(
                label = tr("defect_correspondence_body"),
                value = form.body,
                onChange = { form = form.copy(body = it) },
                error = state.fieldErrors["bodyMd"],
                singleLine = false,
                minLines = 3,
                capitalization = KeyboardCapitalization.Sentences,
            )
            TextField(
                label = tr("defect_correspondence_reference"),
                value = form.reference,
                onChange = { form = form.copy(reference = it) },
                error = state.fieldErrors["externalRef"],
                hint = tr("defect_correspondence_reference_hint"),
            )
            state.error?.let { InlineError(it.message) }
        }
    }
}

private fun verticalArrangementSpacing() =
    androidx.compose.foundation.layout.Arrangement
        .spacedBy(12.dp)
