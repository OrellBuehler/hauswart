package ch.orellbuehler.hauswart.android.ui.documents

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.nav.open
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.documents.DocumentSuggestionsStore
import ch.orellbuehler.hauswart.feature.documents.SUGGESTION_ASSET
import ch.orellbuehler.hauswart.i18n.tr

/** Receipts that no device stands for ([kind] `asset`) or correspondents that no contact stands for (`contact`). */
@Composable
fun DocumentSuggestionsScreen(
    nav: NavController,
    kind: String,
) {
    val store = rememberStore(key = kind) { DocumentSuggestionsStore(it, kind) }
    val state = store.collect()
    val error = state.error
    val snackbar = remember { SnackbarHostState() }
    var showIgnored by remember { mutableStateOf(false) }
    val asset = kind == SUGGESTION_ASSET

    LaunchedEffect(state.notice) {
        val notice = state.notice ?: return@LaunchedEffect
        val link = state.createdLink
        store.dismissNotice()
        val result = snackbar.showSnackbar(notice, if (link != null) tr("document_suggestion_open") else null)
        if (result == SnackbarResult.ActionPerformed && link != null) nav.open(link)
    }

    AppScaffold(
        title = tr(if (asset) "document_suggestions_asset_title" else "document_suggestions_contact_title"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
    ) { padding ->
        when {
            state.loading && state.visible.isEmpty() && state.ignored.isEmpty() -> LoadingBox(Modifier.padding(padding))
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            state.none ->
                EmptyState(
                    tr("document_suggestions_empty_title"),
                    tr(if (asset) "document_suggestions_asset_empty_body" else "document_suggestions_contact_empty_body"),
                    Modifier.padding(padding),
                    Icons.Outlined.Description,
                )
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn {
                        item {
                            Text(
                                tr(if (asset) "document_suggestions_asset_description" else "document_suggestions_contact_description"),
                                Modifier.padding(ScreenPadding),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (state.visible.isEmpty()) {
                            item { Text(tr("document_suggestions_all_handled"), Modifier.padding(ScreenPadding)) }
                        }
                        items(state.visible, key = { it.key }) { row ->
                            Column(
                                Modifier.fillMaxWidth().padding(horizontal = ScreenPadding, vertical = 8.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Text(row.title, style = MaterialTheme.typography.titleSmall)
                                if (row.subtitle.isNotEmpty()) {
                                    Text(
                                        row.subtitle,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                if (row.warranty.isNotEmpty()) Text(row.warranty, style = MaterialTheme.typography.bodySmall)
                                state.rowErrors[row.key]?.let { InlineError(it) }
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Button(
                                        onClick = { store.adopt(row.key) },
                                        enabled = state.busyKey == null,
                                        modifier = Modifier.weight(1f),
                                    ) {
                                        Icon(Icons.Outlined.Check, contentDescription = null)
                                        Text(
                                            tr(if (asset) "document_suggestion_asset_create" else "document_suggestion_contact_create"),
                                            Modifier.padding(start = 8.dp),
                                            maxLines = 1,
                                        )
                                    }
                                    OutlinedButton(onClick = { store.dismiss(row.key) }, enabled = state.busyKey == null) {
                                        Text(tr("device_suggestions_ignore"), maxLines = 1)
                                    }
                                }
                            }
                        }
                        if (state.ignored.isNotEmpty()) {
                            item {
                                TextButton(
                                    onClick = { showIgnored = !showIgnored },
                                    modifier = Modifier.padding(horizontal = ScreenPadding),
                                ) {
                                    Text(tr("document_suggestions_ignored", "count" to state.ignored.size), maxLines = 1)
                                }
                            }
                            if (showIgnored) {
                                items(state.ignored, key = { "ignored-${it.key}" }) { row ->
                                    ListRow(
                                        title = row.title,
                                        trailing = {
                                            TextButton(
                                                onClick = { store.restore(row.key) },
                                            ) { Text(tr("device_suggestions_restore"), maxLines = 1) }
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
        }
    }
}
