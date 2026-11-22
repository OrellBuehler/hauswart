package ch.orellbuehler.hauswart.session

import ch.orellbuehler.hauswart.api.ApiHttp
import ch.orellbuehler.hauswart.api.generated.User
import ch.orellbuehler.hauswart.platform.KeyValueStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

data class SessionState(
    val serverUrl: String?,
    val user: User?,
    /** When the device token stops working (UTC ISO string from the sign-in); null when not known. */
    val tokenExpiresAt: String? = null,
) {
    val hasServer: Boolean get() = serverUrl != null
    val signedIn: Boolean get() = serverUrl != null && user != null
}

/**
 * Which server the app talks to and who is signed in. The server address and the user are plain
 * preferences, the device token lives in secure storage.
 */
class Session(
    private val secure: KeyValueStore,
    private val plain: KeyValueStore,
) {
    private val _state = MutableStateFlow(load())
    val state: StateFlow<SessionState> = _state.asStateFlow()

    val token: String? get() = if (_state.value.user != null) secure.load(TOKEN) else null
    val serverUrl: String? get() = _state.value.serverUrl
    val user: User? get() = _state.value.user

    /** The user name of the last sign-in, to fill the sign-in screen again after the session ended. */
    val lastUsername: String? get() = plain.load(LAST_USERNAME)

    fun setServer(url: String) {
        if (url != _state.value.serverUrl) {
            clearSignIn()
            plain.delete(LAST_USERNAME)
        }
        plain.save(SERVER, url)
        _state.update { it.copy(serverUrl = url) }
    }

    fun forgetServer() {
        clearSignIn()
        plain.delete(LAST_USERNAME)
        plain.delete(SERVER)
        _state.value = SessionState(null, null)
    }

    fun signIn(
        token: String,
        user: User,
        expiresAt: String? = null,
    ) {
        secure.save(TOKEN, token)
        if (expiresAt != null) plain.save(EXPIRES_AT, expiresAt) else plain.delete(EXPIRES_AT)
        plain.save(LAST_USERNAME, user.username)
        _state.update { it.copy(tokenExpiresAt = expiresAt) }
        saveUser(user)
    }

    fun updateUser(user: User) {
        if (_state.value.user != null) saveUser(user)
    }

    fun signOut() {
        clearSignIn()
        _state.update { it.copy(user = null, tokenExpiresAt = null) }
    }

    private fun saveUser(user: User) {
        plain.save(USER, ApiHttp.JSON.encodeToString(User.serializer(), user))
        _state.update { it.copy(user = user) }
    }

    private fun clearSignIn() {
        secure.delete(TOKEN)
        plain.delete(USER)
        plain.delete(EXPIRES_AT)
    }

    private fun load(): SessionState {
        val server = plain.load(SERVER)
        val user =
            plain.load(USER)?.let { runCatching { ApiHttp.JSON.decodeFromString(User.serializer(), it) }.getOrNull() }
        val signedIn = server != null && user != null && secure.load(TOKEN) != null
        return SessionState(server, if (signedIn) user else null, if (signedIn) plain.load(EXPIRES_AT) else null)
    }

    private companion object {
        const val SERVER = "server_url"
        const val USER = "user"
        const val TOKEN = "device_token"
        const val EXPIRES_AT = "token_expires_at"
        const val LAST_USERNAME = "last_username"
    }
}
