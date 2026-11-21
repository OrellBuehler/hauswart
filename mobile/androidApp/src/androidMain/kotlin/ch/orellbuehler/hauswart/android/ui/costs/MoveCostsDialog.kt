package ch.orellbuehler.hauswart.android.ui.costs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.LocalApp
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.inventory.FormDialog
import ch.orellbuehler.hauswart.feature.costs.MoveCostsStore
import ch.orellbuehler.hauswart.feature.costs.MovePick
import ch.orellbuehler.hauswart.i18n.tr

/** Moves the picked entries into another book; [onDone] gets what the move did in one line. */
@Composable
fun MoveCostsDialog(
    pick: MovePick,
    onDismiss: () -> Unit,
    onDone: (String) -> Unit,
) {
    val app = LocalApp.current
    val store = remember(pick) { MoveCostsStore(app, pick) }
    DisposableEffect(store) { onDispose { store.close() } }
    val state = store.collect()
    LaunchedEffect(state.doneText) { state.doneText?.let(onDone) }
    FormDialog(
        title = tr("costs_move_title"),
        onDismiss = onDismiss,
        onSave = store::move,
        pending = state.moving,
        saveLabel = tr("costs_move_submit"),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(state.description, style = MaterialTheme.typography.bodyMedium)
            val loadError = state.loadError
            if (loadError != null) {
                InlineError(loadError.message)
                TextButton(onClick = store::retry) { Text(tr("common_retry"), maxLines = 1) }
            } else {
                ChoiceField(
                    label = tr("costs_move_to"),
                    value = state.bookId,
                    options = state.books.map { it.id to it.name },
                    onChange = store::chooseBook,
                    modifier = Modifier,
                    error = state.bookError,
                )
                state.taxNote?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            state.error?.let { InlineError(it.message) }
        }
    }
}
