package ch.orellbuehler.hauswart.android.ui.inbox

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.PowerOff
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
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
import ch.orellbuehler.hauswart.android.ui.components.SectionTitle
import ch.orellbuehler.hauswart.android.ui.components.openUri
import ch.orellbuehler.hauswart.android.ui.costs.AmountText
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.inbox.InboxNotice
import ch.orellbuehler.hauswart.feature.inbox.InboxStore
import ch.orellbuehler.hauswart.feature.inbox.SuggestionView
import ch.orellbuehler.hauswart.i18n.tr

/** Where an accepted suggestion can be seen: an entry opens its screen, a device or a task too. */
internal fun NavController.openAccepted(notice: InboxNotice) {
    val id = notice.targetId ?: return
    when (notice.targetKind) {
        "cost" -> navigate(Routes.cost(id))
        "asset" -> navigate(Routes.asset(id))
        "task" -> navigate(Routes.task(id))
    }
}

@Composable
fun InboxScreen(nav: NavController) {
    val store = rememberStore { InboxStore(it) }
    val state = store.collect()
    val snackbar = remember { SnackbarHostState() }
    var dismissId by rememberSaveable { mutableStateOf<String?>(null) }
    val context: Context = LocalContext.current
    val error = state.error
    val viewLabel = tr("finance_view")

    LaunchedEffect(state.notice) {
        val notice = state.notice ?: return@LaunchedEffect
        store.dismissNotice()
        val result = snackbar.showSnackbar(notice.message, if (notice.targetId != null) viewLabel else null)
        if (result == SnackbarResult.ActionPerformed) nav.openAccepted(notice)
    }

    AppScaffold(
        title = tr("finance_inbox_title"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            if (state.financeConnected) {
                IconButton(onClick = store::sync, enabled = !state.syncing) {
                    if (state.syncing) {
                        CircularProgressIndicator(Modifier.padding(4.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Outlined.Sync, contentDescription = tr("finance_sync"))
                    }
                }
            }
        },
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.total == 0 -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            !state.financeConnected && state.total == 0 ->
                EmptyState(
                    title = tr("finance_not_connected_title"),
                    body = tr("finance_not_connected_body"),
                    icon = Icons.Outlined.PowerOff,
                    modifier = Modifier.padding(padding),
                )
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn(
                        contentPadding = PaddingValues(start = ScreenPadding, end = ScreenPadding, bottom = 24.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        item {
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(
                                    tr("finance_inbox_description"),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                state.syncError?.let { InlineError(it) }
                                state.actionError?.let { InlineError(it) }
                            }
                        }
                        if (state.total == 0) {
                            item {
                                EmptyState(
                                    title = tr("finance_empty_title"),
                                    body = tr("finance_empty_body"),
                                    icon = Icons.Outlined.Inbox,
                                    action = {
                                        Button(onClick = store::sync, enabled = !state.syncing) { Text(tr("finance_sync"), maxLines = 1) }
                                    },
                                )
                            }
                        } else {
                            item { Text(state.countText, style = MaterialTheme.typography.bodySmall) }
                        }
                        state.groups.forEach { group ->
                            item(key = "group-${group.kind}") {
                                Column {
                                    SectionTitle(group.title, trailing = group.items.size.toString())
                                    group.hint?.let {
                                        Text(
                                            it,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                            }
                            items(group.items, key = { it.id }) { suggestion ->
                                SuggestionCard(
                                    suggestion = suggestion,
                                    busy = if (state.busyId == suggestion.id) state.busyAction else null,
                                    locked = state.busyId != null,
                                    onAccept = { store.accept(suggestion.id) },
                                    onAdjust = { nav.openSuggestionAccept(suggestion.id) },
                                    onDismiss = { dismissId = suggestion.id },
                                    onOpenEntry = { id -> nav.navigate(Routes.cost(id)) },
                                    onOpenUrl = { url -> context.openUri(url) },
                                )
                            }
                        }
                    }
                }
        }
    }

    dismissId?.let { id ->
        ConfirmDialog(
            title = store.dismissTitle(id),
            text = store.dismissText(id),
            confirmLabel = store.dismissLabel(id),
            destructive = true,
            onConfirm = {
                dismissId = null
                store.dismiss(id)
            },
            onDismiss = { dismissId = null },
        )
    }
}

@Composable
private fun SuggestionCard(
    suggestion: SuggestionView,
    busy: String?,
    locked: Boolean,
    onAccept: () -> Unit,
    onAdjust: () -> Unit,
    onDismiss: () -> Unit,
    onOpenEntry: (String) -> Unit,
    onOpenUrl: (String) -> Unit,
) {
    SectionCard {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(suggestion.title, style = MaterialTheme.typography.titleSmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    Text(suggestion.meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    suggestion.note?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                }
                suggestion.amount?.let { AmountText(it, suggestion.refund, style = MaterialTheme.typography.titleSmall) }
            }
            suggestion.linkExplain?.let { explain ->
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(tr("finance_link_entry_heading"), style = MaterialTheme.typography.labelMedium)
                    suggestion.linkedEntry?.let { entry ->
                        TextButton(
                            onClick = { onOpenEntry(entry.id) },
                        ) { Text(entry.title, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        Text(entry.meta, style = MaterialTheme.typography.bodySmall)
                    }
                    Text(explain, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (!suggestion.linkGone) {
                    Button(onClick = onAccept, enabled = !locked) {
                        Text(if (busy == "accept") tr("finance_accepting") else suggestion.acceptLabel, maxLines = 1)
                    }
                }
                if (suggestion.canAdjust) {
                    OutlinedButton(onClick = onAdjust, enabled = !locked) { Text(tr("finance_adjust"), maxLines = 1) }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDismiss, enabled = !locked) {
                    Text(
                        if (busy == "dismiss") {
                            tr("finance_dismissing")
                        } else if (suggestion.kind == "link") {
                            tr("finance_link_dismiss")
                        } else {
                            tr("finance_dismiss")
                        },
                        maxLines = 1,
                    )
                }
                suggestion.url?.let { url ->
                    TextButton(
                        onClick = { onOpenUrl(url) },
                    ) { Text(tr("finance_open_in_app"), maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
            }
        }
    }
}
