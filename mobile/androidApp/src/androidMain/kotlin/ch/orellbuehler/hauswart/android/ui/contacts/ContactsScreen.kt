package ch.orellbuehler.hauswart.android.ui.contacts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Emergency
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
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
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.RowIcon
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionTitle
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.contacts.ContactsListStore
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun ContactsScreen(nav: NavController) {
    val store = rememberStore { ContactsListStore(it) }
    val state = store.collect()
    val error = state.error
    AppScaffold(
        title = tr("nav_contacts"),
        onBack = { nav.popBackStack() },
        floatingActionButton = {
            FloatingActionButton(onClick = { nav.openContactNew() }) {
                Icon(Icons.Outlined.Add, contentDescription = tr("contacts_create"))
            }
        },
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.total == 0 -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn(contentPadding = PaddingValues(bottom = 88.dp)) {
                        item {
                            Row(Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp)) {
                                TextField(
                                    label = tr("contacts_search"),
                                    value = state.query,
                                    onChange = store::search,
                                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                                )
                            }
                        }
                        item {
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = ScreenPadding),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                FilterChip(
                                    selected = state.emergencyOnly,
                                    onClick = { store.setEmergencyOnly(!state.emergencyOnly) },
                                    label = { Text(tr("contacts_emergency_only"), maxLines = 1) },
                                    leadingIcon = { Icon(Icons.Outlined.Emergency, contentDescription = null) },
                                )
                                if (state.filtered) {
                                    TextButton(onClick = {
                                        store.search("")
                                        store.setEmergencyOnly(false)
                                    }) { Text(tr("contacts_filter_reset"), maxLines = 1) }
                                }
                            }
                        }
                        if (state.total > 0 && state.filtered && state.shown > 0) {
                            item {
                                Text(
                                    tr("contacts_count", "shown" to state.shown, "total" to state.total),
                                    Modifier.padding(horizontal = ScreenPadding, vertical = 4.dp),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        if (state.total == 0) {
                            item {
                                EmptyState(
                                    title = tr("contacts_empty_title"),
                                    body = tr("contacts_empty_body"),
                                    icon = contactKindIcon("other"),
                                )
                            }
                        } else if (state.groups.isEmpty()) {
                            item {
                                EmptyState(
                                    title = tr("contacts_no_results_title"),
                                    body = tr("contacts_no_results_body"),
                                    icon = Icons.Outlined.Search,
                                )
                            }
                        }
                        state.groups.forEach { group ->
                            item(key = "group-${group.kind}") {
                                SectionTitle(
                                    group.title,
                                    Modifier.padding(horizontal = ScreenPadding),
                                    trailing = group.contacts.size.toString(),
                                )
                            }
                            items(group.contacts, key = { it.id }) { contact ->
                                ListRow(
                                    title = contact.name,
                                    subtitle = contact.company ?: contact.phone,
                                    leading = { RowIcon(contactKindIcon(contact.kind)) },
                                    trailing =
                                        if (contact.emergency) {
                                            {
                                                Icon(
                                                    Icons.Outlined.Emergency,
                                                    contentDescription = tr("contact_emergency_badge"),
                                                    tint = MaterialTheme.colorScheme.error,
                                                )
                                            }
                                        } else {
                                            null
                                        },
                                    onClick = { nav.navigate(Routes.contact(contact.id)) },
                                )
                            }
                        }
                    }
                }
        }
    }
}
