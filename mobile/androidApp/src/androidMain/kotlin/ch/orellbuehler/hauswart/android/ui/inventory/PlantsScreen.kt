package ch.orellbuehler.hauswart.android.ui.inventory

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
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Park
import androidx.compose.material.icons.outlined.WaterDrop
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontStyle
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
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.inventory.PlantItem
import ch.orellbuehler.hauswart.feature.inventory.PlantsStore
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun PlantsScreen(nav: NavController) {
    val store = rememberStore { PlantsStore(it) }
    val state = store.collect()
    val error = state.error
    val snackbar = remember { SnackbarHostState() }
    NoticeEffect(state.notice, snackbar, store::dismissNotice, onUndo = store::undo)
    ErrorEffect(state.actionError, snackbar, store::dismissActionError)
    AppScaffold(
        title = tr("nav_plants"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        floatingActionButton = {
            FloatingActionButton(onClick = { nav.navigate(Routes.assetNew("plant")) }) {
                Icon(Icons.Outlined.Add, contentDescription = tr("plants_create"))
            }
        },
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.plants.isEmpty() -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            state.plants.isEmpty() ->
                EmptyState(
                    title = tr("plants_empty_title"),
                    body = tr("plants_empty_body"),
                    icon = Icons.Outlined.Park,
                    modifier = Modifier.padding(padding),
                )
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn(
                        contentPadding = PaddingValues(start = ScreenPadding, end = ScreenPadding, top = 8.dp, bottom = 88.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        items(state.plants, key = { it.id }) { plant ->
                            PlantCard(
                                plant = plant,
                                watering = state.wateringId == plant.id,
                                busy = state.wateringId != null,
                                onOpen = { nav.navigate(Routes.asset(plant.id)) },
                                onWater = { store.water(plant.id) },
                                onPlan = { nav.navigate(Routes.taskNew(plant.id)) },
                            )
                        }
                    }
                }
        }
    }
}

@Composable
private fun PlantCard(
    plant: PlantItem,
    watering: Boolean,
    busy: Boolean,
    onOpen: () -> Unit,
    onWater: () -> Unit,
    onPlan: () -> Unit,
) {
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(
                Modifier.fillMaxWidth().clickable(onClick = onOpen),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Park, contentDescription = null, tint = MaterialTheme.colorScheme.tertiary)
                Column(Modifier.weight(1f)) {
                    Text(plant.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    plant.species?.let {
                        Text(
                            it,
                            style = MaterialTheme.typography.bodyMedium,
                            fontStyle = FontStyle.Italic,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Text(
                        plant.place,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (plant.hints.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        tr("plants_hints"),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    plant.hints.forEach { hint ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(hintKindIcon(hint.kind), contentDescription = null, Modifier.padding(top = 2.dp))
                            Text(hint.title, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    plant.moreHints?.let {
                        Text(
                            it,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (plant.taskId != null) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        plant.statusLabel?.let { StatusChip(it, tone = plant.tone ?: "muted") }
                        plant.dateText?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    }
                    Button(onClick = onWater, enabled = !busy) {
                        Icon(Icons.Outlined.WaterDrop, contentDescription = tr("plants_water_aria", "name" to plant.name))
                        Text(if (watering) tr("common_loading") else tr("plants_water"), maxLines = 1)
                    }
                } else {
                    Text(tr("plants_no_plan"), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                    OutlinedButton(onClick = onPlan) { Text(tr("plants_add_plan"), maxLines = 1) }
                }
            }
        }
    }
}
