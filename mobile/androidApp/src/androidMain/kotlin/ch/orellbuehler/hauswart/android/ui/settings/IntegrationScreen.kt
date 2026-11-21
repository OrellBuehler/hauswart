package ch.orellbuehler.hauswart.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LabeledValue
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PrimaryButton
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.settings.IntegrationConnectionStore
import ch.orellbuehler.hauswart.i18n.tr

/**
 * One connection. Home Assistant is the household's and needs an administrator, so it is shown
 * read-only; the document system and the finance provider are personal and can be connected, tested,
 * synced and disconnected here.
 */
@Composable
fun IntegrationScreen(
    nav: NavController,
    kind: String,
) {
    val store = rememberStore(key = kind) { IntegrationConnectionStore(it, kind) }
    val state = store.collect()
    val snackbar = remember { SnackbarHostState() }
    var form by remember(state.formVersion) { mutableStateOf(state.initial) }
    var confirmDisconnect by remember { mutableStateOf(false) }

    LaunchedEffect(state.notice) {
        state.notice?.let {
            snackbar.showSnackbar(it)
            store.consumeNotice()
        }
    }

    AppScaffold(
        title =
            state.name.ifEmpty {
                tr("settings_tab_integrations")
            },
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
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
                    Text(state.description, style = MaterialTheme.typography.bodyMedium)
                    StatusChip(state.statusText, tone = state.statusTone)
                    state.errorText?.let {
                        Text(
                            tr("integration_error_title"),
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                        InlineError(it)
                    }
                    if (state.details.isNotEmpty()) {
                        SectionCard { state.details.forEach { LabeledValue(it.label, it.value) } }
                    }
                    state.test?.let { OutcomeBox(it) }
                    state.sync?.let { OutcomeBox(it) }
                    if (state.canEdit) {
                        TextField(
                            label = tr("integration_ha_url"),
                            value = form.baseUrl,
                            onChange = { form = form.copy(baseUrl = it) },
                            error = state.fieldErrors["baseUrl"],
                            hint = state.urlHint,
                            keyboardType = KeyboardType.Uri,
                        )
                        TextField(
                            label = state.tokenLabel,
                            value = form.token,
                            onChange = { form = form.copy(token = it) },
                            error = state.fieldErrors["token"],
                            hint = if (state.configured) tr("integration_ha_token_stored_hint") else state.tokenHint,
                            secret = true,
                        )
                        SwitchField(
                            label = tr("integration_ha_insecure"),
                            hint = state.insecureHint,
                            checked = form.allowInsecureTls,
                            onChange = { form = form.copy(allowInsecureTls = it) },
                        )
                        SwitchField(
                            label = tr("integration_ha_enabled"),
                            hint = state.enabledHint,
                            checked = form.enabled,
                            onChange = { form = form.copy(enabled = it) },
                        )
                        state.actionError?.let { InlineError(it) }
                        PrimaryButton(
                            text = tr(if (state.configured) "common_save" else "integration_connect"),
                            pendingText = tr("common_saving"),
                            onClick = { store.save(form) },
                            pending = state.saving,
                            enabled = !state.testing,
                        )
                        if (state.configured) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = store::test, enabled = !state.testing && !state.saving) {
                                    Text(tr(if (state.testing) "integration_testing" else "integration_test"), maxLines = 1)
                                }
                                if (state.canSync) {
                                    OutlinedButton(onClick = store::syncNow, enabled = !state.syncing) {
                                        Text(
                                            tr(if (state.syncing) "integration_kept_sync_running" else "integration_kept_sync_now"),
                                            maxLines = 1,
                                        )
                                    }
                                }
                            }
                            TextButton(
                                onClick = { confirmDisconnect = true },
                                enabled = !state.disconnecting,
                                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                            ) { Text(tr("integration_disconnect"), maxLines = 1) }
                        }
                    } else {
                        state.readOnlyNote?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                        state.actionError?.let { InlineError(it) }
                    }
                    SectionCard { OpenInBrowserRow(tr("settings_tab_integrations"), state.browserUrl) }
                }
        }
    }
    if (confirmDisconnect) {
        ConfirmDialog(
            title = state.disconnectTitle,
            text = state.disconnectText,
            confirmLabel = tr("integration_disconnect_confirm"),
            destructive = true,
            onConfirm = {
                confirmDisconnect = false
                store.disconnect()
            },
            onDismiss = { confirmDisconnect = false },
        )
    }
}
