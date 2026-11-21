package ch.orellbuehler.hauswart.android.ui.more

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.BuildConfig
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LabeledValue
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.PrimaryButton
import ch.orellbuehler.hauswart.android.ui.components.RowIcon
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.android.ui.settings.OpenInBrowserRow
import ch.orellbuehler.hauswart.android.ui.settings.settingsRoute
import ch.orellbuehler.hauswart.feature.settings.SettingsStore
import ch.orellbuehler.hauswart.i18n.tr

/** A list of sections; later features add their own cards to the column. */
@Composable
fun SettingsScreen(nav: NavController) {
    val store = rememberStore { SettingsStore(it) }
    val state = store.collect()
    var confirmSignOut by remember { mutableStateOf(false) }
    AppScaffold(title = tr("settings_title"), onBack = { nav.popBackStack() }) { padding ->
        Column(
            Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(ScreenPadding),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionCard(title = tr("account_title")) {
                LabeledValue(tr("auth_display_name"), state.userName)
                LabeledValue(tr("account_username"), state.username)
            }
            SectionCard {
                ChoiceField(
                    label = tr("language_label"),
                    value = state.language,
                    options = state.languages.map { it.code to it.label },
                    onChange = store::setLanguage,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
            }
            SectionCard(title = tr("m_settings_section_system")) {
                state.entries.forEach { entry ->
                    settingsRoute(entry.id)?.let { route ->
                        ListRow(
                            title = entry.title,
                            trailing = { RowIcon(Icons.AutoMirrored.Outlined.KeyboardArrowRight) },
                            onClick = { nav.navigate(route) },
                        )
                    }
                }
            }
            if (state.browserLinks.isNotEmpty()) {
                SectionCard(title = tr("m_settings_section_browser")) {
                    state.browserLinks.forEach { OpenInBrowserRow(it.title, it.url) }
                }
            }
            SectionCard(title = tr("m_settings_server")) {
                LabeledValue(tr("m_settings_server"), state.serverUrl)
                LabeledValue(tr("m_settings_server_version"), state.serverVersion)
            }
            SectionCard(title = tr("m_settings_about")) {
                LabeledValue(tr("m_settings_app_version"), BuildConfig.VERSION_NAME)
            }
            state.error?.let { InlineError(it.message) }
            PrimaryButton(
                text = tr("auth_logout"),
                onClick = { confirmSignOut = true },
                pending = state.signingOut,
            )
        }
    }
    if (confirmSignOut) {
        ConfirmDialog(
            title = tr("m_settings_signout_title"),
            text = tr("m_settings_signout_text"),
            confirmLabel = tr("auth_logout"),
            destructive = true,
            onConfirm = {
                confirmSignOut = false
                store.signOut()
            },
            onDismiss = { confirmSignOut = false },
        )
    }
}
