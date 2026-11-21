package ch.orellbuehler.hauswart.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.LabeledValue
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.settings.HouseholdSettingsStore
import ch.orellbuehler.hauswart.i18n.tr

/** The household's settings, read-only: changing them needs the administrator scope that a device token never has. */
@Composable
fun HouseholdSettingsScreen(nav: NavController) {
    val store = rememberStore { HouseholdSettingsStore(it) }
    val state = store.collect()
    AppScaffold(title = tr("settings_tab_household"), onBack = { nav.popBackStack() }) { padding ->
        val error = state.error
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.rows.isEmpty() -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    Column(
                        Modifier.verticalScroll(rememberScrollState()).padding(ScreenPadding),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text(state.readOnlyNote, style = MaterialTheme.typography.bodyMedium)
                        SectionCard(title = tr("household_title")) {
                            state.rows.forEach { LabeledValue(it.label, it.value) }
                        }
                        if (state.allowedHosts.isNotEmpty()) {
                            SectionCard(title = tr("household_host_allowlist")) {
                                state.allowedHosts.forEach { LabeledValue(it, null) }
                            }
                        }
                        SectionCard { OpenInBrowserRow(tr("settings_tab_household"), state.browserUrl) }
                    }
                }
        }
    }
}
