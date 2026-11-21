package ch.orellbuehler.hauswart.core

import ch.orellbuehler.hauswart.api.ApiException
import ch.orellbuehler.hauswart.testing.TestApp
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HouseholdTest {
    private val server = TestApp().also { it.signIn() }

    @AfterTest
    fun tearDown() = server.close()

    @Test
    fun membersCarryTheirShareOfSharedCosts() =
        runTest {
            server.household()
            val member =
                server.app.household
                    .get()
                    .members
                    .single()
            assertEquals("Anna", member.name)
            assertEquals(10000L, member.ownershipBps)
        }

    @Test
    fun anErrorCarriesTheDetailsOfTheResponse() =
        runTest {
            server.onError(
                "GET",
                "/api/v1/household",
                HttpStatusCode.BadRequest,
                "invalid_request",
                details = """{"code":"lower_than_previous","reading":{"value":50000}}""",
            )
            val failure =
                assertFailsWith<ApiException> {
                    server.app.api.household
                        .householdGet()
                }
            val error = uiErrorOf(failure)
            assertEquals("lower_than_previous", error.detailCode)
            assertEquals("lower_than_previous", (error.details as JsonObject)["code"]!!.jsonPrimitive.content)
        }

    @Test
    fun anErrorWithoutAResponseHasNoDetails() {
        assertNull(uiErrorOf(IllegalStateException("boom")).details)
        assertTrue(uiErrorOf(IllegalStateException("boom")).fields.isEmpty())
    }
}
