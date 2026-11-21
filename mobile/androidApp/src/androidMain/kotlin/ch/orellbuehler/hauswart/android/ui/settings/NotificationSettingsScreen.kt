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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.SaveBar
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.settings.NotificationSettingsStore
import ch.orellbuehler.hauswart.i18n.tr

/** The caller's push preferences: whether, which kinds, quiet hours and the services that receive them. */
@Composable
fun NotificationSettingsScreen(nav: NavController) {
    val store = rememberStore { NotificationSettingsStore(it) }
    val state = store.collect()
    val snackbar = remember { SnackbarHostState() }
    var manual by remember { mutableStateOf("") }
    val saved = tr("notify_saved")

    LaunchedEffect(state.justSaved) {
        if (state.justSaved) {
            snackbar.showSnackbar(saved)
            store.consumeSaved()
        }
    }

    AppScaffold(
        title = tr("settings_tab_notifications"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        bottomBar = {
            if (!state.loading &&
                state.error == null
            ) {
                SaveBar(onSave = store::save, pending = state.saving, enabled = state.dirty)
            }
        },
    ) { padding ->
        val error = state.error
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else ->
                Column(
                    Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(ScreenPadding),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(tr("notify_description"), style = MaterialTheme.typography.bodyMedium)
                    SwitchField(
                        label = tr("notify_push_enabled"),
                        hint = tr("notify_push_enabled_hint"),
                        checked = state.pushEnabled,
                        onChange = store::setPushEnabled,
                    )
                    SectionCard(title = tr("notify_targets_title")) {
                        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(tr("notify_targets_hint"), style = MaterialTheme.typography.bodySmall)
                            if (!state.connected) {
                                Text(tr("notify_not_connected_title"), style = MaterialTheme.typography.titleSmall)
                                Text(tr("notify_not_connected_body"), style = MaterialTheme.typography.bodySmall)
                            }
                            state.servicesError?.let { InlineError(it + " " + tr("notify_services_failed")) }
                            if (state.connected && state.servicesError == null && state.targets.isEmpty()) {
                                Text(tr("notify_services_empty"), style = MaterialTheme.typography.bodySmall)
                            }
                            state.targets.forEach { row ->
                                SwitchField(
                                    label = row.title,
                                    hint = if (row.missing) row.service + " · " + tr("notify_target_missing") else row.service,
                                    checked = row.enabled,
                                    onChange = { store.setTarget(row.target, it) },
                                )
                            }
                            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TextField(
                                    label = tr("notify_manual_label"),
                                    value = manual,
                                    onChange = { manual = it },
                                    modifier = Modifier.weight(1f),
                                    error = state.manualError,
                                    hint = tr("notify_manual_hint"),
                                )
                                OutlinedButton(
                                    onClick = {
                                        store.addManual(manual)
                                        manual = ""
                                    },
                                    modifier = Modifier.padding(top = 8.dp),
                                ) { Text(tr("common_add"), maxLines = 1) }
                            }
                            if (state.noTarget) {
                                Text(
                                    tr("notify_no_target"),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                        }
                    }
                    SectionCard(title = tr("notify_stages_title")) {
                        Column(Modifier.padding(horizontal = 16.dp)) {
                            Text(tr("notify_stages_hint"), style = MaterialTheme.typography.bodySmall)
                            state.stages.forEach { row ->
                                SwitchField(
                                    label = row.title,
                                    hint = row.hint,
                                    checked = row.enabled,
                                    onChange = { store.setStage(row.stage, it) },
                                )
                            }
                        }
                    }
                    SwitchField(
                        label = tr("notify_quiet_title"),
                        hint = state.quietHint,
                        checked = state.quietOn,
                        onChange = store::setQuietOn,
                    )
                    if (state.quietOn) {
                        ChoiceField(
                            label = tr("notify_quiet_start"),
                            value = state.quietStart,
                            options = state.timeOptions.map { it.value to it.label },
                            onChange = store::setQuietStart,
                        )
                        ChoiceField(
                            label = tr("notify_quiet_end"),
                            value = state.quietEnd,
                            options = state.timeOptions.map { it.value to it.label },
                            onChange = store::setQuietEnd,
                        )
                    }
                    state.saveError?.let { InlineError(it) }
                }
        }
    }
}
