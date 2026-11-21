package ch.orellbuehler.hauswart.android.ui.notifications

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AlarmOn
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.DoneAll
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.ViewList
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.toneColor
import ch.orellbuehler.hauswart.android.ui.nav.open
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.notifications.NotificationRow
import ch.orellbuehler.hauswart.feature.notifications.NotificationsStore
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun NotificationsScreen(nav: NavController) {
    val store = rememberStore { NotificationsStore(it) }
    val state = store.collect()
    val error = state.error
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(state.actionError) {
        state.actionError?.let {
            snackbar.showSnackbar(it.message)
            store.dismissActionError()
        }
    }

    AppScaffold(
        title = tr("notifications_title"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            IconButton(onClick = store::markAllRead, enabled = state.unreadCount > 0 && !state.markingAll) {
                Icon(Icons.Outlined.DoneAll, contentDescription = tr("notifications_mark_all"))
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding)) {
            Row(Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = !state.onlyUnread,
                    onClick = { store.setOnlyUnread(false) },
                    label = { Text(tr("notifications_filter_all"), maxLines = 1) },
                )
                FilterChip(
                    selected = state.onlyUnread,
                    onClick = { store.setOnlyUnread(true) },
                    label = { Text(tr("notifications_filter_unread"), maxLines = 1) },
                )
            }
            when {
                state.loading -> LoadingBox()
                error != null && state.rows.isEmpty() -> ErrorBox(error, onRetry = store::refresh)
                state.rows.isEmpty() ->
                    EmptyState(
                        title = tr(if (state.onlyUnread) "notifications_empty_unread_title" else "notifications_empty_title"),
                        body = tr(if (state.onlyUnread) "notifications_empty_unread_body" else "notifications_empty_body"),
                        icon = Icons.Outlined.NotificationsNone,
                    )
                else ->
                    PullToRefresh(onRefresh = store::refresh) {
                        LazyColumn {
                            items(state.rows, key = { it.id }) { row ->
                                NotificationItem(row) {
                                    store.markRead(row.id)
                                    row.link?.let { nav.open(it) }
                                }
                            }
                            if (state.hasMore) {
                                item(key = "more") {
                                    Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                                        if (state.loadingMore) {
                                            CircularProgressIndicator()
                                        } else {
                                            OutlinedButton(onClick = store::loadMore) { Text(tr("common_load_more")) }
                                        }
                                    }
                                }
                            }
                        }
                    }
            }
        }
    }
}

private fun iconOf(kind: String): ImageVector =
    when (kind) {
        "prep" -> Icons.Outlined.Inventory2
        "due_soon" -> Icons.Outlined.AlarmOn
        "due" -> Icons.Outlined.NotificationsActive
        "overdue" -> Icons.Outlined.Warning
        "digest" -> Icons.Outlined.ViewList
        "comment" -> Icons.Outlined.ChatBubbleOutline
        "hint" -> Icons.Outlined.Lightbulb
        else -> Icons.Outlined.Info
    }

private fun toneOf(kind: String): String =
    when (kind) {
        "overdue" -> "overdue"
        "due", "due_soon", "hint" -> "due"
        else -> "muted"
    }

/** A notification can be a sentence long, so its text gets up to three lines (the kit's rows keep to one). */
@Composable
private fun NotificationItem(
    row: NotificationRow,
    onClick: () -> Unit,
) {
    val unread = tr("notifications_unread")
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = ScreenPadding, vertical = 12.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(iconOf(row.kind), contentDescription = null, tint = toneColor(toneOf(row.kind)))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                row.text,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (row.unread) FontWeight.SemiBold else FontWeight.Normal,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
            Text(row.whenText, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (row.unread) {
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(top = 6.dp).size(10.dp).semantics { contentDescription = unread },
            ) {}
        }
    }
}
