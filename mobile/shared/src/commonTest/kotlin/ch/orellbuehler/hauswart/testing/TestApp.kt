package ch.orellbuehler.hauswart.testing

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.User
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.platform.DeviceInfo
import ch.orellbuehler.hauswart.platform.MemoryStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.concurrent.Volatile
import kotlin.time.Duration.Companion.seconds

class Recorded(
    val method: String,
    val path: String,
    val query: String,
    val body: String,
) {
    /** The request body as JSON. */
    val json: JsonObject get() = Json.parseToJsonElement(body).jsonObject
}

/**
 * A [HauswartApp] on a mock server for store tests. Answer requests with [on]; every request is
 * kept in [requests]. Call [close] after the test (an `@AfterTest`), which restores the main
 * dispatcher the stores run on.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TestApp(
    val settings: MemoryStore = MemoryStore(),
    val secure: MemoryStore = MemoryStore(),
) {
    // The mock engine answers on another thread (one at a time), so both collections are replaced
    // as a whole instead of mutated: a test may read them at any moment.
    @Volatile
    private var recorded = emptyList<Recorded>()
    val requests: List<Recorded> get() = recorded

    /** While true the mock server cannot be reached at all. */
    @Volatile
    var offline = false

    @Volatile
    private var replies = emptyMap<String, Pair<HttpStatusCode, String>>()

    init {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    val app: HauswartApp =
        HauswartApp(
            secure = secure,
            settings = settings,
            device = DeviceInfo(name = "Test phone", platform = "android", language = "de"),
            client =
                HttpClient(
                    MockEngine.create {
                        dispatcher = Dispatchers.Default.limitedParallelism(1)
                        addHandler { request ->
                            check(!offline) { "connection refused" }
                            val path = request.url.encodedPath
                            recorded = recorded +
                                Recorded(
                                    request.method.value,
                                    path,
                                    request.url.encodedQuery,
                                    request.body.toByteArray().decodeToString(),
                                )
                            val (status, body) =
                                replies["${request.method.value} $path"]
                                    ?: (HttpStatusCode.NotFound to """{"error":{"code":"not_found","message":"Not found"}}""")
                            respond(body, status, headersOf(HttpHeaders.ContentType, "application/json"))
                        }
                    },
                ),
        )

    /** Answers `METHOD path` (without the query) with [body] and [status]. */
    fun on(
        method: String,
        path: String,
        body: String,
        status: HttpStatusCode = HttpStatusCode.OK,
    ) {
        replies = replies + ("$method $path" to (status to body))
    }

    fun onError(
        method: String,
        path: String,
        status: HttpStatusCode,
        code: String,
        message: String = code,
        details: String = "null",
    ) = on(method, path, """{"error":{"code":"$code","message":"$message","details":$details}}""", status)

    /** A signed-in user on a server, as after the sign-in screen. */
    fun signIn(
        serverUrl: String = "https://home.example.org",
        user: User = User(id = "u1", username = "anna", displayName = "Anna", role = "admin", locale = "de"),
    ) {
        app.session.setServer(serverUrl)
        app.session.signIn("hw_test", user)
    }

    /** Answers the household and its people, which most screens load first. */
    fun household(name: String = "Example Home") {
        on(
            "GET",
            "/api/v1/household",
            """{"name":"$name","timezone":"Europe/Zurich","currency":"CHF","handoverDate":null,
                "settings":{"dueSoonDays":7,"digestTime":"07:00","defectDeadlineMonths":24},"updatedAt":"2026-01-01T00:00:00.000Z"}""",
        )
        on("GET", "/api/v1/users/directory", """{"items":[{"id":"u1","displayName":"Anna","ownershipBps":10000}],"nextCursor":null}""")
    }

    fun requestsTo(
        method: String,
        path: String,
    ): List<Recorded> = requests.filter { it.method == method && it.path == path }

    fun close() {
        Dispatchers.resetMain()
    }
}

/**
 * Waits until the store's state satisfies [predicate]. The mock engine answers on another thread,
 * so a test waits for the outcome instead of assuming it is there.
 */
suspend fun <S : Any> Store<S>.await(predicate: (S) -> Boolean): S = state.awaitValue(predicate)

/** Waits until a state flow (the session, say) holds a value that satisfies [predicate]. */
suspend fun <T> StateFlow<T>.awaitValue(predicate: (T) -> Boolean): T =
    withContext(Dispatchers.Default) {
        withTimeout(60.seconds) { first(predicate) }
    }
