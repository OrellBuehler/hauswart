package ch.orellbuehler.hauswart.android.ui.docs

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.RowIcon
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionTitle
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.docs.DOC_SECTIONS
import ch.orellbuehler.hauswart.feature.docs.DocsListStore
import ch.orellbuehler.hauswart.feature.docs.docSectionLabel
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun DocsScreen(nav: NavController) {
    val store = rememberStore { DocsListStore(it) }
    val state = store.collect()
    val error = state.error
    AppScaffold(
        title = tr("nav_docs"),
        onBack = { nav.popBackStack() },
        floatingActionButton = {
            FloatingActionButton(onClick = { nav.openDocNew(state.section) }) {
                Icon(Icons.Outlined.Add, contentDescription = tr("docs_new"))
            }
        },
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && !state.loaded -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn(contentPadding = PaddingValues(bottom = 88.dp)) {
                        item {
                            Row(Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp)) {
                                TextField(
                                    label = tr("docs_search"),
                                    value = state.query,
                                    onChange = store::search,
                                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                                )
                            }
                        }
                        item {
                            Row(
                                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = ScreenPadding),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                FilterChip(
                                    selected = state.section.isEmpty(),
                                    onClick = { store.setSection("") },
                                    label = { Text(tr("docs_filter_all_sections"), maxLines = 1) },
                                )
                                DOC_SECTIONS.forEach { section ->
                                    FilterChip(
                                        selected = state.section == section,
                                        onClick = { store.setSection(section) },
                                        label = { Text(docSectionLabel(section), maxLines = 1) },
                                    )
                                }
                            }
                        }
                        item {
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = ScreenPadding),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Switch(checked = state.archived, onCheckedChange = store::setArchived)
                                Text(
                                    tr("docs_show_archived"),
                                    Modifier.weight(1f),
                                    style = MaterialTheme.typography.bodyMedium,
                                    maxLines = 1,
                                )
                                if (state.filtered) {
                                    TextButton(onClick = store::resetFilters) { Text(tr("docs_filter_reset"), maxLines = 1) }
                                }
                            }
                        }
                        item {
                            Text(
                                tr("docs_count", "count" to state.shown),
                                Modifier.padding(horizontal = ScreenPadding, vertical = 4.dp),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        error?.let {
                            item { Text(it.message, Modifier.padding(ScreenPadding), color = MaterialTheme.colorScheme.error) }
                        }
                        if (state.groups.isEmpty()) {
                            item {
                                if (state.filtered || state.archived) {
                                    EmptyState(
                                        title = tr("docs_no_results_title"),
                                        body = tr("docs_no_results_body"),
                                        icon = Icons.Outlined.Search,
                                    )
                                } else {
                                    EmptyState(
                                        title = tr("docs_empty_title"),
                                        body = tr("docs_empty_body"),
                                        icon = Icons.Outlined.Description,
                                    )
                                }
                            }
                        }
                        state.groups.forEach { group ->
                            item(key = "group-${group.key}") {
                                SectionTitle(
                                    group.title,
                                    Modifier.padding(horizontal = ScreenPadding),
                                    trailing = group.rows.size.toString(),
                                )
                            }
                            items(group.rows, key = { "${group.key}-${it.slug}" }) { row ->
                                ListRow(
                                    title = row.title,
                                    subtitle =
                                        listOf(row.excerpt, listOf(row.places, row.updated).filter { it.isNotEmpty() }.joinToString(" · "))
                                            .filter { it.isNotEmpty() }
                                            .joinToString("\n"),
                                    subtitleLines = 3,
                                    leading = { RowIcon(if (row.pinned) Icons.Outlined.PushPin else Icons.Outlined.Description) },
                                    trailing =
                                        if (row.archived) {
                                            { StatusChip(tr("docs_archived")) }
                                        } else {
                                            null
                                        },
                                    onClick = { nav.navigate(Routes.doc(row.slug)) },
                                )
                            }
                        }
                    }
                }
        }
    }
}
