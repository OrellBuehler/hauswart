package ch.orellbuehler.hauswart.android.ui.budgets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
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
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.SectionTitle
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.toneColor
import ch.orellbuehler.hauswart.android.ui.costbooks.ActionMenu
import ch.orellbuehler.hauswart.android.ui.costbooks.MenuAction
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.budgets.BUDGET_PERIODS
import ch.orellbuehler.hauswart.feature.budgets.BudgetRowView
import ch.orellbuehler.hauswart.feature.budgets.BudgetsStore
import ch.orellbuehler.hauswart.feature.budgets.budgetPeriodLabel
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun BudgetsScreen(nav: NavController) {
    val store = rememberStore { BudgetsStore(it) }
    val state = store.collect()
    val snackbar = remember { SnackbarHostState() }
    var deleteId by rememberSaveable { mutableStateOf<String?>(null) }
    val error = state.error

    LaunchedEffect(state.notice) {
        state.notice?.let {
            snackbar.showSnackbar(it)
            store.dismissNotice()
        }
    }
    LaunchedEffect(state.actionError) {
        state.actionError?.let {
            snackbar.showSnackbar(it.message)
            store.dismissActionError()
        }
    }

    AppScaffold(
        title = tr("budgets_title"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        floatingActionButton = {
            FloatingActionButton(onClick = { nav.openBudgetEdit(null, state.period) }) {
                Icon(Icons.Outlined.Add, contentDescription = tr("budgets_new"))
            }
        },
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && !state.hasBudgets -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            !state.hasBudgets ->
                EmptyState(
                    title = tr("budgets_empty_title"),
                    body = tr("budgets_empty_body"),
                    icon = Icons.Outlined.Speed,
                    modifier = Modifier.padding(padding),
                )
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn(
                        contentPadding = PaddingValues(start = ScreenPadding, end = ScreenPadding, bottom = 88.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                BUDGET_PERIODS.forEach { period ->
                                    FilterChip(
                                        selected = period == state.period,
                                        onClick = { store.selectPeriod(period) },
                                        label = { Text(budgetPeriodLabel(period), maxLines = 1) },
                                    )
                                }
                            }
                        }
                        item {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                IconButton(onClick = store::previous, enabled = state.canPrevious) {
                                    Icon(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, contentDescription = tr("budgets_period_nav"))
                                }
                                Text(
                                    state.periodLabel,
                                    Modifier.weight(1f),
                                    style = MaterialTheme.typography.titleMedium,
                                    textAlign = TextAlign.Center,
                                    maxLines = 1,
                                )
                                IconButton(onClick = store::next, enabled = state.canNext) {
                                    Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = tr("budgets_period_nav"))
                                }
                            }
                            if (!state.isCurrent) {
                                TextButton(onClick = store::goToToday) { Text(state.todayLabel, maxLines = 1) }
                            }
                        }
                        if (state.rows.isEmpty()) {
                            item { EmptyState(title = state.emptyTitle, body = state.emptyBody, icon = Icons.Outlined.Speed) }
                        } else {
                            item {
                                Text(
                                    state.countText,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            items(state.rows, key = { it.id }) { row ->
                                BudgetCard(
                                    row = row,
                                    busy = state.busyId == row.id,
                                    onEdit = { nav.openBudgetEdit(row.id) },
                                    onPause = { store.pause(row.id) },
                                    onDelete = { deleteId = row.id },
                                )
                            }
                        }
                        if (state.paused.isNotEmpty()) {
                            item {
                                Column {
                                    SectionTitle(tr("budgets_inactive_title"))
                                    Text(
                                        tr("budgets_inactive_hint"),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            items(state.paused, key = { "paused-" + it.id }) { paused ->
                                SectionCard {
                                    ListRow(
                                        title = paused.title,
                                        subtitle = paused.subtitle,
                                        trailing = {
                                            Row(verticalAlignment = Alignment.CenterVertically) {
                                                Text(paused.amount, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                                                ActionMenu(
                                                    description = tr("budget_actions", "name" to paused.name),
                                                    enabled = state.busyId != paused.id,
                                                    actions =
                                                        listOf(
                                                            MenuAction(tr("budgets_resume"), { store.resume(paused.id) }),
                                                            MenuAction(tr("common_edit"), { nav.openBudgetEdit(paused.id) }),
                                                            MenuAction(tr("common_delete"), { deleteId = paused.id }, destructive = true),
                                                        ),
                                                )
                                            }
                                        },
                                    )
                                }
                            }
                        }
                        item {
                            Text(
                                state.legend,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
        }
    }

    deleteId?.let { id ->
        ConfirmDialog(
            title = tr("budget_delete_title"),
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
private fun BudgetCard(
    row: BudgetRowView,
    busy: Boolean,
    onEdit: () -> Unit,
    onPause: () -> Unit,
    onDelete: () -> Unit,
) {
    SectionCard {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(row.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        row.subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(row.spent, style = MaterialTheme.typography.titleSmall, maxLines = 1)
                    Text(
                        row.amountOf,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }
                ActionMenu(
                    description = tr("budget_actions", "name" to row.name),
                    enabled = !busy,
                    actions =
                        listOf(
                            MenuAction(tr("common_edit"), onEdit),
                            MenuAction(tr("budgets_pause"), onPause),
                            MenuAction(tr("common_delete"), onDelete, destructive = true),
                        ),
                )
            }
            LinearProgressIndicator(
                progress = { row.barPercent / 100f },
                modifier = Modifier.fillMaxWidth(),
                color = toneColor(row.tone),
            )
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                StatusChip(row.stateLabel + " · " + row.percentText, tone = row.tone)
                Text(
                    row.remaining,
                    Modifier.weight(1f),
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.End,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(row.entriesText, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
