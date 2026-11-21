package ch.orellbuehler.hauswart.android.ui.appointments

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Replay
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.LabeledValue
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PrimaryButton
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.RowIcon
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.android.ui.sections.AttachmentsSection
import ch.orellbuehler.hauswart.android.ui.sections.CommentsSection
import ch.orellbuehler.hauswart.feature.appointments.AppointmentDetailStore
import ch.orellbuehler.hauswart.feature.appointments.ApptDetail
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun AppointmentDetailScreen(
    nav: NavController,
    id: String,
) {
    val store = rememberStore(key = id) { AppointmentDetailStore(it, id) }
    val state = store.collect()
    val detail = state.detail
    val error = state.error
    val snackbar = remember { SnackbarHostState() }
    var confirmDelete by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(state.deleted) { if (state.deleted) nav.popBackStack() }
    LaunchedEffect(state.notice) {
        if (state.notice.isNotEmpty() && !state.deleted) {
            snackbar.showSnackbar(state.notice)
            store.dismissNotice()
        }
    }
    LaunchedEffect(state.actionError) {
        state.actionError?.let {
            snackbar.showSnackbar(it.message)
            store.dismissActionError()
        }
    }

    AppScaffold(
        title = detail?.title ?: tr("nav_appointments"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            if (detail != null) {
                IconButton(
                    onClick = { nav.navigate(Routes.appointmentEdit(id)) },
                ) { Icon(Icons.Outlined.Edit, contentDescription = tr("common_edit")) }
                IconButton(onClick = { confirmDelete = true }, enabled = !state.deleting) {
                    Icon(Icons.Outlined.Delete, contentDescription = tr("common_delete"))
                }
            }
        },
    ) { padding ->
        when {
            detail != null ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    Column(
                        Modifier.verticalScroll(rememberScrollState()).padding(ScreenPadding),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Header(detail)
                        Actions(detail, state.busy, store)
                        state.completion?.let { completion ->
                            SectionCard(title = completion.title) {
                                Text(completion.hint, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodyMedium)
                                TextButton(
                                    onClick = { nav.navigate(Routes.task(completion.taskId)) },
                                    modifier = Modifier.padding(horizontal = 8.dp),
                                ) { Text(tr("appointment_result_open_task")) }
                            }
                        }
                        SectionCard(title = tr("appointment_details")) {
                            LabeledValue(tr("appointment_location_label"), detail.location)
                            LabeledValue(tr("appointment_notes_label"), detail.notes)
                        }
                        SectionCard(title = tr("appointment_links")) {
                            if (detail.links.isEmpty()) {
                                Text(
                                    tr("appointment_links_none"),
                                    Modifier.padding(horizontal = 16.dp),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            detail.links.forEach { link ->
                                ListRow(
                                    title = link.name,
                                    subtitle = link.caption,
                                    leading = {
                                        RowIcon(
                                            when (link.kind) {
                                                "task" -> Icons.Outlined.TaskAlt
                                                "asset" -> Icons.Outlined.Inventory2
                                                else -> Icons.Outlined.Person
                                            },
                                        )
                                    },
                                    onClick = {
                                        nav.navigate(
                                            when (link.kind) {
                                                "task" -> Routes.task(link.id)
                                                "asset" -> Routes.asset(link.id)
                                                else -> Routes.contact(link.id)
                                            },
                                        )
                                    },
                                )
                            }
                            Text(
                                listOf(detail.createdText, detail.updatedText).filter { it.isNotEmpty() }.joinToString("\n"),
                                Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        AttachmentsSection(ownerType = "appointment", ownerId = id)
                        CommentsSection(ownerType = "appointment", ownerId = id)
                    }
                }
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }

    if (confirmDelete && detail != null) {
        ConfirmDialog(
            title = tr("appointment_delete_title"),
            text = tr("appointment_delete_description", "title" to detail.title),
            confirmLabel = tr("common_delete"),
            destructive = true,
            onConfirm = {
                confirmDelete = false
                store.delete()
            },
            onDismiss = { confirmDelete = false },
        )
    }
}

@Composable
private fun Header(detail: ApptDetail) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(tr("appointment_kind"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            StatusChip(detail.statusLabel, tone = detail.statusTone)
        }
        Text(detail.title, style = MaterialTheme.typography.headlineSmall)
        Text("${detail.whenText} · ${detail.relativeText}", style = MaterialTheme.typography.bodyLarge)
        if (detail.location.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(Icons.Outlined.Place, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(detail.location, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun Actions(
    detail: ApptDetail,
    busy: String,
    store: AppointmentDetailStore,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (detail.planned) {
            PrimaryButton(
                text = tr("appointment_complete"),
                onClick = store::complete,
                pending = busy == "complete",
                enabled = busy.isEmpty(),
            )
            if (detail.completeHint.isNotEmpty()) {
                Text(detail.completeHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            OutlinedButton(onClick = store::cancel, enabled = busy.isEmpty(), modifier = Modifier.fillMaxWidth()) {
                Text(tr("appointment_cancel"), maxLines = 1)
            }
        } else {
            OutlinedButton(onClick = store::reopen, enabled = busy.isEmpty(), modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Outlined.Replay, contentDescription = null)
                Text(tr("appointment_reopen"), Modifier.padding(start = 8.dp), maxLines = 1)
            }
        }
    }
}
