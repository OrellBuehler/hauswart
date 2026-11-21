package ch.orellbuehler.hauswart.android.ui.settings

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.HauswartApplication
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.reminders.ReminderSettingsStore
import ch.orellbuehler.hauswart.i18n.tr

/** Local reminders: on or off, when, how far ahead, and the system permission that lets them show. */
@Composable
fun ReminderSettingsScreen(nav: NavController) {
    val context = LocalContext.current
    val reminders = (context.applicationContext as HauswartApplication).reminders
    val store = rememberStore { ReminderSettingsStore(it) }
    val state = store.collect()
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            reminders.markAsked()
            store.setPermission(reminders.permission())
        }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { store.setPermission(reminders.permission()) }
    LaunchedEffect(state.requestPermission) {
        if (state.requestPermission && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    LaunchedEffect(state.revision) { if (state.revision > 0) reminders.sync() }

    AppScaffold(title = tr("m_reminders_title"), onBack = { nav.popBackStack() }) { padding ->
        Column(
            Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(ScreenPadding),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(tr("m_reminders_description"), style = MaterialTheme.typography.bodyMedium)
            SwitchField(label = tr("m_reminders_enabled"), checked = state.enabled, onChange = store::setEnabled)
            if (state.permissionBlocked) {
                Text(
                    tr("m_reminders_permission_blocked"),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                )
                OutlinedButton(
                    onClick = {
                        context.startActivity(
                            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                        )
                    },
                ) { Text(tr("m_reminders_open_system"), maxLines = 1) }
            }
            if (state.enabled) {
                ChoiceField(
                    label = tr("m_reminders_time"),
                    value = state.timeOfDay,
                    options = state.timeOptions.map { it.value to it.label },
                    onChange = store::setTimeOfDay,
                )
                Text(tr("m_reminders_time_hint"), style = MaterialTheme.typography.bodySmall)
                SwitchField(
                    label = tr("m_reminders_due_soon"),
                    hint = tr("m_reminders_due_soon_hint"),
                    checked = state.dueSoon,
                    onChange = store::setDueSoon,
                )
                ChoiceField(
                    label = tr("m_reminders_lead"),
                    value = state.leadMinutes.toString(),
                    options = state.leadOptions.map { it.value to it.label },
                    onChange = { store.setLeadMinutes(it.toInt()) },
                )
            }
        }
    }
}
