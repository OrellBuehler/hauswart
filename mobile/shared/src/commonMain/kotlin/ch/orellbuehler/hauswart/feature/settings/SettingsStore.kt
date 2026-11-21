package ch.orellbuehler.hauswart.feature.settings

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
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
    val loading: Boolean = true,
    val error: UiError? = null,
    val language: String,
    val languages: List<LanguageOption>,
    val signingOut: Boolean = false,
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
                language = app.locale,
                languages = I18n.locales.map { LanguageOption(it, tr("locale_name_$it")) },
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
        update { it.copy(language = code, languages = I18n.locales.map { l -> LanguageOption(l, tr("locale_name_$l")) }) }
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
            update { it.copy(loading = false, serverVersion = health.version) }
        }
    }
}
