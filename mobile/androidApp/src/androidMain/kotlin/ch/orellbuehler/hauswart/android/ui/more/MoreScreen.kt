package ch.orellbuehler.hauswart.android.ui.more

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.EventNote
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.Category
import androidx.compose.material.icons.outlined.Contacts
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Emergency
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.MeetingRoom
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Umbrella
import androidx.compose.material.icons.outlined.Yard
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.RowIcon
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.more.MoreStore
import ch.orellbuehler.hauswart.i18n.tr

private val destinations: Map<String, Pair<String, ImageVector>> =
    mapOf(
        "appointments" to (Routes.APPOINTMENTS to Icons.AutoMirrored.Outlined.EventNote),
        "inventory" to (Routes.INVENTORY to Icons.Outlined.Category),
        "rooms" to (Routes.ROOMS to Icons.Outlined.MeetingRoom),
        "plants" to (Routes.PLANTS to Icons.Outlined.Yard),
        "docs" to (Routes.DOCS to Icons.AutoMirrored.Outlined.MenuBook),
        "documents" to (Routes.DOCUMENTS to Icons.Outlined.Description),
        "defects" to (Routes.DEFECTS to Icons.Outlined.Build),
        "parts" to (Routes.PARTS to Icons.Outlined.Extension),
        "contacts" to (Routes.CONTACTS to Icons.Outlined.Contacts),
        "emergency" to (Routes.EMERGENCY to Icons.Outlined.Emergency),
        "warranties" to (Routes.WARRANTIES to Icons.Outlined.Shield),
        "insurance" to (Routes.INSURANCE to Icons.Outlined.Umbrella),
    )

@Composable
fun MoreScreen(nav: NavController) {
    val store = rememberStore { MoreStore(it) }
    val state = store.collect()
    AppScaffold(title = tr("m_nav_more")) { padding ->
        Column(
            Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(ScreenPadding),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionCard {
                ListRow(
                    title = state.userName,
                    subtitle = state.username.takeIf { it != state.userName },
                    leading = { RowIcon(Icons.Outlined.AccountCircle) },
                )
            }
            state.groups.forEach { group ->
                SectionCard(title = group.title) {
                    group.items.forEach { item ->
                        val target = destinations[item.id]
                        if (target != null) {
                            ListRow(
                                title = item.title,
                                leading = { RowIcon(target.second) },
                                onClick = { nav.navigate(target.first) },
                            )
                        }
                    }
                }
            }
            SectionCard {
                ListRow(
                    title = tr("nav_settings"),
                    leading = { RowIcon(Icons.Outlined.Settings) },
                    onClick = { nav.navigate(Routes.SETTINGS) },
                )
            }
        }
    }
}
