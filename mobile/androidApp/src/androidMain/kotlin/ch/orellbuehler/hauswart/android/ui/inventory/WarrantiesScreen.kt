package ch.orellbuehler.hauswart.android.ui.inventory

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
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.inventory.WarrantiesStore
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun WarrantiesScreen(nav: NavController) {
    val store = rememberStore { WarrantiesStore(it) }
    val state = store.collect()
    val error = state.error
    AppScaffold(title = tr("warranties_title"), onBack = { nav.popBackStack() }) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.total == 0 -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            state.total == 0 ->
                EmptyState(
                    title = tr("warranties_empty_title"),
                    body = tr("warranties_empty_body"),
                    icon = Icons.Outlined.Shield,
                    modifier = Modifier.padding(padding),
                    action = null,
                )
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn {
                        item {
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(
                                        rememberScrollState(),
                                    ).padding(horizontal = ScreenPadding, vertical = 8.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                state.chips.forEach { chip ->
                                    FilterChip(
                                        selected = state.status == chip.value,
                                        onClick = { store.select(chip.value) },
                                        label = { Text("${chip.label} ${chip.count}", maxLines = 1) },
                                    )
                                }
                            }
                        }
                        if (state.rows.isEmpty()) {
                            item {
                                EmptyState(
                                    title = tr("warranties_filter_empty_title"),
                                    body = tr("warranties_filter_empty_body"),
                                    icon = Icons.Outlined.Shield,
                                )
                            }
                        }
                        items(state.rows, key = { it.assetId }) { row ->
                            Column(Modifier.fillMaxWidth()) {
                                ListRow(
                                    title = row.name,
                                    subtitle =
                                        listOfNotNull(
                                            row.subtitle.ifEmpty { null },
                                            row.info.daysText,
                                            row.extendedText,
                                        ).joinToString("\n"),
                                    subtitleLines = 3,
                                    leading = { RowIcon(Icons.Outlined.Shield) },
                                    trailing = { StatusChip(row.info.label, tone = row.info.tone) },
                                    onClick = { nav.navigate(Routes.asset(row.assetId)) },
                                )
                            }
                        }
                    }
                }
        }
    }
}
