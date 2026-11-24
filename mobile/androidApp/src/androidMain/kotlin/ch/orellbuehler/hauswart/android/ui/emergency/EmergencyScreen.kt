package ch.orellbuehler.hauswart.android.ui.emergency

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Emergency
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.openUri
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.android.ui.sections.viewFile
import ch.orellbuehler.hauswart.feature.contacts.mailUri
import ch.orellbuehler.hauswart.feature.contacts.telUri
import ch.orellbuehler.hauswart.feature.emergency.EmergencyStore
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun EmergencyScreen(nav: NavController) {
    val store = rememberStore { EmergencyStore(it) }
    val state = store.collect()
    val error = state.error
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    val cannotOpen = tr("m_cannot_open")

    LaunchedEffect(state.sheet) {
        val sheet = state.sheet ?: return@LaunchedEffect
        store.clearSheet()
        if (!context.viewFile(sheet.file)) snackbar.showSnackbar(cannotOpen)
    }
    LaunchedEffect(state.exportError) {
        state.exportError?.let {
            snackbar.showSnackbar(it.message)
            store.dismissExportError()
        }
    }
    val call: (String) -> Unit = { phone -> context.openUri(telUri(phone)) }

    AppScaffold(title = tr("emergency_title"), onBack = { nav.popBackStack() }, snackbarHostState = snackbar) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.description.isEmpty() -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    Column(
                        Modifier.verticalScroll(rememberScrollState()).padding(ScreenPadding),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Text(
                            state.description,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (state.empty) {
                            EmptyState(tr("emergency_empty_title"), tr("emergency_empty_body"), icon = Icons.Outlined.Emergency)
                        }
                        if (state.contacts.isNotEmpty()) {
                            Heading(tr("emergency_contacts"))
                            state.contacts.forEach { c ->
                                SectionCard {
                                    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Text(
                                            c.name,
                                            Modifier.clickable { nav.navigate(Routes.contact(c.id)) },
                                            style = MaterialTheme.typography.titleMedium,
                                        )
                                        if (c.company.isNotEmpty()) Text(c.company, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        if (c.notes.isNotEmpty()) Text(c.notes, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        if (c.phone.isNotEmpty()) {
                                            CallButton(
                                                c.phone,
                                                tr("contact_call_aria", "name" to c.name),
                                            ) { call(c.phone) }
                                        }
                                        if (c.email.isNotEmpty()) {
                                            OutlinedButton(
                                                onClick = { context.openUri(mailUri(c.email)) },
                                                modifier = Modifier.fillMaxWidth(),
                                            ) {
                                                Icon(Icons.Outlined.Mail, contentDescription = tr("contact_mail_aria", "name" to c.name))
                                                Text(
                                                    c.email,
                                                    Modifier.padding(start = 8.dp),
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis,
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        if (state.insurance.isNotEmpty()) {
                            Heading(tr("emergency_insurance"))
                            state.insurance.forEach { p ->
                                SectionCard {
                                    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Text(
                                            p.title,
                                            Modifier.clickable { nav.navigate(Routes.insurance(p.id)) },
                                            style = MaterialTheme.typography.titleMedium,
                                        )
                                        Text(p.subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        if (p.assistancePhone.isNotEmpty()) {
                                            Text(tr("emergency_insurance_assistance"), style = MaterialTheme.typography.labelMedium)
                                            CallButton(
                                                p.assistancePhone,
                                                tr("insurance_call_aria", "title" to p.title),
                                            ) { call(p.assistancePhone) }
                                        }
                                        if (p.insurerPhone.isNotEmpty()) {
                                            OutlinedButton(onClick = { call(p.insurerPhone) }, modifier = Modifier.fillMaxWidth()) {
                                                Icon(Icons.Outlined.Phone, contentDescription = null)
                                                Text(p.insurerPhone, Modifier.padding(start = 8.dp).weight(1f), maxLines = 1)
                                                Text(
                                                    tr("emergency_insurance_insurer"),
                                                    style = MaterialTheme.typography.labelSmall,
                                                    maxLines = 1,
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        if (state.assets.isNotEmpty()) {
                            Heading(tr("emergency_assets"))
                            state.assets.forEach { a ->
                                SectionCard {
                                    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Text(
                                            a.name,
                                            Modifier.clickable { nav.navigate(Routes.asset(a.id)) },
                                            style = MaterialTheme.typography.titleMedium,
                                        )
                                        if (a.room.isNotEmpty()) Text(a.room, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        if (a.hints.isEmpty()) {
                                            Text(tr("emergency_no_hints"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                        a.hints.forEach { h ->
                                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                                Row(
                                                    verticalAlignment = Alignment.CenterVertically,
                                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                                ) {
                                                    StatusChip(h.kindLabel, tone = if (h.kind == "warning") "overdue" else "muted")
                                                    Text(
                                                        h.title,
                                                        style = MaterialTheme.typography.titleSmall,
                                                        modifier = Modifier.weight(1f),
                                                    )
                                                }
                                                if (h.body.isNotEmpty()) Text(h.body, style = MaterialTheme.typography.bodyMedium)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        if (state.pages.isNotEmpty()) {
                            Heading(tr("emergency_pdf_pages"))
                            SectionCard {
                                state.pages.forEach { page ->
                                    ListRow(
                                        title = page.title,
                                        subtitle = page.sectionLabel,
                                        trailing = {
                                            Text(
                                                tr("emergency_open_page"),
                                                color = MaterialTheme.colorScheme.primary,
                                                maxLines = 1,
                                            )
                                        },
                                        onClick = { nav.navigate(Routes.doc(page.slug)) },
                                    )
                                }
                            }
                        }
                        SectionCard(title = tr("emergency_sheet_title")) {
                            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(tr("emergency_sheet_description"), style = MaterialTheme.typography.bodySmall)
                                Row(
                                    Modifier.fillMaxWidth().toggleable(
                                        value = state.includeSecrets,
                                        role = Role.Checkbox,
                                        onValueChange = store::setIncludeSecrets,
                                    ),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Checkbox(checked = state.includeSecrets, onCheckedChange = null)
                                    Column(Modifier.padding(start = 12.dp)) {
                                        Text(tr("emergency_sheet_secrets"))
                                        Text(
                                            tr("emergency_sheet_secrets_hint"),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                                if (state.includeSecrets) {
                                    Text(
                                        tr("emergency_sheet_secrets_warning"),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.error,
                                    )
                                }
                                Button(onClick = store::exportSheet, enabled = !state.exporting) {
                                    if (state.exporting) {
                                        CircularProgressIndicator(Modifier.padding(end = 8.dp).heightIn(max = 18.dp), strokeWidth = 2.dp)
                                    } else {
                                        Icon(Icons.Outlined.PictureAsPdf, contentDescription = null)
                                    }
                                    Text(tr("emergency_sheet_download"), Modifier.padding(start = 8.dp), maxLines = 1)
                                }
                            }
                        }
                    }
                }
        }
    }
}

@Composable
private fun Heading(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium)
}

@Composable
private fun CallButton(
    phone: String,
    description: String,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
        colors =
            ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.error,
                contentColor = MaterialTheme.colorScheme.onError,
            ),
    ) {
        Icon(Icons.Outlined.Phone, contentDescription = description)
        Text(
            phone,
            Modifier.padding(start = 12.dp),
            style = MaterialTheme.typography.titleMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
