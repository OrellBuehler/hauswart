package ch.orellbuehler.hauswart.feature.settings

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.feature.connect.sessionExpiryOf
import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr

data class LanguageOption(
    val code: String,
    val label: String,
)

data class SettingsState(
    /** Display name, else the user name. */
    val userName: String,
    val username: String,
    val serverUrl: String,
    val serverVersion: String? = null,
    /** The day the device token ends, written out; null when it is not known. */
    val signedInUntil: String? = null,
    val loading: Boolean = true,
    val error: UiError? = null,
    val language: String,
    val languages: List<LanguageOption>,
    val signingOut: Boolean = false,
    /** The sub-screens: notifications, reminders, household, integrations, calendar. */
    val entries: List<SettingsEntry> = emptyList(),
    /** What only the web app can do, as rows that open the browser. */
    val browserLinks: List<SettingsBrowserLink> = emptyList(),
)

class SettingsStore(
    private val app: HauswartApp,
) : Store<SettingsState>(
        run {
            val user = app.session.user
            SettingsState(
                userName = user?.displayName?.ifBlank { null } ?: user?.username ?: "",
                username = user?.username ?: "",
                serverUrl = app.session.serverUrl ?: "",
                signedInUntil = signedInUntil(app),
                language = app.locale,
                languages = I18n.locales.map { LanguageOption(it, tr("locale_name_$it")) },
                entries = settingsEntries(app.device.platform),
                browserLinks = settingsBrowserLinks(app.session.serverUrl ?: ""),
            )
        },
    ) {
    init {
        load()
    }

    fun refresh() {
        load()
    }

    fun setLanguage(code: String) {
        if (code == current.language || code !in I18n.locales) return
        app.locale = code
        update {
            it.copy(
                language = code,
                signedInUntil = signedInUntil(app),
                languages = I18n.locales.map { l -> LanguageOption(l, tr("locale_name_$l")) },
                entries = settingsEntries(app.device.platform),
                browserLinks = settingsBrowserLinks(app.session.serverUrl ?: ""),
            )
        }
    }

    /** Revokes the device token and returns to the sign-in; the app switches screens by itself. */
    fun signOut() {
        if (current.signingOut) return
        update { it.copy(signingOut = true) }
        launch({ e -> update { it.copy(signingOut = false, error = e) } }) {
            app.signOut()
        }
    }

    private fun load() {
        update { it.copy(loading = it.serverVersion == null, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val health = app.api.system.health()
            update { it.copy(loading = false, serverVersion = health.version, signedInUntil = signedInUntil(app)) }
        }
    }
}

private fun signedInUntil(app: HauswartApp): String? =
    sessionExpiryOf(app.session.state.value.tokenExpiresAt, app.household.today(), app.household.timezone)?.dateText
