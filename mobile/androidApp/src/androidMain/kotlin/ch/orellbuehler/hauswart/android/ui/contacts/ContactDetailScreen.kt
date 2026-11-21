package ch.orellbuehler.hauswart.android.ui.contacts

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
import androidx.compose.material.icons.outlined.Emergency
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.appointments.AppointmentsSection
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.LabeledValue
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.rememberUriOpener
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.android.ui.sections.AttachmentsSection
import ch.orellbuehler.hauswart.android.ui.sections.DocumentLinksSection
import ch.orellbuehler.hauswart.feature.contacts.ContactDetailStore
import ch.orellbuehler.hauswart.feature.contacts.contactKindLabel
import ch.orellbuehler.hauswart.feature.contacts.mailUri
import ch.orellbuehler.hauswart.feature.contacts.mapUri
import ch.orellbuehler.hauswart.feature.contacts.telUri
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.launch

@Composable
fun ContactDetailScreen(
    nav: NavController,
    id: String,
) {
    val store = rememberStore(key = id) { ContactDetailStore(it, id) }
    val state = store.collect()
    val contact = state.contact
    val error = state.error
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val open = rememberUriOpener()
    var confirmDelete by remember { mutableStateOf(false) }
    val cannotOpen = tr("m_cannot_open")
    val openOrReport: (String) -> Unit = { uri ->
        if (!open(uri)) scope.launch { snackbar.showSnackbar(cannotOpen) }
    }

    LaunchedEffect(state.deleted) { if (state.deleted) nav.popBackStack() }
    LaunchedEffect(state.actionError) {
        state.actionError?.let {
            snackbar.showSnackbar(it.message)
            store.dismissActionError()
        }
    }

    AppScaffold(
        title = contact?.name ?: tr("nav_contacts"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            if (contact != null) {
                IconButton(onClick = { nav.openContactEdit(id) }) { Icon(Icons.Outlined.Edit, contentDescription = tr("common_edit")) }
                IconButton(onClick = { confirmDelete = true }, enabled = !state.deleting) {
                    Icon(Icons.Outlined.Delete, contentDescription = tr("common_delete"))
                }
            }
        },
    ) { padding ->
        when {
            contact != null ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    Column(
                        Modifier.verticalScroll(rememberScrollState()).padding(ScreenPadding),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(contact.name, style = MaterialTheme.typography.headlineSmall)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(
                                    listOfNotNull(contactKindLabel(contact.kind), contact.company).joinToString(" · "),
                                    Modifier.weight(1f, fill = false),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                if (contact.emergency) {
                                    StatusChip(
                                        tr("contact_emergency_badge"),
                                        tone = "overdue",
                                        icon = Icons.Outlined.Emergency,
                                    )
                                }
                            }
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            contact.phone?.takeIf { it.isNotBlank() }?.let { phone ->
                                FilledTonalButton(onClick = { openOrReport(telUri(phone)) }) {
                                    Icon(Icons.Outlined.Phone, contentDescription = tr("contact_call_aria", "name" to contact.name))
                                }
                            }
                            contact.email?.takeIf { it.isNotBlank() }?.let { email ->
                                FilledTonalButton(onClick = { openOrReport(mailUri(email)) }) {
                                    Icon(Icons.Outlined.Mail, contentDescription = tr("contact_mail_aria", "name" to contact.name))
                                }
                            }
                            contact.url?.takeIf { it.isNotBlank() }?.let { url ->
                                FilledTonalButton(onClick = { openOrReport(url) }) {
                                    Icon(Icons.Outlined.Public, contentDescription = tr("contact_web_aria", "name" to contact.name))
                                }
                            }
                            contact.address?.takeIf { it.isNotBlank() }?.let { address ->
                                FilledTonalButton(onClick = { openOrReport(mapUri(address)) }) {
                                    Icon(Icons.Outlined.Map, contentDescription = tr("contact_address"))
                                }
                            }
                        }
                        SectionCard(title = tr("contact_details_title")) {
                            LabeledValue(tr("contact_phone"), contact.phone, onClick = { openOrReport(telUri(contact.phone.orEmpty())) })
                            LabeledValue(tr("contact_email"), contact.email, onClick = { openOrReport(mailUri(contact.email.orEmpty())) })
                            LabeledValue(tr("contact_url"), contact.url, onClick = { openOrReport(contact.url.orEmpty()) })
                            LabeledValue(
                                tr("contact_address"),
                                contact.address,
                                onClick = { openOrReport(mapUri(contact.address.orEmpty())) },
                            )
                            LabeledValue(tr("contact_guest_visible"), tr(if (contact.guestVisible) "common_yes" else "common_no"))
                            if (!contact.notes.isNullOrBlank()) LabeledValue(tr("contact_notes"), contact.notes)
                        }
                        AppointmentsSection(nav, contactId = contact.id)
                        SectionCard(title = tr("contact_assets_title")) {
                            if (contact.assets.isEmpty()) {
                                EmptyState(tr("contact_assets_empty_title"), tr("contact_assets_empty_body"))
                            }
                            contact.assets.forEach { link ->
                                ListRow(
                                    title = link.assetName,
                                    trailing = { StatusChip(tr("contact_role_${link.role}")) },
                                    onClick = { nav.navigate(Routes.asset(link.assetId)) },
                                )
                            }
                        }
                        AttachmentsSection(ownerType = "contact", ownerId = contact.id)
                        DocumentLinksSection(ownerType = "contact", ownerId = contact.id)
                    }
                }
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }

    if (confirmDelete && contact != null) {
        ConfirmDialog(
            title = tr("contact_delete_title"),
            text = tr("contact_delete_description", "name" to contact.name),
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
