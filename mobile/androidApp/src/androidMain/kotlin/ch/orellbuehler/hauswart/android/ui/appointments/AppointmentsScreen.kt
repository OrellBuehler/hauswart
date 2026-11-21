package ch.orellbuehler.hauswart.android.ui.appointments

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionTitle
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.appointments.APPOINTMENT_STATUSES
import ch.orellbuehler.hauswart.feature.appointments.APPOINTMENT_VIEWS
import ch.orellbuehler.hauswart.feature.appointments.AppointmentsListStore
import ch.orellbuehler.hauswart.feature.appointments.ApptItem
import ch.orellbuehler.hauswart.feature.appointments.appointmentStatusLabel
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun AppointmentsScreen(nav: NavController) {
    val store = rememberStore { AppointmentsListStore(it) }
    val state = store.collect()
    val error = state.error
    AppScaffold(
        title = tr("appointments_title"),
        onBack = { nav.popBackStack() },
        floatingActionButton = {
            FloatingActionButton(onClick = { nav.navigate(Routes.appointmentNew()) }) {
                Icon(Icons.Outlined.Add, contentDescription = tr("appointment_new"))
            }
        },
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.total == 0 -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn(contentPadding = PaddingValues(bottom = 88.dp)) {
                        item(key = "filters") {
                            Column(
                                Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                                ) {
                                    APPOINTMENT_VIEWS.forEach { view ->
                                        FilterChip(
                                            selected = state.view == view,
                                            onClick = { store.setView(view) },
                                            label = { Text(tr("appointments_view_$view"), maxLines = 1) },
                                        )
                                    }
                                }
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                                ) {
                                    APPOINTMENT_STATUSES.forEach { status ->
                                        FilterChip(
                                            selected = status in state.statuses,
                                            onClick = { store.toggleStatus(status) },
                                            label = { Text(appointmentStatusLabel(status), maxLines = 1) },
                                        )
                                    }
                                }
                                Text(
                                    tr("appointments_count", "count" to state.total),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                error?.let { InlineError(it.message) }
                            }
                        }
                        if (state.total == 0) {
                            item(key = "empty") { EmptyList(state.filtered, state.view == "upcoming", store, nav) }
                        }
                        if (state.open.isNotEmpty()) {
                            item(key = "open-title") {
                                Column(Modifier.padding(horizontal = ScreenPadding)) {
                                    SectionTitle(tr("appointments_open_title"), trailing = state.open.size.toString())
                                    Text(
                                        tr("appointments_open_hint"),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            items(
                                state.open,
                                key = { "open-${it.id}" },
                            ) { item -> AppointmentRow(item) { nav.navigate(Routes.appointment(item.id)) } }
                        }
                        state.days.forEach { group ->
                            item(key = "day-${group.date}") {
                                SectionTitle(group.heading, Modifier.padding(horizontal = ScreenPadding))
                            }
                            items(group.items, key = { "${group.date}-${it.id}" }) { item ->
                                AppointmentRow(item) { nav.navigate(Routes.appointment(item.id)) }
                            }
                        }
                        if (state.view == "past") {
                            item(key = "older") {
                                Column(Modifier.fillMaxWidth().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                    when {
                                        state.loadingOlder -> CircularProgressIndicator()
                                        state.olderNone -> Text(tr("appointments_older_none"), style = MaterialTheme.typography.bodyMedium)
                                        !state.olderLoaded ->
                                            OutlinedButton(
                                                onClick = store::loadOlder,
                                            ) { Text(tr("appointments_load_older")) }
                                    }
                                    state.olderError?.let { InlineError(it.message) }
                                }
                            }
                        }
                    }
                }
        }
    }
}

@Composable
private fun EmptyList(
    filtered: Boolean,
    upcoming: Boolean,
    store: AppointmentsListStore,
    nav: NavController,
) {
    when {
        filtered ->
            EmptyState(
                title = tr("appointments_empty_filtered_title"),
                body = tr("appointments_empty_filtered_body"),
                icon = Icons.Outlined.SearchOff,
                action = { OutlinedButton(onClick = store::resetFilters) { Text(tr("appointments_filter_reset")) } },
            )
        upcoming ->
            EmptyState(
                title = tr("appointments_empty_upcoming_title"),
                body = tr("appointments_empty_upcoming_body"),
                icon = Icons.Outlined.CalendarMonth,
                action = {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { nav.navigate(Routes.appointmentNew()) }) { Text(tr("appointment_new")) }
                        OutlinedButton(onClick = { store.setView("past") }) { Text(tr("appointments_show_past")) }
                    }
                },
            )
        else ->
            EmptyState(
                title = tr("appointments_empty_past_title"),
                body = tr("appointments_empty_past_body"),
                icon = Icons.Outlined.History,
            )
    }
}

/** One appointment as a row: time on the left, title and where below it, the status on the right when it is not simply planned. */
@Composable
internal fun AppointmentRow(
    item: ApptItem,
    onClick: () -> Unit,
) {
    ListRow(
        title = item.title,
        subtitle = listOf(item.location, item.taskTitle, item.assetName, item.contactName).filter { it.isNotBlank() }.joinToString(" · "),
        leading = {
            Column(Modifier.width(64.dp)) {
                Text(item.timePrimary, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium, maxLines = 1)
                if (item.timeSecondary.isNotEmpty()) {
                    Text(
                        item.timeSecondary,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }
            }
        },
        trailing =
            when {
                item.needsClosing -> ({ StatusChip(tr("appointment_open_badge"), tone = "due") })
                item.status != "planned" -> ({ StatusChip(item.statusLabel, tone = if (item.status == "done") "ok" else "muted") })
                else -> null
            },
        onClick = onClick,
    )
}
