package ch.orellbuehler.hauswart.android.ui.defects

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
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
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.android.ui.sections.viewFile
import ch.orellbuehler.hauswart.feature.defects.DEFECT_STATUSES
import ch.orellbuehler.hauswart.feature.defects.DefectsListStore
import ch.orellbuehler.hauswart.feature.defects.defectSeverityFilterChoices
import ch.orellbuehler.hauswart.feature.defects.defectSortChoices
import ch.orellbuehler.hauswart.feature.defects.defectStatusLabel
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun DefectsScreen(nav: NavController) {
    val store = rememberStore { DefectsListStore(it) }
    val state = store.collect()
    val error = state.error
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current
    var filtersOpen by rememberSaveable { mutableStateOf(false) }
    val cannotOpen = tr("m_cannot_open")

    LaunchedEffect(state.exported) {
        val export = state.exported ?: return@LaunchedEffect
        store.consumeExport()
        if (!context.viewFile(export.file)) snackbar.showSnackbar(cannotOpen)
    }
    LaunchedEffect(state.actionError) {
        state.actionError?.let {
            snackbar.showSnackbar(it.message)
            store.dismissActionError()
        }
    }

    AppScaffold(
        title = tr("nav_defects"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            if (state.exporting) {
                CircularProgressIndicator(Modifier.padding(12.dp), strokeWidth = 2.dp)
            } else {
                IconButton(onClick = store::exportPdf, enabled = !state.loading) {
                    Icon(Icons.Outlined.PictureAsPdf, contentDescription = tr("defects_pdf"))
                }
            }
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { nav.navigate(Routes.defectNew()) }) {
                Icon(Icons.Outlined.Add, contentDescription = tr("defect_new"))
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
                                    label = tr("defects_search_label"),
                                    value = state.query,
                                    onChange = store::search,
                                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                                )
                                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    DEFECT_STATUSES.forEach { status ->
                                        FilterChip(
                                            selected = status in state.statuses,
                                            onClick = { store.toggleStatus(status) },
                                            label = { Text(defectStatusLabel(status), maxLines = 1) },
                                        )
                                    }
                                }
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    TextButton(onClick = { filtersOpen = !filtersOpen }) {
                                        Icon(Icons.Outlined.FilterList, contentDescription = null)
                                        val count = if (state.filterCount > 0) " (${state.filterCount})" else ""
                                        Text(tr("tasks_filters") + count, maxLines = 1)
                                    }
                                    if (!state.isDefault) {
                                        TextButton(onClick = store::reset) { Text(tr("tasks_filter_reset"), maxLines = 1) }
                                    }
                                }
                                if (filtersOpen) {
                                    ChoiceField(
                                        label = tr("defects_filter_severity"),
                                        value = state.severity,
                                        options = defectSeverityFilterChoices().pairs(),
                                        onChange = store::setSeverity,
                                    )
                                    ChoiceField(
                                        label = tr("defects_filter_room"),
                                        value = state.roomId,
                                        options = state.roomChoices.pairs(),
                                        onChange = store::setRoom,
                                    )
                                    ChoiceField(
                                        label = tr("defects_filter_asset"),
                                        value = state.assetId,
                                        options = state.assetChoices.pairs(),
                                        onChange = store::setAsset,
                                    )
                                    ChoiceField(
                                        label = tr("defects_filter_sort"),
                                        value = state.sort,
                                        options = defectSortChoices().pairs(),
                                        onChange = store::setSort,
                                    )
                                }
                                Text(
                                    state.countText + " · " + tr("defects_pdf_scope", "filter" to state.pdfScope),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        when (state.emptyReason) {
                            "empty" ->
                                item {
                                    EmptyState(tr("defects_empty_title"), tr("defects_empty_body"), icon = Icons.Outlined.Build)
                                }
                            "none_active" ->
                                item {
                                    EmptyState(
                                        tr("defects_none_active_title"),
                                        tr("defects_none_active_body"),
                                        icon = Icons.Outlined.Build,
                                        action = { TextButton(onClick = store::showAllStatuses) { Text(tr("defects_show_all")) } },
                                    )
                                }
                            "filtered" ->
                                item {
                                    EmptyState(
                                        tr("defects_empty_filtered_title"),
                                        tr("defects_empty_filtered_body"),
                                        icon = Icons.Outlined.Search,
                                        action = { TextButton(onClick = store::reset) { Text(tr("tasks_filter_reset")) } },
                                    )
                                }
                        }
                        items(state.rows, key = { it.id }) { row ->
                            DefectListRow(row) { nav.navigate(Routes.defect(row.id)) }
                        }
                    }
                }
        }
    }
}
