package ch.orellbuehler.hauswart.feature.reminders

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.feature.settings.SettingsOption
import ch.orellbuehler.hauswart.feature.settings.timeOptions
import ch.orellbuehler.hauswart.i18n.tr

const val REMINDER_PERMISSION_UNKNOWN = "unknown"
const val REMINDER_PERMISSION_GRANTED = "granted"
const val REMINDER_PERMISSION_DENIED = "denied"
const val REMINDER_PERMISSION_UNDETERMINED = "undetermined"

private val leadMinutes = listOf(15, 30, 60, 120, 240, 1440)

private fun leadLabel(minutes: Int): String =
    when {
        minutes >= 1440 -> tr("m_reminder_lead_days", "count" to minutes / 1440)
        minutes >= 60 -> tr("m_reminder_lead_hours", "count" to minutes / 60)
        else -> tr("m_reminder_lead_minutes", "count" to minutes)
    }

data class ReminderSettingsState(
    val enabled: Boolean,
    val timeOfDay: String,
    val dueSoon: Boolean,
    val leadMinutes: Int,
    val timeOptions: List<SettingsOption>,
    val leadOptions: List<SettingsOption>,
    /** What the system allows: `unknown` until the app reports it, then `granted`, `denied` or `undetermined`. */
    val permission: String = REMINDER_PERMISSION_UNKNOWN,
    /** Reminders are on and the app has to ask the system for permission now. */
    val requestPermission: Boolean = false,
    /** Reminders are on but the system blocks notifications: the person has to allow them in the system settings. */
    val permissionBlocked: Boolean = false,
    /** Counts every change of the settings; the app plans again when it changes. */
    val revision: Int = 0,
)

/** The reminders of this device: on or off, when, and how far ahead. The app reports the system's permission through [setPermission]. */
class ReminderSettingsStore(
    app: HauswartApp,
) : Store<ReminderSettingsState>(stateOf(ReminderPrefs(app.settings).settings(), REMINDER_PERMISSION_UNKNOWN, 0)) {
    private val prefs = ReminderPrefs(app.settings)

    fun setPermission(value: String) {
        update { stateOf(prefs.settings(), value, it.revision) }
    }

    fun setEnabled(value: Boolean) = change { it.copy(enabled = value) }

    fun setTimeOfDay(value: String) = change { it.copy(timeOfDay = value) }

    fun setDueSoon(value: Boolean) = change { it.copy(dueSoon = value) }

    fun setLeadMinutes(value: Int) = change { it.copy(appointmentLeadMinutes = value) }

    private fun change(transform: (ReminderSettings) -> ReminderSettings) {
        val next = transform(prefs.settings())
        prefs.save(next)
        update { stateOf(next, it.permission, it.revision + 1) }
    }

    private companion object {
        fun stateOf(
            settings: ReminderSettings,
            permission: String,
            revision: Int,
        ) = ReminderSettingsState(
            enabled = settings.enabled,
            timeOfDay = settings.timeOfDay,
            dueSoon = settings.dueSoon,
            leadMinutes = settings.appointmentLeadMinutes,
            timeOptions = timeOptions(settings.timeOfDay),
            leadOptions =
                (leadMinutes + settings.appointmentLeadMinutes)
                    .distinct()
                    .sorted()
                    .map { SettingsOption(it.toString(), leadLabel(it)) },
            permission = permission,
            requestPermission = settings.enabled && permission == REMINDER_PERMISSION_UNDETERMINED,
            permissionBlocked = settings.enabled && permission == REMINDER_PERMISSION_DENIED,
            revision = revision,
        )
    }
}
