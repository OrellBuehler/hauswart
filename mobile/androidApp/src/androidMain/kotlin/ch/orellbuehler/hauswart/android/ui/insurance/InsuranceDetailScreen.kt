package ch.orellbuehler.hauswart.android.ui.insurance

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Unarchive
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.LabeledValue
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.openUri
import ch.orellbuehler.hauswart.android.ui.components.toneColor
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.android.ui.sections.AttachmentsSection
import ch.orellbuehler.hauswart.android.ui.sections.CommentsSection
import ch.orellbuehler.hauswart.android.ui.sections.DocumentLinksSection
import ch.orellbuehler.hauswart.feature.contacts.telUri
import ch.orellbuehler.hauswart.feature.insurance.InsuranceDetailStore
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun InsuranceDetailScreen(
    nav: NavController,
    id: String,
) {
    val store = rememberStore(key = id) { InsuranceDetailStore(it, id) }
    val state = store.collect()
    val error = state.error
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }

    LaunchedEffect(state.deleted) { if (state.deleted) nav.popBackStack() }
    LaunchedEffect(state.notice) {
        state.notice?.let {
            snackbar.showSnackbar(it)
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
        title = state.title.ifEmpty { tr("nav_insurance") },
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            if (state.loaded) {
                IconButton(onClick = { nav.openInsuranceEdit(id) }) { Icon(Icons.Outlined.Edit, contentDescription = tr("common_edit")) }
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = tr("insurance_actions")) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text(tr(if (state.archived) "insurance_restore" else "insurance_archive")) },
                        leadingIcon = {
                            Icon(
                                if (state.archived) Icons.Outlined.Unarchive else Icons.Outlined.Archive,
                                contentDescription = null,
                            )
                        },
                        enabled = !state.busy,
                        onClick = {
                            menu = false
                            store.toggleArchive()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text(tr("common_delete")) },
                        leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                        enabled = !state.busy,
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
            state.loaded ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    Column(
                        Modifier.verticalScroll(rememberScrollState()).padding(ScreenPadding),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(state.title, style = MaterialTheme.typography.headlineSmall)
                            Text(state.typeLabel, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (state.archived) StatusChip(tr("insurance_archived"))
                            state.deadline?.let { Text(it.text, color = toneColor(it.tone)) }
                        }
                        if (state.endedText.isNotEmpty()) {
                            SectionCard(title = tr("insurance_term_ended_title")) {
                                Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text(state.endedText)
                                    OutlinedButton(
                                        onClick = { nav.openInsuranceEdit(id) },
                                    ) { Text(tr("insurance_term_ended_action"), maxLines = 1) }
                                }
                            }
                        }
                        if (state.assistancePhone.isNotEmpty()) {
                            SectionCard(title = tr("insurance_assistance")) {
                                Button(
                                    onClick = { context.openUri(telUri(state.assistancePhone)) },
                                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 16.dp),
                                ) {
                                    Icon(Icons.Outlined.Phone, contentDescription = tr("insurance_call_aria", "title" to state.title))
                                    Text(state.assistancePhone, Modifier.padding(start = 12.dp), maxLines = 1)
                                }
                            }
                        }
                        SectionCard(title = tr("insurance_facts")) {
                            LabeledValue(
                                tr("insurance_insurer"),
                                state.insurerName,
                                onClick =
                                    if (state.insurerContactId.isNotEmpty()) {
                                        (
                                            {
                                                nav.navigate(
                                                    Routes.contact(state.insurerContactId),
                                                )
                                            }
                                        )
                                    } else {
                                        null
                                    },
                            )
                            state.facts.forEach { LabeledValue(it.label, it.value) }
                        }
                        SectionCard(title = tr("insurance_assets")) {
                            if (state.assets.isEmpty()) {
                                Text(
                                    tr("insurance_assets_none"),
                                    Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                )
                            }
                            state.assets.forEach { asset ->
                                ListRow(title = asset.name, onClick = { nav.navigate(Routes.asset(asset.id)) })
                            }
                        }
                        SectionCard(title = tr("insurance_deadline_title")) {
                            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (state.cancelBy.isNotEmpty()) {
                                    Text(tr("insurance_cancel_by"), style = MaterialTheme.typography.labelMedium)
                                    Text(state.cancelBy, style = MaterialTheme.typography.titleMedium)
                                } else {
                                    Text(tr("insurance_deadline_none_detail"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Text(tr("insurance_reminder"), style = MaterialTheme.typography.labelMedium)
                                if (state.reminderTaskId.isNotEmpty()) {
                                    OutlinedButton(onClick = { nav.navigate(Routes.task(state.reminderTaskId)) }) {
                                        Text(tr("insurance_reminder_open"), maxLines = 1)
                                    }
                                } else {
                                    Text(tr("insurance_reminder_none"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                        if (state.notes.isNotEmpty()) {
                            SectionCard(title = tr("insurance_notes")) { Text(state.notes, Modifier.padding(horizontal = 16.dp)) }
                        }
                        AttachmentsSection(ownerType = "insurance_policy", ownerId = id)
                        DocumentLinksSection(ownerType = "insurance_policy", ownerId = id)
                        CommentsSection(ownerType = "insurance_policy", ownerId = id)
                    }
                }
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }

    if (confirmDelete) {
        ConfirmDialog(
            title = tr("insurance_delete_title"),
            text = tr("insurance_delete_description", "title" to state.title),
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
