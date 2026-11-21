package ch.orellbuehler.hauswart.android.ui.recurring

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Repeat
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.SectionTitle
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.costbooks.ActionMenu
import ch.orellbuehler.hauswart.android.ui.costbooks.MenuAction
import ch.orellbuehler.hauswart.android.ui.costs.AmountText
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.recurring.RecurringListStore
import ch.orellbuehler.hauswart.feature.recurring.RecurringRowView
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun RecurringScreen(nav: NavController) {
    val store = rememberStore { RecurringListStore(it) }
    val state = store.collect()
    val snackbar = remember { SnackbarHostState() }
    var deleteId by rememberSaveable { mutableStateOf<String?>(null) }
    val error = state.error
    val viewLabel = tr("finance_view")

    LaunchedEffect(state.notice) {
        val notice = state.notice ?: return@LaunchedEffect
        store.dismissNotice()
        val result = snackbar.showSnackbar(notice.message, if (notice.entryId != null) viewLabel else null)
        if (result == SnackbarResult.ActionPerformed) notice.entryId?.let { nav.navigate(Routes.cost(it)) }
    }
    LaunchedEffect(state.actionError) {
        state.actionError?.let {
            snackbar.showSnackbar(it.message)
            store.dismissActionError()
        }
    }

    AppScaffold(
        title = tr("recurrence_title"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        floatingActionButton = {
            FloatingActionButton(onClick = { nav.openRecurringEdit(null) }) {
                Icon(Icons.Outlined.Add, contentDescription = tr("recurrence_new"))
            }
        },
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.total == 0 -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            state.total == 0 ->
                EmptyState(
                    title = tr("recurrence_empty_title"),
                    body = tr("recurrence_empty_body"),
                    icon = Icons.Outlined.Repeat,
                    modifier = Modifier.padding(padding),
                )
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn(
                        contentPadding = PaddingValues(start = ScreenPadding, end = ScreenPadding, bottom = 88.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        item {
                            Text(
                                state.countText,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        state.sections.forEach { section ->
                            item(key = "section-${section.state}") { SectionTitle(section.title, trailing = section.rows.size.toString()) }
                            items(section.rows, key = { it.id }) { row ->
                                RecurringCard(
                                    row = row,
                                    busy = state.busyId == row.id,
                                    onOpen = { nav.navigate(Routes.recurring(row.id)) },
                                    onEdit = { nav.openRecurringEdit(row.id) },
                                    onRun = { store.runNow(row.id) },
                                    onPause = { store.pause(row.id) },
                                    onResume = { store.resume(row.id) },
                                    onDelete = { deleteId = row.id },
                                )
                            }
                        }
                    }
                }
        }
    }

    deleteId?.let { id ->
        ConfirmDialog(
            title = tr("recurrence_delete_title"),
            text = store.deleteText(id),
            confirmLabel = tr("common_delete"),
            destructive = true,
            onConfirm = {
                deleteId = null
                store.delete(id)
            },
            onDismiss = { deleteId = null },
        )
    }
}

@Composable
private fun RecurringCard(
    row: RecurringRowView,
    busy: Boolean,
    onOpen: () -> Unit,
    onEdit: () -> Unit,
    onRun: () -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onDelete: () -> Unit,
) {
    SectionCard {
        Column(
            Modifier.clickable(onClick = onOpen).padding(horizontal = 16.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(row.title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(
                        row.subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                AmountText(row.amount, row.refund, style = MaterialTheme.typography.titleSmall)
                ActionMenu(
                    description = tr("recurrence_actions", "title" to row.title),
                    enabled = !busy,
                    actions =
                        listOfNotNull(
                            MenuAction(tr("common_edit"), onEdit),
                            if (row.due) MenuAction(tr("recurrence_run_now"), onRun) else null,
                            when (row.state) {
                                "active" -> MenuAction(tr("recurrence_pause"), onPause)
                                "paused" -> MenuAction(tr("recurrence_resume"), onResume)
                                else -> null
                            },
                            MenuAction(tr("common_delete"), onDelete, destructive = true),
                        ),
                )
            }
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                StatusChip(row.stateLabel, tone = row.stateTone)
                Text(row.nextText, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(row.lastText, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            row.clampNote?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            row.error?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Start)
            }
        }
    }
}
