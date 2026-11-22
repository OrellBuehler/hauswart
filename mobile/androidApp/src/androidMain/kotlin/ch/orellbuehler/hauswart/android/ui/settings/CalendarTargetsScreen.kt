package ch.orellbuehler.hauswart.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LabeledValue
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.settings.CalendarTargetRow
import ch.orellbuehler.hauswart.feature.settings.CalendarTargetsStore
import ch.orellbuehler.hauswart.i18n.tr

/** The calendars hauswart writes into and their health; switching and "sync now" only where the token may. */
@Composable
fun CalendarTargetsScreen(nav: NavController) {
    val store = rememberStore { CalendarTargetsStore(it) }
    val state = store.collect()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(state.notice, state.actionError) {
        val message = state.notice ?: state.actionError
        if (message != null) {
            snackbar.showSnackbar(message)
            store.dismissMessages()
        }
    }
    AppScaffold(title = tr("settings_tab_calendar"), onBack = { nav.popBackStack() }, snackbarHostState = snackbar) { padding ->
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
                        Text(tr("m_settings_calendar_intro"), style = MaterialTheme.typography.bodyMedium)
                        if (state.rows.isEmpty()) {
                            EmptyState(title = tr("caltargets_empty_title"), body = tr("caltargets_empty_body_member"))
                        }
                        state.rows.forEach { row ->
                            TargetCard(row, onEnabled = { store.setEnabled(row.id, it) }, onSync = { store.syncNow(row.id) })
                        }
                        Text(state.readOnlyNote, style = MaterialTheme.typography.bodySmall)
                        SectionCard { OpenInBrowserRow(tr("settings_tab_calendar"), state.browserUrl) }
                    }
                }
        }
    }
}

@Composable
private fun TargetCard(
    row: CalendarTargetRow,
    onEnabled: (Boolean) -> Unit,
    onSync: () -> Unit,
) {
    SectionCard(title = row.name) {
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusChip(row.stateText, tone = row.stateTone)
                StatusChip(row.level)
            }
            Text(row.place, style = MaterialTheme.typography.bodySmall)
            Text(row.kinds.joinToString(", "), style = MaterialTheme.typography.bodySmall)
        }
        row.errorText?.let { InlineError(it, Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
        row.details.forEach { LabeledValue(it.label, it.value) }
        row.lastRun?.let { LabeledValue(tr("caltargets_last_run"), it) }
        if (row.canManage) {
            Column(Modifier.padding(horizontal = 16.dp)) {
                SwitchField(label = tr("caltargets_enabled"), checked = row.enabled, onChange = onEnabled, enabled = !row.busy)
                OutlinedButton(onClick = onSync, enabled = row.enabled && !row.busy) {
                    Text(tr(if (row.busy) "caltargets_syncing" else "caltargets_sync_now"), maxLines = 1)
                }
                if (!row.enabled) Text(tr("m_settings_calendar_sync_paused"), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
