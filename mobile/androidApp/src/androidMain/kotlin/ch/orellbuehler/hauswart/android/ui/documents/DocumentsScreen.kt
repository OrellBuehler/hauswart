package ch.orellbuehler.hauswart.android.ui.documents

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.documents.DOCUMENTS_LINKED_FILTERS
import ch.orellbuehler.hauswart.feature.documents.DocumentsListStore
import ch.orellbuehler.hauswart.feature.documents.SUGGESTION_ASSET
import ch.orellbuehler.hauswart.feature.documents.SUGGESTION_CONTACT
import ch.orellbuehler.hauswart.feature.documents.documentsLinkedLabel
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun DocumentsScreen(nav: NavController) {
    val store = rememberStore { DocumentsListStore(it) }
    val state = store.collect()
    val error = state.error
    var menu by remember { mutableStateOf(false) }
    var filtersOpen by remember { mutableStateOf(false) }
    AppScaffold(
        title = tr("nav_documents"),
        onBack = { nav.popBackStack() },
        actions = {
            if (state.connected == true) {
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = tr("docs_actions")) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text(tr("document_suggestions_asset_title")) },
                        onClick = {
                            menu = false
                            nav.openSuggestions(SUGGESTION_ASSET)
                        },
                    )
                    DropdownMenuItem(
                        text = { Text(tr("document_suggestions_contact_title")) },
                        onClick = {
                            menu = false
                            nav.openSuggestions(SUGGESTION_CONTACT)
                        },
                    )
                }
            }
        },
    ) { padding ->
        when {
            state.connected == false ->
                EmptyState(
                    title = tr("documents_not_connected_title"),
                    body = tr("documents_not_connected_body") + "\n" + tr("m_documents_connect_in_web"),
                    icon = Icons.Outlined.Description,
                    modifier = Modifier.padding(padding),
                )
            state.connected == null && state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.rows.isEmpty() && state.connected != true ->
                ErrorBox(
                    error,
                    Modifier.padding(padding),
                    onRetry = store::refresh,
                )
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn {
                        item {
                            Row(Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp)) {
                                TextField(
                                    label = tr("documents_search"),
                                    value = state.query,
                                    onChange = store::setQuery,
                                    hint = tr(if (state.query.isBlank()) "document_link_search_hint" else "document_link_search_live"),
                                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                                )
                            }
                        }
                        if (state.connectionWarning.isNotEmpty()) {
                            item { InlineError(state.connectionWarning, Modifier.padding(horizontal = ScreenPadding)) }
                        }
                        item {
                            Row(
                                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = ScreenPadding),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                DOCUMENTS_LINKED_FILTERS.forEach { filter ->
                                    FilterChip(
                                        selected = state.linked == filter,
                                        onClick = { store.setLinked(filter) },
                                        label = { Text(documentsLinkedLabel(filter), maxLines = 1) },
                                    )
                                }
                                if (state.tags.isNotEmpty() || state.correspondents.isNotEmpty()) {
                                    FilterChip(
                                        selected = filtersOpen || state.tag.isNotEmpty() || state.correspondent.isNotEmpty(),
                                        onClick = { filtersOpen = !filtersOpen },
                                        label = { Text(tr("documents_filters"), maxLines = 1) },
                                    )
                                }
                                if (state.filtered) {
                                    TextButton(onClick = store::resetFilters) { Text(tr("documents_filter_reset"), maxLines = 1) }
                                }
                            }
                        }
                        if (filtersOpen) {
                            item {
                                Column(
                                    Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    if (state.tags.isNotEmpty()) {
                                        ChoiceField(
                                            label = tr("documents_filter_tag"),
                                            value = state.tag,
                                            options =
                                                listOf(
                                                    "" to tr("documents_filter_tag_any"),
                                                ) + state.tags.map { it.value to it.label },
                                            onChange = store::setTag,
                                        )
                                    }
                                    if (state.correspondents.isNotEmpty()) {
                                        ChoiceField(
                                            label = tr("documents_filter_correspondent"),
                                            value = state.correspondent,
                                            options =
                                                listOf("" to tr("documents_filter_correspondent_any")) +
                                                    state.correspondents.map { it.value to it.label },
                                            onChange = store::setCorrespondent,
                                        )
                                    }
                                }
                            }
                        }
                        state.filterError?.let { item { InlineError(it.message, Modifier.padding(horizontal = ScreenPadding)) } }
                        if (state.loading) {
                            item { LoadingRow() }
                        } else if (error != null) {
                            item {
                                ErrorBox(error, Modifier.padding(vertical = 24.dp), onRetry = store::refresh)
                            }
                        } else if (state.rows.isEmpty()) {
                            item {
                                if (state.filtered) {
                                    EmptyState(tr("documents_no_match_title"), tr("documents_no_match_body"), icon = Icons.Outlined.Search)
                                } else {
                                    EmptyState(tr("documents_empty_title"), tr("documents_empty_body"), icon = Icons.Outlined.Description)
                                }
                            }
                        }
                        items(state.rows, key = { it.id }) { row ->
                            ListRow(
                                title = row.title,
                                subtitle =
                                    listOf(
                                        row.details,
                                        (
                                            row.tags +
                                                listOfNotNull(
                                                    row.moreTags
                                                        .takeIf {
                                                            it > 0
                                                        }?.let { "+$it" },
                                                )
                                        ).joinToString(
                                            ", ",
                                        ),
                                        row.warranty,
                                        if (row.unused) tr("documents_unused") else row.usedIn,
                                    ).filter { it.isNotEmpty() }
                                        .joinToString("\n"),
                                subtitleLines = 4,
                                leading = {
                                    DocumentThumb(state.thumbs, { store.requestThumbnail(row.id) }, { store.thumbnail(row.id) })
                                },
                                onClick = { nav.openDocument(row.id) },
                            )
                        }
                        state.moreError?.let { item { InlineError(it.message, Modifier.padding(ScreenPadding)) } }
                        if (state.hasMore) {
                            item {
                                TextButton(
                                    onClick = store::loadMore,
                                    enabled = !state.loadingMore,
                                    modifier = Modifier.padding(horizontal = ScreenPadding),
                                ) {
                                    Text(tr(if (state.loadingMore) "common_loading" else "common_load_more"), maxLines = 1)
                                }
                            }
                        }
                    }
                }
        }
    }
}

@Composable
private fun LoadingRow() {
    Text(
        tr("common_loading"),
        Modifier.padding(ScreenPadding),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
