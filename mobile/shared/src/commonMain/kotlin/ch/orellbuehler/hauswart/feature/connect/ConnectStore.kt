package ch.orellbuehler.hauswart.feature.connect

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.ApiException
import ch.orellbuehler.hauswart.api.ApiHttp
import ch.orellbuehler.hauswart.api.generated.AuthTokenRequest
import ch.orellbuehler.hauswart.api.generated.HauswartApi
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.i18n.tr

data class ConnectState(
    /** "server" while no server is chosen, then "login". */
    val step: String,
    val serverUrl: String,
    val serverVersion: String? = null,
    /** The server has no users yet: it must be set up in the browser first. */
    val needsSetup: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
)

/**
 * First start and signed-out state: choose the server (the app is a client of a self-hosted
 * server, so its address is something the person types in), then sign in. Signing in exchanges
 * the password for a device token; the password is never stored.
 */
class ConnectStore(
    private val app: HauswartApp,
) : Store<ConnectState>(
        ConnectState(
            step = if (app.session.serverUrl == null) "server" else "login",
            serverUrl = app.session.serverUrl ?: "",
        ),
    ) {
    fun checkServer(input: String) {
        val url = normalizeServerUrl(input)
        if (url == null) {
            update { it.copy(error = tr("m_connect_invalid_url")) }
            return
        }
        update { it.copy(busy = true, error = null, serverUrl = url) }
        launch(
            { e ->
                update {
                    it.copy(
                        busy = false,
                        error = if (e.isNetwork) tr("m_connect_unreachable") else tr("m_connect_not_hauswart"),
                    )
                }
            },
        ) {
            val probe = HauswartApi(ApiHttp(app.http.clientForProbe(), { url }, { null }, {}))
            val health = probe.system.health()
            val setup = probe.setup.setupStatus()
            app.session.setServer(url)
            update {
                it.copy(
                    busy = false,
                    step = "login",
                    serverVersion = health.version,
                    needsSetup = setup.needsSetup,
                )
            }
        }
    }

    fun changeServer() {
        update { it.copy(step = "server", error = null, needsSetup = false) }
    }

    fun signIn(
        username: String,
        password: String,
    ) {
        if (username.isBlank() || password.isEmpty()) {
            update { it.copy(error = tr("m_connect_credentials_required")) }
            return
        }
        update { it.copy(busy = true, error = null) }
        launch({ e -> update { it.copy(busy = false, error = e.message) } }) {
            val response =
                try {
                    app.api.auth.authToken(
                        AuthTokenRequest(
                            username = username.trim(),
                            password = password,
                            deviceName =
                                app.device.name
                                    .take(64)
                                    .ifBlank { app.device.platform },
                            platform = app.device.platform,
                        ),
                    )
                } catch (e: ApiException) {
                    if (e.code == "setup_required") update { it.copy(needsSetup = true) }
                    throw e
                }
            if (app.settingsLocaleUnset()) app.locale = response.user.locale
            app.session.signIn(response.token, response.user)
            update { it.copy(busy = false) }
        }
    }
}

/**
 * What a person types becomes a base address: scheme added when missing (https, or http for a
 * bare IP address or a host without a dot, which is how a server on the home network is reached),
 * path, query and trailing slash removed. Null when it cannot be an address.
 */
fun normalizeServerUrl(input: String): String? {
    var text = input.trim()
    if (text.isEmpty() || text.any { it.isWhitespace() }) return null
    val hasScheme = text.startsWith("http://", ignoreCase = true) || text.startsWith("https://", ignoreCase = true)
    if (!hasScheme) {
        if (text.contains("://")) return null
        val host = text.substringBefore('/').substringBefore(':')
        val local = !host.contains('.') || host.all { it.isDigit() || it == '.' } || host.endsWith(".local", ignoreCase = true)
        text = (if (local) "http://" else "https://") + text
    }
    val scheme = text.substringBefore("://").lowercase()
    val rest = text.substringAfter("://")
    val authority = rest.substringBefore('/').substringBefore('?').substringBefore('#')
    if (authority.isEmpty() || authority.startsWith(":") || authority.contains('@')) return null
    val host = authority.substringBeforeLast(':', authority)
    val port = if (authority.contains(':')) authority.substringAfterLast(':') else null
    if (host.isEmpty() || (port != null && (port.isEmpty() || !port.all { it.isDigit() }))) return null
    if (!host.all { it.isLetterOrDigit() || it == '.' || it == '-' || it == '[' || it == ']' }) return null
    return "$scheme://${authority.lowercase()}"
}
