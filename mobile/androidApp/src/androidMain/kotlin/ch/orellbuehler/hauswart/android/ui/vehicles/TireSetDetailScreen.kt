package ch.orellbuehler.hauswart.android.ui.vehicles

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.android.ui.sections.AttachmentsSection
import ch.orellbuehler.hauswart.feature.vehicles.TireSetDetailStore
import ch.orellbuehler.hauswart.i18n.tr

/** One tire set with its history and its photos. */
@Composable
fun TireSetDetailScreen(
    nav: NavController,
    id: String,
) {
    val store = rememberStore(key = id) { TireSetDetailStore(it, id) }
    val state = store.collect()
    val row = state.row
    val error = state.error
    AppScaffold(title = row?.title ?: tr("m_vehicle_tire_detail_title"), onBack = { nav.popBackStack() }) { padding ->
        when {
            row != null ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    Column(
                        Modifier.verticalScroll(rememberScrollState()).padding(ScreenPadding),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        SectionCard {
                            ListRow(
                                title = row.title,
                                subtitle = row.make.ifEmpty { null },
                                trailing = { row.badge?.let { StatusChip(it) } },
                            )
                            FactRows(row.facts)
                            row.warnings.forEach {
                                Text(
                                    it,
                                    Modifier.padding(horizontal = ScreenPadding, vertical = 4.dp),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                            row.notes?.let {
                                Text(
                                    it,
                                    Modifier.padding(horizontal = ScreenPadding, vertical = 4.dp),
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                        SectionCard(title = tr("vehicle_history_title")) {
                            state.events.forEach { ListRow(title = it.title, subtitle = it.detail) }
                        }
                        AttachmentsSection(ownerType = "tire_set", ownerId = id)
                    }
                }
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }
}
