package ch.orellbuehler.hauswart.android.ui.dashboard

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.toneColor
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.dashboard.CostsCard
import ch.orellbuehler.hauswart.feature.dashboard.DashboardStore
import ch.orellbuehler.hauswart.feature.dashboard.DashboardView
import ch.orellbuehler.hauswart.feature.dashboard.SECTION_LATER
import ch.orellbuehler.hauswart.feature.dashboard.TaskSection
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun HomeScreen(nav: NavController) {
    val store = rememberStore { DashboardStore(it) }
    val state = store.collect()
    val unread = state.unreadNotifications
    AppScaffold(
        title = tr("dashboard_title"),
        actions = {
            IconButton(onClick = { nav.navigate(Routes.SEARCH) }) {
                Icon(Icons.Outlined.Search, contentDescription = tr("search_open"))
            }
            IconButton(onClick = { nav.navigate(Routes.NOTIFICATIONS) }) {
                BadgedBox(
                    badge = { if (unread > 0) Badge { Text(unread.toString()) } },
                ) {
                    Icon(
                        Icons.Outlined.Notifications,
                        contentDescription =
                            if (unread > 0) tr("notifications_bell_unread", "count" to unread) else tr("notifications_bell"),
                    )
                }
            }
        },
    ) { padding ->
        val view = state.view
        val error = state.error
        when {
            view != null ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn(
                        contentPadding = PaddingValues(ScreenPadding),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        item {
                            Column {
                                Text(
                                    state.greeting,
                                    style = MaterialTheme.typography.headlineSmall,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                if (state.householdName.isNotBlank()) {
                                    Text(
                                        state.householdName,
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                        }
                        dashboardContent(nav, view, store::toggleLater)
                    }
                }
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }
}

private fun LazyListScope.dashboardContent(
    nav: NavController,
    view: DashboardView,
    onToggleLater: () -> Unit,
) {
    item {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            view.tiles.forEach { tile ->
                Card(
                    Modifier.weight(1f),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text(
                            tile.label,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            tile.value.toString(),
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = toneColor(tile.tone),
                        )
                    }
                }
            }
        }
    }
    if (view.nothingToDo) {
        item {
            EmptyState(
                title = tr("dashboard_empty_title"),
                body = tr("dashboard_empty_body"),
                icon = Icons.Outlined.CheckCircle,
            )
        }
    }
    view.sections.forEach { section ->
        item(key = "section-${section.id}") { TaskSectionCard(nav, section, onToggleLater) }
    }
    view.defects?.let { card ->
        item(key = "defects") {
            SectionCard(title = tr("dashboard_open_defects") + " (" + card.total + ")") {
                card.items.forEach { d ->
                    ListRow(
                        title = "#${d.number} ${d.title}",
                        subtitle =
                            listOf(
                                d.place,
                                d.statusLabel + " · " + d.severityLabel,
                                d.deadlineText,
                            ).filter { it.isNotBlank() }.joinToString("\n"),
                        subtitleLines = 3,
                        onClick = { nav.navigate(Routes.defect(d.id)) },
                    )
                }
                TextButton(onClick = { nav.navigate(Routes.DEFECTS) }, modifier = Modifier.padding(horizontal = 8.dp)) {
                    Text(card.moreLabel, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
    if (view.warranties.isNotEmpty()) {
        item(key = "warranties") {
            SectionCard(title = tr("dashboard_expiring_warranties") + " (" + view.warranties.size + ")") {
                view.warranties.forEach { w ->
                    ListRow(
                        title = w.title,
                        subtitle = w.date,
                        trailing = { StatusChip(w.wording, tone = w.tone) },
                        onClick = { nav.navigate(Routes.asset(w.assetId)) },
                    )
                }
                TextButton(onClick = { nav.navigate(Routes.WARRANTIES) }, modifier = Modifier.padding(horizontal = 8.dp)) {
                    Text(tr("dashboard_to_warranties"), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
    if (view.orderNow.isNotEmpty()) {
        item(key = "order") {
            SectionCard(title = tr("dashboard_order_now") + " (" + view.orderNow.size + ")") {
                view.orderNow.forEach { o ->
                    ListRow(
                        title = o.quantity + " " + o.partName,
                        subtitle = listOf(o.neededBy, o.taskTitle).joinToString("\n"),
                        subtitleLines = 2,
                        trailing = o.lateLabel?.let { label -> { StatusChip(label, tone = "overdue") } },
                        onClick = { nav.navigate(Routes.part(o.partId)) },
                    )
                }
                TextButton(onClick = { nav.navigate(Routes.PARTS) }, modifier = Modifier.padding(horizontal = 8.dp)) {
                    Text(tr("dashboard_to_parts"), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
    view.costs?.let { card -> item(key = "costs") { CostsSummary(nav, card) } }
    if (view.recent.isNotEmpty()) {
        item(key = "recent") {
            SectionCard(title = tr("dashboard_recent_title")) {
                view.recent.forEach { r ->
                    ListRow(title = r.title, subtitle = r.detail, onClick = { nav.navigate(Routes.task(r.taskId)) })
                }
            }
        }
    }
}

@Composable
private fun TaskSectionCard(
    nav: NavController,
    section: TaskSection,
    onToggleLater: () -> Unit,
) {
    SectionCard(title = section.title + " (" + section.total + ")") {
        section.items.forEach { task ->
            ListRow(
                title = task.title,
                subtitle =
                    listOf(
                        task.place,
                        listOfNotNull(
                            task.whenText.ifBlank {
                                null
                            },
                            task.assignee,
                        ).joinToString(" · "),
                    ).filter { it.isNotBlank() }.joinToString("\n"),
                subtitleLines = 2,
                trailing =
                    if (task.statusLabel.isNotBlank()) {
                        { StatusChip(task.statusLabel, tone = task.tone) }
                    } else {
                        null
                    },
                onClick = { nav.navigate(Routes.task(task.id)) },
            )
        }
        if (section.id == SECTION_LATER && section.collapsible) {
            TextButton(onClick = onToggleLater, modifier = Modifier.padding(horizontal = 8.dp)) {
                Text(
                    if (section.expanded) tr("dashboard_show_less") else tr("dashboard_show_all", "count" to section.total),
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
private fun CostsSummary(
    nav: NavController,
    card: CostsCard,
) {
    SectionCard(title = tr("costs_title")) {
        Column(
            Modifier.clickable { nav.navigate(Routes.COSTS) }.padding(horizontal = 16.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            card.youLine?.let { line ->
                Text(line, style = MaterialTheme.typography.titleLarge, color = toneColor(card.youTone))
                Text(
                    tr("dashboard_costs_balance_hint"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (card.balancesUnavailable) Text(tr("balances_unavailable"), style = MaterialTheme.typography.bodyMedium)
            card.squareText?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            card.payments.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
            card.morePayments?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            card.budgetText?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = toneColor(if (card.budgetExceeded) "overdue" else "due"))
            }
        }
        ListRow(title = card.yearLabel, trailing = { Text(card.yearTotal, style = MaterialTheme.typography.bodyMedium) })
        card.books.forEach { ListRow(title = it.name, trailing = { Text(it.total, style = MaterialTheme.typography.bodyMedium) }) }
        card.moreBooks?.let { Text(it, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall) }
    }
}
