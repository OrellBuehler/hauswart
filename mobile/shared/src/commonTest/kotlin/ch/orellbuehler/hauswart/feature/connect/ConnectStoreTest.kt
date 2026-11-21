package ch.orellbuehler.hauswart.feature.connect

import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ConnectStoreTest {
    private val server = TestApp()
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    @Test
    fun startsWithTheServerStepUntilOneIsChosen() {
        val store = ConnectStore(app)
        assertEquals("server", store.state.value.step)
        store.close()
    }

    @Test
    fun aMalformedAddressIsRejectedWithoutARequest() =
        runTest {
            val store = ConnectStore(app)
            store.checkServer("not a url")
            assertEquals(tr("m_connect_invalid_url"), store.state.value.error)
            assertTrue(server.requests.isEmpty())
            store.close()
        }

    @Test
    fun anAnsweringServerMovesToTheSignIn() =
        runTest {
            server.on("GET", "/api/v1/health", """{"status":"ok","version":"1.2.3"}""")
            server.on("GET", "/api/v1/setup", """{"needsSetup":true,"tokenRequired":false}""")
            val store = ConnectStore(app)
            store.checkServer("home.example.org")
            val state = store.await { it.step == "login" }
            assertEquals("https://home.example.org", state.serverUrl)
            assertEquals("1.2.3", state.serverVersion)
            assertTrue(state.needsSetup)
            assertFalse(state.busy)
            assertEquals("https://home.example.org", app.session.serverUrl)
            store.close()
        }

    @Test
    fun aServerThatIsNotHauswartIsReported() =
        runTest {
            val store = ConnectStore(app)
            store.checkServer("https://home.example.org")
            val state = store.await { !it.busy && it.error != null }
            assertEquals(tr("m_connect_not_hauswart"), state.error)
            assertEquals("server", state.step)
            assertNull(app.session.serverUrl)
            store.close()
        }

    @Test
    fun anUnreachableServerReportsIt() =
        runTest {
            server.offline = true
            val store = ConnectStore(app)
            store.checkServer("https://home.example.org")
            val state = store.await { !it.busy && it.error != null }
            assertEquals(tr("m_connect_unreachable"), state.error)
            assertEquals("server", state.step)
            store.close()
        }

    @Test
    fun signingInStoresTheSession() =
        runTest {
            app.session.setServer("https://home.example.org")
            server.on(
                "POST",
                "/api/v1/auth/token",
                """{"token":"hw_secret","expiresAt":"2027-01-01T00:00:00.000Z",
                    "user":{"id":"u1","username":"anna","displayName":"Anna","role":"member","locale":"en"}}""",
            )
            val store = ConnectStore(app)
            assertEquals("login", store.state.value.step)

            store.signIn(" anna ", "pw")
            store.await { !it.busy && app.session.user != null }

            val request = server.requestsTo("POST", "/api/v1/auth/token").single().json
            assertEquals("anna", request.getValue("username").jsonPrimitive.content)
            assertEquals("pw", request.getValue("password").jsonPrimitive.content)
            assertEquals("android", request.getValue("platform").jsonPrimitive.content)
            assertTrue(app.session.state.value.signedIn)
            assertEquals("hw_secret", app.session.token)
            assertEquals("en", app.locale)
            store.close()
        }

    @Test
    fun missingCredentialsAreRejectedWithoutARequest() {
        server.app.session.setServer("https://home.example.org")
        val store = ConnectStore(app)
        store.signIn("anna", "")
        assertEquals(tr("m_connect_credentials_required"), store.state.value.error)
        assertTrue(server.requests.isEmpty())
        store.close()
    }

    @Test
    fun wrongCredentialsAreReported() =
        runTest {
            server.app.session.setServer("https://home.example.org")
            server.onError("POST", "/api/v1/auth/token", HttpStatusCode.Unauthorized, "invalid_credentials")
            val store = ConnectStore(app)
            store.signIn("anna", "nope")
            val state = store.await { !it.busy && it.error != null }
            assertEquals(tr("m_error_invalid_credentials"), state.error)
            assertFalse(app.session.state.value.signedIn)
            store.close()
        }
}
