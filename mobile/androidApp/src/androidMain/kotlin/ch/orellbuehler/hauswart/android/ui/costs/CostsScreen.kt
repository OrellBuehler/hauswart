package ch.orellbuehler.hauswart.android.ui.costs

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
import androidx.compose.material.icons.outlined.AccountBalance
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
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
import ch.orellbuehler.hauswart.android.ui.components.SectionTitle
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.components.toneColor
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.costs.CostBalanceView
import ch.orellbuehler.hauswart.feature.costs.CostSummaryView
import ch.orellbuehler.hauswart.feature.costs.CostsListState
import ch.orellbuehler.hauswart.feature.costs.CostsListStore
import ch.orellbuehler.hauswart.feature.costs.bookArgOf
import ch.orellbuehler.hauswart.i18n.tr

/** The costs tab: the entries of the book on screen, the year's totals and where the person stands. */
@Composable
fun CostsScreen(nav: NavController) {
    val store = rememberStore { CostsListStore(it) }
    val state = store.collect()
    val error = state.error
    val bookArg = bookArgOf(state.bookId)
    AppScaffold(
        title = tr("nav_costs"),
        onBack = null,
        actions = {
            IconButton(onClick = { nav.navigate(Routes.costsBalances(bookArg)) }) {
                Icon(Icons.Outlined.AccountBalance, contentDescription = tr("balances_open"))
            }
            IconButton(onClick = { nav.navigate(Routes.costNew(bookArg)) }) {
                Icon(Icons.Outlined.Add, contentDescription = tr("cost_new"))
            }
            CostsMoreMenu(nav)
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { nav.navigate(Routes.costsQuick(bookArg)) }) {
                Icon(Icons.Outlined.Bolt, contentDescription = tr("quick_fab"))
            }
        },
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.summary == null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    CostsList(nav, state, store, bookArg)
                }
        }
    }
}

@Composable
private fun CostsList(
    nav: NavController,
    state: CostsListState,
    store: CostsListStore,
    bookArg: String,
) {
    var filtersOpen by remember { mutableStateOf(false) }
    LazyColumn(contentPadding = PaddingValues(bottom = 96.dp)) {
        if (state.showSwitcher) {
            item(key = "books") {
                BookSwitcher(state.books, state.bookId, store::selectBook, Modifier.padding(top = 8.dp))
            }
        }
        item(key = "year") {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                IconButton(onClick = store::previousYear) { Icon(Icons.Outlined.ChevronLeft, contentDescription = tr("costs_year_prev")) }
                Text(state.yearLabel, style = MaterialTheme.typography.titleMedium)
                IconButton(onClick = store::nextYear) { Icon(Icons.Outlined.ChevronRight, contentDescription = tr("costs_year_next")) }
            }
        }
        state.summary?.let { summary ->
            item(key = "summary") {
                SummaryCard(summary, state.balance, state.balancesUnavailable) {
                    nav.navigate(Routes.costsBalances(bookArg))
                }
            }
        }
        item(key = "search") {
            Column(Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                TextField(
                    label = tr("costs_search_label"),
                    value = state.query,
                    onChange = store::search,
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (state.reviewCount > 0 || state.reviewOnly) {
                        FilterChip(
                            selected = state.reviewOnly,
                            onClick = { store.setReviewOnly(!state.reviewOnly) },
                            label = { Text(tr("costs_filter_review") + " " + state.reviewCount, maxLines = 1) },
                            leadingIcon = { Icon(Icons.Outlined.Visibility, contentDescription = null) },
                        )
                    }
                    FilterChip(
                        selected = filtersOpen,
                        onClick = { filtersOpen = !filtersOpen },
                        label = { Text(tr("tasks_filters"), maxLines = 1) },
                        leadingIcon = { Icon(Icons.Outlined.FilterList, contentDescription = null) },
                    )
                    if (state.filtered) {
                        TextButton(onClick = store::resetFilters) { Text(tr("tasks_filter_reset"), maxLines = 1) }
                    }
                }
                if (filtersOpen) {
                    ChoiceField(
                        label = tr("costs_filter_category"),
                        value = state.category,
                        options = listOf("" to tr("costs_filter_all")) + state.categories.map { it.value to it.label },
                        onChange = store::setCategory,
                    )
                    ChoiceField(
                        label = tr("costs_filter_paid_by"),
                        value = state.paidBy,
                        options = listOf("" to tr("costs_filter_all")) + state.payers.map { it.value to it.label },
                        onChange = store::setPaidBy,
                    )
                }
            }
        }
        when {
            state.total == 0 ->
                item(key = "empty") {
                    EmptyState(
                        title = tr("costs_empty_title", "year" to state.yearLabel),
                        body = tr("costs_empty_body"),
                        icon = Icons.Outlined.Bolt,
                        action = {
                            TextButton(
                                onClick = { nav.navigate(Routes.costsQuick(bookArg)) },
                            ) { Text(tr("costs_quick"), maxLines = 1) }
                        },
                    )
                }
            state.shown == 0 ->
                item(key = "none") {
                    EmptyState(
                        title = tr("costs_empty_filtered_title"),
                        body = tr("costs_empty_filtered_body"),
                        icon = Icons.Outlined.Search,
                        action = { TextButton(onClick = store::resetFilters) { Text(tr("tasks_filter_reset"), maxLines = 1) } },
                    )
                }
            else ->
                item(key = "count") {
                    Text(
                        tr("costs_count", "count" to state.shown),
                        Modifier.padding(horizontal = ScreenPadding),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
        }
        state.groups.forEach { group ->
            item(key = "month-${group.key}") {
                SectionTitle(group.title, Modifier.padding(horizontal = ScreenPadding), trailing = group.total)
            }
            items(group.rows, key = { it.id }) { row ->
                CostRowItem(row, onClick = { nav.navigate(Routes.cost(row.id)) })
            }
        }
    }
}

@Composable
private fun SummaryCard(
    summary: CostSummaryView,
    balance: CostBalanceView?,
    unavailable: Boolean,
    onBalances: () -> Unit,
) {
    SectionCard(Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp)) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(summary.title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(summary.total, style = MaterialTheme.typography.headlineMedium)
            Text(summary.count, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            summary.equity?.let { Text(tr("costs_equity_label") + ": " + it, style = MaterialTheme.typography.bodySmall) }
            summary.otherCurrency?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Column(
                Modifier.fillMaxWidth().clickable(onClick = onBalances).padding(vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    tr("balances_teaser_title"),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                when {
                    unavailable -> Text(tr("balances_unavailable"), style = MaterialTheme.typography.bodyMedium)
                    balance != null -> {
                        balance.you?.let { Text(it.text, style = MaterialTheme.typography.titleMedium, color = toneColor(it.tone)) }
                        balance.payments.forEach {
                            Text(
                                it,
                                style = MaterialTheme.typography.bodyMedium,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        if (balance.status.isNotEmpty()) {
                            Text(
                                balance.status,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                Text(tr("balances_open"), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            }
        }
    }
}
