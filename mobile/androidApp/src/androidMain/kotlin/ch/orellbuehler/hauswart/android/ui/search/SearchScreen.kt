package ch.orellbuehler.hauswart.android.ui.search

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Clear
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionTitle
import ch.orellbuehler.hauswart.android.ui.nav.open
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.search.SearchStore
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun SearchScreen(nav: NavController) {
    val store = rememberStore { SearchStore(it) }
    val state = store.collect()
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (state.query.isEmpty()) focus.requestFocus() }

    AppScaffold(title = tr("search_page_title"), onBack = { nav.popBackStack() }) { padding ->
        Column(Modifier.padding(padding)) {
            OutlinedTextField(
                value = state.query,
                onValueChange = store::setQuery,
                modifier = Modifier.fillMaxWidth().padding(horizontal = ScreenPadding, vertical = 8.dp).focusRequester(focus),
                singleLine = true,
                placeholder = { Text(tr("search_placeholder"), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                trailingIcon = {
                    if (state.query.isNotEmpty()) {
                        IconButton(onClick = { store.setQuery("") }) { Icon(Icons.Outlined.Clear, contentDescription = tr("m_date_clear")) }
                    }
                },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            )
            val error = state.error
            when {
                state.idle ->
                    EmptyState(
                        title = tr("search_page_idle_title"),
                        body = tr("search_idle"),
                        icon = Icons.Outlined.Search,
                        modifier = Modifier.padding(top = 32.dp),
                    )
                error != null -> ErrorBox(error, onRetry = store::retry)
                state.loading && state.groups.isEmpty() ->
                    Column(
                        Modifier.fillMaxWidth().padding(32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) { CircularProgressIndicator() }
                state.empty ->
                    EmptyState(
                        title = tr("search_page_empty_title"),
                        body = tr("search_empty", "q" to state.query.trim()),
                        icon = Icons.Outlined.SearchOff,
                        modifier = Modifier.padding(top = 32.dp),
                    )
                else ->
                    LazyColumn {
                        if (state.filters.isNotEmpty()) {
                            item(key = "filters") {
                                Row(
                                    Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = ScreenPadding, vertical = 4.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    state.filters.forEach { filter ->
                                        FilterChip(
                                            selected = state.type == filter.type,
                                            onClick = { store.setType(filter.type) },
                                            label = { Text("${filter.title} ${filter.count}", maxLines = 1) },
                                        )
                                    }
                                }
                            }
                        }
                        item(key = "count") {
                            Text(
                                tr("search_result_count", "count" to state.shown, "q" to state.query.trim()),
                                Modifier.padding(horizontal = ScreenPadding, vertical = 4.dp),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        state.groups.forEach { group ->
                            item(key = "group-${group.type}") {
                                SectionTitle(
                                    group.title,
                                    Modifier.padding(horizontal = ScreenPadding),
                                    trailing = group.hits.size.toString(),
                                )
                            }
                            items(group.hits, key = { it.key }) { hit ->
                                ListRow(
                                    title = hit.title,
                                    subtitle = hit.snippet,
                                    subtitleLines = 2,
                                    onClick = hit.link?.let { link -> { nav.open(link) } },
                                )
                            }
                        }
                    }
            }
        }
    }
}
