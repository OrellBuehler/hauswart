package ch.orellbuehler.hauswart.feature.settings

import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import ch.orellbuehler.hauswart.testing.awaitValue
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class SettingsStoreTest {
    private val server = TestApp().also { it.signIn() }

    @BeforeTest
    fun german() {
        I18n.locale = "de"
    }

    @AfterTest
    fun tearDown() {
        I18n.locale = "de"
        server.close()
    }

    @Test
    fun showsTheUserTheServerAndItsVersion() =
        runTest {
            server.on("GET", "/api/v1/health", """{"status":"ok","version":"1.2.3"}""")
            val store = SettingsStore(server.app)
            val state = store.await { !it.loading }
            assertEquals("Anna", state.userName)
            assertEquals("https://home.example.org", state.serverUrl)
            assertEquals("1.2.3", state.serverVersion)
            assertEquals(listOf("de", "en"), state.languages.map { it.code })
            store.close()
        }

    @Test
    fun showsUntilWhenTheDeviceStaysSignedIn() =
        runTest {
            server.on("GET", "/api/v1/health", """{"status":"ok","version":"1.2.3"}""")
            val store = SettingsStore(server.app)
            assertEquals(null, store.state.value.signedInUntil)
            store.close()

            server.app.session.signIn("hw_test", server.app.session.user!!, "2027-02-21T09:00:00.000Z")
            val signedIn = SettingsStore(server.app)
            assertEquals("21.02.2027", signedIn.state.value.signedInUntil)
            signedIn.setLanguage("en")
            assertEquals("21 Feb 2027", signedIn.state.value.signedInUntil)
            signedIn.close()
        }

    @Test
    fun choosingALanguageSwitchesTheApp() =
        runTest {
            server.on("GET", "/api/v1/health", """{"status":"ok","version":"1.2.3"}""")
            val store = SettingsStore(server.app)
            store.setLanguage("en")
            assertEquals("en", server.app.locale)
            assertEquals("en", store.state.value.language)
            assertEquals(
                "English",
                store.state.value.languages
                    .last()
                    .label,
            )
            store.close()
        }

    @Test
    fun signingOutRevokesTheTokenAndForgetsTheSession() =
        runTest {
            server.on("GET", "/api/v1/health", """{"status":"ok","version":"1.2.3"}""")
            server.on("DELETE", "/api/v1/auth/token", "", HttpStatusCode.NoContent)
            val store = SettingsStore(server.app)
            store.signOut()
            server.app.session.state
                .awaitValue { !it.signedIn }
            assertFalse(server.app.session.state.value.signedIn)
            assertEquals(1, server.requestsTo("DELETE", "/api/v1/auth/token").size)
            store.close()
        }
}
