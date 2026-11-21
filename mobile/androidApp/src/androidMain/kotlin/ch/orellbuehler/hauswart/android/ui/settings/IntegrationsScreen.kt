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
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.settings.IntegrationsListStore
import ch.orellbuehler.hauswart.i18n.tr

/** The connections to other systems and how they are doing; a personal one opens its own screen to connect, test and disconnect. */
@Composable
fun IntegrationsScreen(nav: NavController) {
    val store = rememberStore { IntegrationsListStore(it) }
    val state = store.collect()
    AppScaffold(title = tr("settings_tab_integrations"), onBack = { nav.popBackStack() }) { padding ->
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
                        Text(state.description, style = MaterialTheme.typography.bodyMedium)
                        SectionCard {
                            state.rows.forEach { row ->
                                ListRow(
                                    title = row.name,
                                    subtitle = listOfNotNull(row.description, row.detail).joinToString("\n"),
                                    subtitleLines = 4,
                                    trailing = { StatusChip(row.statusText, tone = row.statusTone) },
                                    onClick = { nav.navigate(Routes.settingsIntegration(row.kind)) },
                                )
                            }
                        }
                        SectionCard { OpenInBrowserRow(tr("settings_tab_integrations"), state.browserUrl) }
                    }
                }
        }
    }
}
