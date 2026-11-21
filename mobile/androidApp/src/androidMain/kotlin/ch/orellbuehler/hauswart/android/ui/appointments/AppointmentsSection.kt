package ch.orellbuehler.hauswart.android.ui.appointments

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.RowIcon
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.appointments.AppointmentsSectionStore
import ch.orellbuehler.hauswart.i18n.tr

/**
 * The planned appointments of a task, a device or a contact as a card, with a button that opens the
 * form to schedule one for the owner.
 *
 * Usage: on a task screen `AppointmentsSection(nav, taskId = task.id)`, on a device screen
 * `AppointmentsSection(nav, assetId = asset.id)`, on a contact screen `AppointmentsSection(nav,
 * contactId = contact.id)`; give exactly one of the three. It loads and refreshes itself and
 * reports nothing else: the owner's own data changes through `appointments` and `tasks` topics.
 */
@Composable
fun AppointmentsSection(
    nav: NavController,
    taskId: String = "",
    assetId: String = "",
    contactId: String = "",
    modifier: Modifier = Modifier,
) {
    val store = rememberStore(key = "appts-$taskId-$assetId-$contactId") { AppointmentsSectionStore(it, taskId, assetId, contactId) }
    val state = store.collect()
    SectionCard(modifier = modifier, title = tr("appointments_card_title")) {
        val error = state.error
        when {
            state.loading -> CircularProgressIndicator(Modifier.padding(16.dp).align(Alignment.CenterHorizontally))
            error != null && state.rows.isEmpty() ->
                Column(Modifier.padding(horizontal = 16.dp)) {
                    InlineError(error.message)
                    TextButton(onClick = store::refresh) { Text(tr("common_retry")) }
                }
            state.rows.isEmpty() ->
                Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(tr("appointments_card_empty_title"), style = MaterialTheme.typography.titleSmall)
                    Text(state.emptyBody, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            else ->
                state.rows.forEach { row ->
                    ListRow(
                        title = row.title,
                        subtitle = listOf(row.whenText, row.location).filter { it.isNotBlank() }.joinToString("\n"),
                        subtitleLines = 2,
                        leading = { RowIcon(Icons.Outlined.CalendarMonth) },
                        onClick = { nav.navigate(Routes.appointment(row.id)) },
                    )
                }
        }
        FilledTonalButton(
            onClick = { nav.navigate(Routes.appointmentNew(taskId = taskId, assetId = assetId, contactId = contactId)) },
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            Icon(Icons.Outlined.Add, contentDescription = null)
            Text(tr("appointment_new"), Modifier.padding(start = 8.dp), maxLines = 1)
        }
    }
}
