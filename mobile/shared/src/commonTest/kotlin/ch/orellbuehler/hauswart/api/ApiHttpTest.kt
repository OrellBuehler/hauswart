package ch.orellbuehler.hauswart.api

import ch.orellbuehler.hauswart.api.generated.HauswartApi
import ch.orellbuehler.hauswart.api.generated.TasksCreateRequest
import ch.orellbuehler.hauswart.api.generated.TasksUpdateRequest
import ch.orellbuehler.hauswart.api.generated.Trigger
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.HttpTimeoutCapability
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ApiHttpTest {
    private val jsonHeaders = headersOf(HttpHeaders.ContentType, "application/json")
    private var unauthenticated = 0
    private var currentToken: String? = "hw_test"

    private fun http(
        token: () -> String?,
        handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData,
    ): ApiHttp =
        ApiHttp(
            HttpClient(MockEngine(handler)) { install(HttpTimeout) { requestTimeoutMillis = 30_000 } },
            { "https://home.example.org/" },
            token,
            { unauthenticated++ },
        )

    private fun api(
        token: String? = "hw_test",
        handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData,
    ): HauswartApi {
        currentToken = token
        return HauswartApi(http({ currentToken }, handler))
    }

    @Test
    fun sendsBearerQueryAndDecodes() =
        runTest {
            lateinit var seen: HttpRequestData
            val api =
                api { request ->
                    seen = request
                    respond("""{"items":[],"nextCursor":null}""", HttpStatusCode.OK, jsonHeaders)
                }
            val page = api.tasks.tasksList(status = "due", includeArchived = true, limit = 20)
            assertEquals(emptyList(), page.items)
            assertNull(page.nextCursor)
            assertEquals("Bearer hw_test", seen.headers[HttpHeaders.Authorization])
            assertEquals("https://home.example.org/api/v1/tasks?limit=20&status=due&includeArchived=true", seen.url.toString())
        }

    @Test
    fun encodesPathSegments() =
        runTest {
            lateinit var seen: HttpRequestData
            val api =
                api { request ->
                    seen = request
                    respond("", HttpStatusCode.NoContent)
                }
            api.tasks.tasksDelete("a/b c")
            assertEquals("/api/v1/tasks/a%2Fb%20c", seen.url.encodedPath)
            assertEquals("DELETE", seen.method.value)
        }

    @Test
    fun mapsTheErrorEnvelope() =
        runTest {
            val api =
                api {
                    respond(
                        """{"error":{"code":"invalid_request","message":"Invalid request","details":{"body":{"formErrors":["nope"],"fieldErrors":{"title":["Too short"]}}}}}""",
                        HttpStatusCode.BadRequest,
                        jsonHeaders,
                    )
                }
            val e = assertFailsWith<ApiException> { api.tasks.tasksGet("x") }
            assertEquals(400, e.status)
            assertEquals("invalid_request", e.code)
            assertEquals(mapOf("title" to "Too short"), e.fieldErrors)
            assertEquals(listOf("nope"), e.formErrors)
            assertEquals(0, unauthenticated)
        }

    @Test
    fun reportsAnExpiredToken() =
        runTest {
            val api =
                api {
                    respond("""{"error":{"code":"unauthenticated","message":"Sign in"}}""", HttpStatusCode.Unauthorized, jsonHeaders)
                }
            assertFailsWith<ApiException> { api.tasks.tasksGet("x") }
            assertEquals(1, unauthenticated)
        }

    @Test
    fun aLateRefusalOfAnOldTokenDoesNotEndTheNewSession() =
        runTest {
            val api =
                api {
                    // The person signed in again while this request was on its way.
                    currentToken = "hw_new"
                    respond("""{"error":{"code":"unauthenticated","message":"Sign in"}}""", HttpStatusCode.Unauthorized, jsonHeaders)
                }
            assertFailsWith<ApiException> { api.tasks.tasksGet("x") }
            assertEquals(0, unauthenticated)
        }

    @Test
    fun uploadsAndDownloadsGetFiveMinutesAndJsonCallsTheClientsThirty() =
        runTest {
            val seen = mutableMapOf<String, Long?>()
            val http =
                http({ "hw_test" }) { request ->
                    seen[request.url.encodedPath] = request.getCapabilityOrNull(HttpTimeoutCapability)?.requestTimeoutMillis
                    respond("""{"id":"a1"}""", HttpStatusCode.OK, jsonHeaders)
                }
            http.binary("GET", "/download", emptyList())
            http.multipart("/upload", emptyList(), UploadFile("file", "a.pdf", "application/pdf", ByteArray(1)), JsonObject.serializer())
            http.json("GET", "/plain", emptyList(), JsonObject.serializer())
            assertEquals(300_000L, seen["/download"])
            assertEquals(300_000L, seen["/upload"])
            assertEquals(30_000L, seen["/plain"])
        }

    @Test
    fun wrongCredentialsDoNotEndASession() =
        runTest {
            val api =
                api(token = null) {
                    respond("""{"error":{"code":"invalid_credentials","message":"No"}}""", HttpStatusCode.Unauthorized, jsonHeaders)
                }
            val e = assertFailsWith<ApiException> { api.system.health() }
            assertEquals("invalid_credentials", e.code)
            assertEquals(0, unauthenticated)
        }

    @Test
    fun aFailingConnectionIsANetworkError() =
        runTest {
            val api = api { throw IllegalStateException("connection refused") }
            val e = assertFailsWith<ApiException> { api.system.health() }
            assertTrue(e.isNetwork)
        }

    @Test
    fun aBodyThatIsNotTheContractIsAnInvalidResponse() =
        runTest {
            val api = api { respond("<html>", HttpStatusCode.OK) }
            val e = assertFailsWith<ApiException> { api.system.health() }
            assertEquals(ApiException.INVALID_RESPONSE, e.code)
        }

    @Test
    fun patchFieldsAreOmittedSetOrCleared() {
        val json = ApiHttp.JSON
        assertEquals("{}", json.encodeToString(TasksUpdateRequest.serializer(), TasksUpdateRequest()))
        assertEquals(
            """{"title":"A","assetId":null,"roomId":"r1"}""",
            json.encodeToString(
                TasksUpdateRequest.serializer(),
                TasksUpdateRequest(title = "A", assetId = Patch.Set(null), roomId = Patch.of("r1")),
            ),
        )
    }

    @Test
    fun triggersKeepTheirTypeAndVersion() =
        runTest {
            lateinit var body: String
            val api =
                api { request ->
                    body = request.body.toByteArray().decodeToString()
                    respond("{}", HttpStatusCode.BadRequest, jsonHeaders)
                }
            val trigger = Trigger.Interval(every = 2, unit = "week", anchor = "completion", startDate = "2026-01-05")
            assertFailsWith<ApiException> { api.tasks.tasksCreate(TasksCreateRequest(title = "T", trigger = trigger)) }
            assertEquals(
                """{"title":"T","trigger":{"type":"interval","v":1,"every":2,"unit":"week","anchor":"completion","startDate":"2026-01-05"}}""",
                body,
            )
        }

    @Test
    fun anUnknownUnionMemberDecodesAsUnknown() {
        val decoded =
            ApiHttp.JSON.decodeFromString(
                ListSerializer(Trigger.serializer()),
                """[{"type":"interval","v":1,"every":1,"unit":"day","anchor":"schedule","startDate":"2026-01-01","extra":true},{"type":"from_the_future","v":3,"x":1}]""",
            )
        assertIs<Trigger.Interval>(decoded[0])
        assertIs<Trigger.Unknown>(decoded[1])
    }
}
