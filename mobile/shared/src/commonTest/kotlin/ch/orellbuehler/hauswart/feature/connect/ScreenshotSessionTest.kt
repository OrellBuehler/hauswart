package ch.orellbuehler.hauswart.feature.connect

import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.awaitValue
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals

class ScreenshotSessionTest {
    private val server = TestApp()
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun answerSignIn(token: String) {
        server.on(
            "POST",
            "/api/v1/auth/token",
            """{"token":"$token","expiresAt":"2027-01-01T00:00:00.000Z",
                "user":{"id":"u1","username":"demo","displayName":"Anna","role":"admin","locale":"de"}}""",
        )
    }

    @Test
    fun signsInAndShowsTheLanguageAskedFor() =
        runTest {
            answerSignIn("hw_one")
            startScreenshotSession(app, "http://one.example.org", "demo", "pw", "en")
            app.session.state.awaitValue { it.signedIn }

            assertEquals("http://one.example.org", app.session.serverUrl)
            assertEquals("hw_one", app.session.token)
            assertEquals("en", app.locale)
        }

    @Test
    fun aLaunchThatIsSignedInOnlySetsTheLanguage() =
        runTest {
            answerSignIn("hw_one")
            startScreenshotSession(app, "http://one.example.org", "demo", "pw", "en")
            app.session.state.awaitValue { it.signedIn }

            startScreenshotSession(app, "http://one.example.org", "demo", "pw", "de")

            assertEquals("de", app.locale)
            assertEquals(1, server.requestsTo("POST", "/api/v1/auth/token").size)
        }

    @Test
    fun anotherServerReplacesTheSession() =
        runTest {
            answerSignIn("hw_one")
            startScreenshotSession(app, "http://one.example.org", "demo", "pw", "en")
            app.session.state.awaitValue { it.signedIn }

            answerSignIn("hw_two")
            startScreenshotSession(app, "http://two.example.org", "demo", "pw", "de")
            app.session.state.awaitValue { it.signedIn }

            assertEquals("http://two.example.org", app.session.serverUrl)
            assertEquals("hw_two", app.session.token)
        }
}
