package ch.orellbuehler.hauswart

import ch.orellbuehler.hauswart.api.ApiHttp
import ch.orellbuehler.hauswart.api.generated.HauswartApi
import ch.orellbuehler.hauswart.api.generated.Household
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.platform.DeviceInfo
import ch.orellbuehler.hauswart.platform.KeyValueStore
import ch.orellbuehler.hauswart.session.Session
import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpTimeout
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The root object of the shared module: one per process. Stores take it as their only
 * constructor argument.
 */
class HauswartApp(
    secure: KeyValueStore,
    val settings: KeyValueStore,
    val device: DeviceInfo,
    client: HttpClient,
) {
    constructor(
        secure: KeyValueStore,
        settings: KeyValueStore,
        device: DeviceInfo,
    ) : this(secure, settings, device, defaultClient())

    val session: Session = Session(secure, settings)
    val http: ApiHttp =
        ApiHttp(
            client = client,
            baseUrl = { session.serverUrl },
            token = { session.token },
            onUnauthenticated = { signedOut() },
        )
    val api: HauswartApi = HauswartApi(http)
    val household: HouseholdContext = HouseholdContext(this)

    private val _changes = MutableSharedFlow<String>(extraBufferCapacity = 64)

    /** Topics that were written to (see [changed]); stores reload on the ones they show. */
    val changes: SharedFlow<String> = _changes.asSharedFlow()

    /**
     * Tells every open screen that data of [topics] changed, e.g. `changed("contacts")` after a
     * contact was saved. Topics are the plural domain names: tasks, appointments, assets, rooms,
     * contacts, defects, parts, costs, docs, documents, insurance, vehicles, notifications.
     */
    fun changed(vararg topics: String) {
        topics.forEach { _changes.tryEmit(it) }
    }

    init {
        I18n.locale = settings.load(LOCALE) ?: session.user?.locale ?: device.language
    }

    private val _locale = MutableStateFlow(I18n.locale)

    /** The language of the app, to rebuild the screens when it changes. */
    val localeFlow: StateFlow<String> = _locale.asStateFlow()

    /** "de" or "en". Chosen in the app; until then the signed-in user's language. */
    var locale: String
        get() = I18n.locale
        set(value) {
            I18n.locale = value
            settings.save(LOCALE, I18n.locale)
            _locale.value = I18n.locale
        }

    internal fun settingsLocaleUnset(): Boolean = settings.load(LOCALE) == null

    /** Revokes the device token on the server (best effort) and forgets it. */
    suspend fun signOut() {
        runCatching { api.auth.authRevokeToken() }
        signedOut()
    }

    internal fun signedOut() {
        session.signOut()
        household.clear()
    }

    companion object {
        private const val LOCALE = "locale"

        fun defaultClient(): HttpClient =
            HttpClient {
                expectSuccess = false
                install(HttpTimeout) {
                    connectTimeoutMillis = 10_000
                    requestTimeoutMillis = 30_000
                    socketTimeoutMillis = 30_000
                }
            }
    }
}

data class Member(
    val id: String,
    val name: String,
)

data class HouseholdInfo(
    val name: String,
    val timezone: String,
    val currency: String,
    val members: List<Member>,
)

/**
 * What nearly every screen needs to know about the household: time zone, currency and the people.
 * Loaded once after sign-in and kept; [refresh] reloads it.
 */
class HouseholdContext internal constructor(
    private val app: HauswartApp,
) {
    private val mutex = Mutex()
    private val _info = MutableStateFlow<HouseholdInfo?>(null)
    val info: StateFlow<HouseholdInfo?> = _info.asStateFlow()

    val timezone: String get() = _info.value?.timezone ?: "UTC"
    val currency: String get() = _info.value?.currency ?: "CHF"
    val members: List<Member> get() = _info.value?.members ?: emptyList()

    /** Today in the household's time zone. */
    fun today(): String = Dates.today(timezone)

    fun memberName(id: String?): String? = id?.let { wanted -> members.firstOrNull { it.id == wanted }?.name }

    /** The loaded household, fetching it first when it is not there yet. */
    suspend fun get(): HouseholdInfo =
        mutex.withLock {
            _info.value ?: load()
        }

    suspend fun refresh(): HouseholdInfo = mutex.withLock { load() }

    internal fun clear() {
        _info.value = null
    }

    private suspend fun load(): HouseholdInfo {
        val household: Household = app.api.household.householdGet()
        val directory = app.api.users.usersDirectory()
        val loaded =
            HouseholdInfo(
                name = household.name,
                timezone = household.timezone,
                currency = household.currency,
                members = directory.items.map { Member(it.id, it.displayName) },
            )
        _info.value = loaded
        return loaded
    }
}
