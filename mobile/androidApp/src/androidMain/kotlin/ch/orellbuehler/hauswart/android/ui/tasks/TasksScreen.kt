package ch.orellbuehler.hauswart.android.ui.tasks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ListAlt
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.dashboard.TONE_MUTED
import ch.orellbuehler.hauswart.feature.tasks.ACTION_COMPLETE
import ch.orellbuehler.hauswart.feature.tasks.ACTION_SKIP
import ch.orellbuehler.hauswart.feature.tasks.ACTION_SNOOZE
import ch.orellbuehler.hauswart.feature.tasks.TasksListStore
import ch.orellbuehler.hauswart.feature.tasks.taskCategoryFilterOptions
import ch.orellbuehler.hauswart.feature.tasks.taskStatusOptions
import ch.orellbuehler.hauswart.feature.tasks.taskViewOptions
import ch.orellbuehler.hauswart.i18n.tr

private data class OpenAction(
    val taskId: String,
    val mode: String,
)

/** The tab with every task: filters, search, grouped rows with quick actions. */
@Composable
fun TasksScreen(nav: NavController) {
    val store = rememberStore { TasksListStore(it) }
    val state = store.collect()
    val snackbar = remember { SnackbarHostState() }
    var filtersOpen by remember { mutableStateOf(false) }
    var action by remember { mutableStateOf<OpenAction?>(null) }
    val error = state.error

    NoticeEffect(state.notice, snackbar, onUndo = store::undo, onConsumed = store::consumeNotice)
    LaunchedEffect(state.actionError) {
        state.actionError?.let {
            snackbar.showSnackbar(it.message)
            store.dismissActionError()
        }
    }

    AppScaffold(
        title = tr("nav_tasks"),
        snackbarHostState = snackbar,
        actions = {
            IconButton(onClick = { filtersOpen = !filtersOpen }) {
                Icon(Icons.Outlined.FilterList, contentDescription = tr("tasks_filters"))
            }
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { nav.navigate(Routes.taskNew()) }) {
                Icon(Icons.Outlined.Add, contentDescription = tr("task_new"))
            }
        },
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.total == 0 -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn(contentPadding = PaddingValues(bottom = 88.dp)) {
                        item {
                            Column(
                                Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                TextField(
                                    label = tr("tasks_search_label"),
                                    value = state.query,
                                    onChange = store::search,
                                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                                )
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    FilterChip(
                                        selected = !state.mine,
                                        onClick = { store.setMine(false) },
                                        label = { Text(tr("tasks_assignee_all"), maxLines = 1) },
                                    )
                                    FilterChip(
                                        selected = state.mine,
                                        onClick = { store.setMine(true) },
                                        label = { Text(tr("tasks_assignee_me"), maxLines = 1) },
                                    )
                                    if (state.filterCount > 0 || state.query.isNotBlank()) {
                                        TextButton(onClick = store::resetFilters) { Text(tr("tasks_filter_reset"), maxLines = 1) }
                                    }
                                }
                                if (filtersOpen) {
                                    SectionCard(title = tr("tasks_filters")) {
                                        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                            ChoiceField(
                                                tr("tasks_filter_status"),
                                                state.status,
                                                taskStatusOptions().map { it.value to it.label },
                                                store::setStatus,
                                            )
                                            ChoiceField(
                                                tr("tasks_filter_category"),
                                                state.category,
                                                taskCategoryFilterOptions().map { it.value to it.label },
                                                store::setCategory,
                                            )
                                            ChoiceField(
                                                tr("tasks_filter_room"),
                                                state.roomId,
                                                state.rooms.map { it.value to it.label },
                                                store::setRoom,
                                            )
                                            ChoiceField(
                                                tr("tasks_filter_asset"),
                                                state.assetId,
                                                state.assets.map { it.value to it.label },
                                                store::setAsset,
                                            )
                                            ChoiceField(
                                                tr("tasks_view_label"),
                                                state.view,
                                                taskViewOptions().map { it.value to it.label },
                                                store::setView,
                                            )
                                            SwitchField(tr("tasks_filter_archived"), state.archived, store::setArchived)
                                        }
                                    }
                                }
                                if (state.shown > 0 || state.filtered) {
                                    Text(
                                        tr("tasks_count", "count" to state.shown),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                        if (state.shown == 0) {
                            item {
                                if (state.filtered) {
                                    EmptyState(
                                        tr("tasks_empty_filtered_title"),
                                        tr("tasks_empty_filtered_body"),
                                        icon = Icons.Outlined.Search,
                                    )
                                } else {
                                    EmptyState(tr("tasks_empty_title"), tr("tasks_empty_body"), icon = Icons.AutoMirrored.Outlined.ListAlt)
                                }
                            }
                        }
                        state.groups.forEach { group ->
                            if (group.title.isNotEmpty()) {
                                item(key = "group-${group.key}") {
                                    Row(Modifier.fillMaxWidth().padding(horizontal = ScreenPadding, vertical = 8.dp)) {
                                        Text(
                                            group.title + " (" + group.rows.size + ")",
                                            style = MaterialTheme.typography.titleSmall,
                                            color =
                                                if (group.tone ==
                                                    TONE_MUTED
                                                ) {
                                                    MaterialTheme.colorScheme.onSurfaceVariant
                                                } else {
                                                    MaterialTheme.colorScheme.onSurface
                                                },
                                        )
                                    }
                                }
                            }
                            items(group.rows, key = { "${group.key}-${it.id}" }) { row ->
                                TaskListRow(
                                    row = row,
                                    busy = state.busyId == row.id,
                                    onOpen = { nav.navigate(Routes.task(row.id)) },
                                    onComplete = {
                                        if (row.needsReading) {
                                            action =
                                                OpenAction(
                                                    row.id,
                                                    ACTION_COMPLETE,
                                                )
                                        } else {
                                            store.complete(row.id)
                                        }
                                    },
                                    onSkip = { action = OpenAction(row.id, ACTION_SKIP) },
                                    onSnooze = { action = OpenAction(row.id, ACTION_SNOOZE) },
                                    onUnsnooze = { store.unsnooze(row.id) },
                                )
                            }
                        }
                    }
                }
        }
    }

    action?.let { open ->
        TaskActionDialog(open.taskId, open.mode, onDismiss = { action = null }, onDone = store::announce)
    }
}
