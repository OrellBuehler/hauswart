package ch.orellbuehler.hauswart.android.ui.docs

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.History
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.docs.DocRevisionsStore
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun DocRevisionsScreen(
    nav: NavController,
    slug: String,
) {
    val store = rememberStore(key = slug) { DocRevisionsStore(it, slug) }
    val state = store.collect()
    val error = state.error
    val snackbar = remember { SnackbarHostState() }
    var confirmRestore by remember { mutableStateOf(false) }

    LaunchedEffect(state.restored) { if (state.restored) nav.popBackStack() }
    LaunchedEffect(state.actionError) {
        state.actionError?.let {
            snackbar.showSnackbar(it.message)
            store.dismissActionError()
        }
    }

    AppScaffold(title = tr("docs_history_title"), onBack = { nav.popBackStack() }, snackbarHostState = snackbar) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.rows.isEmpty() -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            state.rows.isEmpty() ->
                EmptyState(
                    tr("docs_history_title"),
                    tr("docs_history_description"),
                    Modifier.padding(padding),
                    Icons.Outlined.History,
                )
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn {
                        item {
                            Text(
                                tr("docs_history_description"),
                                Modifier.padding(16.dp),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        items(state.rows, key = { it.rev }) { row ->
                            ListRow(
                                title = tr("docs_revision_label", "rev" to row.rev) + " · " + row.title,
                                subtitle = row.details,
                                trailing =
                                    if (state.opening == row.rev) {
                                        { CircularProgressIndicator(Modifier.padding(4.dp), strokeWidth = 2.dp) }
                                    } else if (row.current) {
                                        { StatusChip(tr("docs_revision_current")) }
                                    } else {
                                        null
                                    },
                                onClick = { store.open(row.rev) },
                            )
                        }
                    }
                }
        }
    }

    val opened = state.opened
    if (opened != null) {
        AlertDialog(
            onDismissRequest = store::closeOpened,
            title = { Text(tr("docs_revision_label", "rev" to opened.rev), maxLines = 1) },
            text = {
                Column {
                    Text(opened.title, style = MaterialTheme.typography.titleSmall)
                    Text(
                        tr("docs_revision_source"),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    SelectionContainer {
                        Text(
                            opened.markdown.ifEmpty { tr("docs_revision_empty") },
                            Modifier
                                .fillMaxWidth()
                                .heightIn(max = 280.dp)
                                .verticalScroll(rememberScrollState())
                                .padding(top = 4.dp),
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace,
                        )
                    }
                    if (opened.current) Text(tr("docs_revision_is_current"), Modifier.padding(top = 8.dp))
                }
            },
            confirmButton = {
                if (!opened.current) {
                    TextButton(onClick = { confirmRestore = true }, enabled = !state.restoring) {
                        Text(tr(if (state.restoring) "docs_restoring" else "docs_restore"), maxLines = 1)
                    }
                }
            },
            dismissButton = { TextButton(onClick = store::closeOpened) { Text(tr("docs_history_back"), maxLines = 1) } },
        )
        if (confirmRestore) {
            ConfirmDialog(
                title = tr("docs_restore_title", "rev" to opened.rev),
                text = tr("docs_restore_description"),
                confirmLabel = tr("docs_restore"),
                onConfirm = {
                    confirmRestore = false
                    store.restore(opened.rev)
                },
                onDismiss = { confirmRestore = false },
            )
        }
    }
}
