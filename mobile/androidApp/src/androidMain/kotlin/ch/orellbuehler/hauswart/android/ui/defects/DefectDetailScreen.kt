package ch.orellbuehler.hauswart.android.ui.defects

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
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.LabeledValue
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.toneColor
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.android.ui.sections.AttachmentsSection
import ch.orellbuehler.hauswart.android.ui.sections.CommentsSection
import ch.orellbuehler.hauswart.android.ui.sections.DocumentLinksSection
import ch.orellbuehler.hauswart.feature.defects.DefectAction
import ch.orellbuehler.hauswart.feature.defects.DefectDetailStore
import ch.orellbuehler.hauswart.feature.defects.DefectEventRow
import ch.orellbuehler.hauswart.feature.defects.DefectView
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun DefectDetailScreen(
    nav: NavController,
    id: String,
) {
    val store = rememberStore(key = id) { DefectDetailStore(it, id) }
    val state = store.collect()
    val view = state.view
    val error = state.error
    val snackbar = remember { SnackbarHostState() }
    var confirmDelete by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var statusTarget by remember { mutableStateOf<String?>(null) }
    var correspondence by remember { mutableStateOf(false) }
    var nonce by remember { mutableIntStateOf(0) }

    LaunchedEffect(state.deleted) { if (state.deleted) nav.popBackStack() }
    LaunchedEffect(state.actionError) {
        state.actionError?.let {
            snackbar.showSnackbar(it.message)
            store.dismissActionError()
        }
    }

    AppScaffold(
        title = view?.numberLabel ?: tr("nav_defects"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            if (view != null) {
                IconButton(onClick = { nav.openDefectEdit(id) }) { Icon(Icons.Outlined.Edit, contentDescription = tr("common_edit")) }
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = tr("defect_more_actions")) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    view.actions.filter { !it.primary }.forEach { action ->
                        DropdownMenuItem(
                            text = { Text(action.label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            onClick = {
                                menu = false
                                nonce++
                                statusTarget = action.status
                            },
                        )
                    }
                    DropdownMenuItem(
                        text = { Text(tr("common_delete"), color = MaterialTheme.colorScheme.error) },
                        leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                        enabled = !state.deleting,
                        onClick = {
                            menu = false
                            confirmDelete = true
                        },
                    )
                }
            }
        },
    ) { padding ->
        when {
            view != null ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    Column(
                        Modifier.verticalScroll(rememberScrollState()).padding(ScreenPadding),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Header(view) { target ->
                            nonce++
                            statusTarget = target
                        }
                        SectionCard { Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) { DefectStepper(view.steps) } }
                        FactsCard(nav, view)
                        SectionCard(title = tr("defect_description")) {
                            Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                                if (view.body.isEmpty()) {
                                    Text(
                                        tr("defect_description_empty"),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                } else {
                                    LinkedText(view.body)
                                }
                            }
                        }
                        if (view.resolution.isNotEmpty()) {
                            SectionCard(title = tr("defect_resolution")) {
                                Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) { LinkedText(view.resolution) }
                            }
                        }
                        view.reminderTaskId?.let { taskId ->
                            SectionCard(title = tr("defect_reminder")) {
                                Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text(tr("defect_reminder_description"), style = MaterialTheme.typography.bodyMedium)
                                    OutlinedButton(onClick = { nav.navigate(Routes.task(taskId)) }) {
                                        Text(tr("defect_reminder_open"), maxLines = 1)
                                    }
                                }
                            }
                        }
                        SectionCard(title = tr("defect_timeline")) {
                            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                view.timeline.forEach { EventItem(it) }
                                OutlinedButton(onClick = {
                                    nonce++
                                    correspondence = true
                                }) {
                                    Icon(Icons.Outlined.Mail, contentDescription = null)
                                    Text(tr("defect_correspondence_add"), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                        CommentsSection(ownerType = "defect", ownerId = id)
                        AttachmentsSection(ownerType = "defect", ownerId = id)
                        DocumentLinksSection(ownerType = "defect", ownerId = id)
                    }
                }
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }

    statusTarget?.let { target ->
        DefectStatusDialog(id, target, nonce) { statusTarget = null }
    }
    if (correspondence) {
        DefectCorrespondenceDialog(id, nonce) { correspondence = false }
    }
    if (confirmDelete && view != null) {
        ConfirmDialog(
            title = tr("defect_delete_title"),
            text = view.deleteText,
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
private fun Header(
    view: DefectView,
    onAction: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(view.title, style = MaterialTheme.typography.headlineSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusChip(view.statusLabel, tone = view.statusTone)
            StatusChip(view.severityLabel, tone = view.severityTone)
        }
        Text(
            tr("defect_deadline") + ": " + view.deadline.text,
            style = MaterialTheme.typography.bodyMedium,
            color = toneColor(view.deadline.tone),
        )
        val primary = view.actions.filter { it.primary }
        primary.forEachIndexed {
            index,
            action,
            ->
            ActionButton(action, filled = index == 0 && !view.closed, onClick = { onAction(action.status) })
        }
    }
}

@Composable
private fun ActionButton(
    action: DefectAction,
    filled: Boolean,
    onClick: () -> Unit,
) {
    if (filled) {
        Button(onClick = onClick, modifier = Modifier.fillMaxWidth()) { Text(action.label, maxLines = 1, overflow = TextOverflow.Ellipsis) }
    } else {
        OutlinedButton(
            onClick = onClick,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(action.label, maxLines = 1, overflow = TextOverflow.Ellipsis) }
    }
}

@Composable
private fun FactsCard(
    nav: NavController,
    view: DefectView,
) {
    SectionCard(title = tr("defect_facts")) {
        if (view.roomName != null || view.assetName != null) {
            view.roomId?.let { room -> LabeledValue(tr("defect_room"), view.roomName, onClick = { nav.navigate(Routes.room(room)) }) }
            view.assetId?.let { asset -> LabeledValue(tr("defect_asset"), view.assetName, onClick = { nav.navigate(Routes.asset(asset)) }) }
        }
        view.facts.forEach { fact ->
            LabeledValue(fact.label, if (fact.note.isEmpty()) fact.value else fact.value + "\n" + fact.note)
        }
    }
}

@Composable
private fun EventItem(event: DefectEventRow) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(event.title, style = MaterialTheme.typography.bodyMedium)
        Text(
            event.relativeText + " · " + event.absoluteText,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (event.fromLabel != null || event.toLabel != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                event.fromLabel?.let { StatusChip(it, tone = event.fromTone) }
                event.toLabel?.let { StatusChip(it, tone = event.toTone) }
            }
        }
        if (event.body.isNotEmpty()) LinkedText(event.body)
        if (event.reference.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(tr("defect_event_reference") + ":", style = MaterialTheme.typography.bodySmall)
                LinkedText(event.reference, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
