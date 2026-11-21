package ch.orellbuehler.hauswart.android.ui.costs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.toneColor
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.costs.CostsReportStore
import ch.orellbuehler.hauswart.feature.costs.ReportCard
import ch.orellbuehler.hauswart.feature.costs.ReportRow
import ch.orellbuehler.hauswart.i18n.tr

/** The year's costs of a book by month, category, device and tax class. [bookArg] is a book id or `all`; [year] 0 for this year. */
@Composable
fun CostsReportScreen(
    nav: NavController,
    bookArg: String?,
    year: Int,
) {
    val store = rememberStore(key = (bookArg ?: "") + year) { CostsReportStore(it, bookArg, year) }
    val state = store.collect()
    val error = state.error
    AppScaffold(
        title = tr("costs_tab_report"),
        onBack = { nav.popBackStack() },
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.cards.isEmpty() && !state.empty -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
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
                                IconButton(onClick = store::previousYear) {
                                    Icon(Icons.Outlined.ChevronLeft, contentDescription = tr("costs_year_prev"))
                                }
                                Text(state.yearLabel + " · " + state.title, style = MaterialTheme.typography.titleMedium, maxLines = 1)
                                IconButton(onClick = store::nextYear) {
                                    Icon(Icons.Outlined.ChevronRight, contentDescription = tr("costs_year_next"))
                                }
                            }
                        }
                        if (state.empty) {
                            item(key = "empty") { EmptyState(title = state.emptyText, body = "", icon = Icons.Outlined.BarChart) }
                        }
                        items(state.cards, key = { it.id }) { card -> ReportCardView(card) }
                    }
                }
        }
    }
}

@Composable
private fun ReportCardView(card: ReportCard) {
    SectionCard(Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp), title = card.title) {
        if (card.rows.isEmpty()) {
            Text(
                card.emptyText,
                Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        card.rows.forEach { row -> ReportRowView(row) }
        val label = card.footerLabel
        val value = card.footerValue
        if (label != null && value != null) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(
                    label,
                    Modifier.weight(1f),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(value, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
            }
        }
    }
}

@Composable
private fun ReportRowView(row: ReportRow) {
    Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                row.label,
                Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(row.amount, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            LinearProgressIndicator(
                progress = { row.fraction },
                modifier = Modifier.weight(1f),
                color = if (row.negative) toneColor("ok") else MaterialTheme.colorScheme.primary,
            )
            Text(
                row.percent,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
    }
}
