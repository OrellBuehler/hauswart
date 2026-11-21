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
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.builtins.ListSerializer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ApiHttpTest {
    private val jsonHeaders = headersOf(HttpHeaders.ContentType, "application/json")
    private var unauthenticated = 0

    private fun api(
        token: String? = "hw_test",
        handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData,
    ): HauswartApi =
        HauswartApi(
            ApiHttp(HttpClient(MockEngine(handler)), { "https://home.example.org/" }, { token }, { unauthenticated++ }),
        )

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
