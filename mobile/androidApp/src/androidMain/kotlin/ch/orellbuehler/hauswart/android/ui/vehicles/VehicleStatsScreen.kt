package ch.orellbuehler.hauswart.android.ui.vehicles

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Insights
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LabeledValue
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.vehicles.VehicleStatsStore
import ch.orellbuehler.hauswart.i18n.tr

/** A horizontal bar: [fraction] of the width. */
@Composable
private fun Bar(fraction: Double) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(8.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHighest),
    ) {
        Box(
            Modifier
                .fillMaxWidth(fraction.coerceIn(0.0, 1.0).toFloat())
                .height(8.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(MaterialTheme.colorScheme.primary),
        )
    }
}

@Composable
fun VehicleStatsScreen(
    nav: NavController,
    assetId: String,
) {
    val store = rememberStore(key = assetId) { VehicleStatsStore(it, assetId) }
    val state = store.collect()
    AppScaffold(title = tr("m_vehicle_stats_title"), onBack = { nav.popBackStack() }) { padding ->
        val error = state.error
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    Column(
                        Modifier.verticalScroll(rememberScrollState()).padding(ScreenPadding),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        ChoiceField(
                            label = tr("vehicle_costs_year"),
                            value = state.year.toString(),
                            options = state.years.pairs(),
                            onChange = { it.toIntOrNull()?.let(store::selectYear) },
                        )
                        state.yearError?.let {
                            InlineError(it.message)
                            TextButton(onClick = store::refresh) { Text(tr("common_retry")) }
                        }
                        if (state.yearLoading) {
                            CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))
                        } else if (state.empty) {
                            EmptyState(
                                state.emptyTitle,
                                tr("vehicle_costs_empty_body"),
                                icon = Icons.Outlined.Insights,
                            )
                        } else {
                            SectionCard(title = tr("vehicle_costs_title")) {
                                Column(
                                    Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp),
                                    verticalArrangement = Arrangement.spacedBy(2.dp),
                                ) {
                                    Text(tr("vehicle_costs_total"), style = MaterialTheme.typography.bodySmall)
                                    Text(state.totalText, style = MaterialTheme.typography.headlineMedium)
                                    Text(state.countText, style = MaterialTheme.typography.bodySmall)
                                }
                                LabeledValue(tr("vehicle_costs_distance"), state.distanceText)
                                LabeledValue(state.perDistanceLabel, state.perDistanceText)
                                state.categories.forEach { row ->
                                    Column(
                                        Modifier.padding(horizontal = ScreenPadding, vertical = 6.dp),
                                        verticalArrangement = Arrangement.spacedBy(4.dp),
                                    ) {
                                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                            Text(row.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                                            Text(
                                                "${row.amountText} · ${row.percentText}",
                                                style = MaterialTheme.typography.bodyMedium,
                                                maxLines = 1,
                                            )
                                        }
                                        Bar(row.share)
                                    }
                                }
                                state.otherCurrencyText?.let {
                                    Text(
                                        it,
                                        Modifier.padding(horizontal = ScreenPadding, vertical = 4.dp),
                                        style = MaterialTheme.typography.bodySmall,
                                    )
                                }
                            }
                            if (state.months.isNotEmpty()) {
                                SectionCard(title = tr("m_vehicle_distance_by_month")) {
                                    state.months.forEach { bar ->
                                        Column(
                                            Modifier.padding(horizontal = ScreenPadding, vertical = 4.dp),
                                            verticalArrangement = Arrangement.spacedBy(2.dp),
                                        ) {
                                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                                Text(bar.label, style = MaterialTheme.typography.bodySmall)
                                                Text(bar.valueText, style = MaterialTheme.typography.bodySmall)
                                            }
                                            Bar(bar.fraction)
                                        }
                                    }
                                }
                            }
                        }
                        state.mountedTire?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                        SectionCard(title = tr("m_vehicle_next_tasks")) {
                            if (state.tasks.isEmpty()) {
                                Text(
                                    tr("m_vehicle_next_tasks_none"),
                                    Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp),
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                            }
                            state.tasks.forEach { task ->
                                ListRow(title = task.title, subtitle = task.dateText, onClick = { nav.navigate(Routes.task(task.id)) })
                            }
                        }
                    }
                }
        }
    }
}
