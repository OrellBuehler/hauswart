package ch.orellbuehler.hauswart.feature.settings

import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr

/** A choice of a dropdown or picker: the [value] the store works with and the [label] shown. */
data class SettingsOption(
    val value: String,
    val label: String,
)

/**
 * The times of a day in half-hour steps as `HH:mm`. Every time in [extra] that is not on that grid
 * (the server may hold 22:15) is added, so that a picker never shows a value it cannot select.
 */
fun timeOptions(vararg extra: String?): List<SettingsOption> {
    val grid = (0 until 48).map { "${(it / 2).toString().padStart(2, '0')}:${if (it % 2 == 0) "00" else "30"}" }
    val times = (grid + extra.filterNotNull().filter { timePattern.matches(it) }).distinct().sorted()
    return times.map { SettingsOption(it, it) }
}

private val timePattern = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")

/** The address of [path] (`settings/tokens`) on the household's server. */
fun browserUrl(
    serverUrl: String,
    path: String,
): String = serverUrl.trimEnd('/') + "/" + path.trimStart('/')

/** One row of the settings list that opens a screen of its own; [id] is `notifications`, `reminders`, `contact_sync`, `household`, `integrations` or `calendar`. */
data class SettingsEntry(
    val id: String,
    val title: String,
)

/** What a device token cannot do stays in the web app: a row that opens [url] in the system browser. */
data class SettingsBrowserLink(
    val id: String,
    val title: String,
    val url: String,
)

/** The phone contacts exist on iOS only so far, so only [platform] `ios` gets that row. */
internal fun settingsEntries(platform: String): List<SettingsEntry> =
    listOfNotNull(
        SettingsEntry("notifications", tr("settings_tab_notifications")),
        SettingsEntry("reminders", tr("m_reminders_title")),
        if (platform == "ios") SettingsEntry("contact_sync", tr("m_contact_sync_title")) else null,
        SettingsEntry("household", tr("settings_tab_household")),
        SettingsEntry("integrations", tr("settings_tab_integrations")),
        SettingsEntry("calendar", tr("settings_tab_calendar")),
    )

internal fun settingsBrowserLinks(serverUrl: String): List<SettingsBrowserLink> {
    if (serverUrl.isBlank()) return emptyList()
    return listOf(
        SettingsBrowserLink("account", tr("m_settings_browser_password"), browserUrl(serverUrl, "settings/account")),
        SettingsBrowserLink("tokens", tr("settings_tab_tokens"), browserUrl(serverUrl, "settings/tokens")),
        SettingsBrowserLink("devices", tr("settings_tab_devices"), browserUrl(serverUrl, "settings/devices")),
        SettingsBrowserLink("guest-links", tr("settings_tab_guest_links"), browserUrl(serverUrl, "settings/guest-links")),
        SettingsBrowserLink("calendar-feeds", tr("m_settings_browser_feeds"), browserUrl(serverUrl, "settings/calendar")),
    )
}

internal const val HOME_ASSISTANT = "homeassistant"
internal const val PAPERLESS = "paperless"
internal const val KEPT = "kept"

/** The short name the web's message keys use for an integration kind: `ha`, `paperless` or `kept`. */
internal fun kindKey(kind: String): String = if (kind == HOME_ASSISTANT) "ha" else kind

/** Whether the app knows the kind; a newer server may list others. */
internal fun isKnownKind(kind: String): Boolean = kind == HOME_ASSISTANT || kind == PAPERLESS || kind == KEPT

/**
 * A sentence for the short code an adapter stored for a failed call (`unauthorized`, `tls`, ...),
 * worded for the system it was about, then for any system, else the generic one.
 */
fun integrationErrorText(
    code: String?,
    kind: String,
): String {
    if (code != null) {
        val own =
            when (kind) {
                PAPERLESS -> "integration_paperless_error_$code"
                KEPT -> "integration_kept_error_$code"
                else -> "integration_error_$code"
            }
        if (I18n.has(own)) return tr(own)
        val common = "integration_error_$code"
        if (I18n.has(common)) return tr(common)
    }
    return tr("integration_error_unknown")
}
