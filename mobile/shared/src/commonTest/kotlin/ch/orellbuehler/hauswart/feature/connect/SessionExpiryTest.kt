package ch.orellbuehler.hauswart.feature.connect

import ch.orellbuehler.hauswart.api.generated.User
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr
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
import kotlin.test.assertNull

class SessionExpiryTest {
    private val server = TestApp()
    private val app = server.app

    @BeforeTest
    fun german() {
        I18n.locale = "de"
    }

    @AfterTest
    fun tearDown() {
        server.close()
        I18n.locale = "de"
    }

    private val user = User(id = "u1", username = "anna", displayName = "Anna", role = "member", locale = "de")

    private fun endsInDays(days: Int): String = Dates.addDays(Dates.today("Europe/Zurich"), days) + "T12:00:00.000Z"

    @Test
    fun theExpiryIsADayOfTheHouseholdAndTheDaysLeft() {
        val cases =
            listOf(
                Triple("2026-12-24T09:00:00.000Z", "2026-11-21", 33),
                Triple("2026-11-21T22:30:00.000Z", "2026-11-21", 0),
                Triple("2026-11-21T23:30:00.000Z", "2026-11-21", 1),
                Triple("2026-11-20T12:00:00.000Z", "2026-11-21", -1),
            )
        cases.forEach { (expiresAt, today, days) ->
            val expiry = sessionExpiryOf(expiresAt, today, "Europe/Zurich")
            assertEquals(days, expiry?.daysLeft, expiresAt)
        }
        assertEquals("24.12.2026", sessionExpiryOf("2026-12-24T09:00:00.000Z", "2026-11-21", "Europe/Zurich")?.dateText)
        assertNull(sessionExpiryOf(null, "2026-11-21", "Europe/Zurich"))
        assertNull(sessionExpiryOf("soon", "2026-11-21", "Europe/Zurich"))
    }

    @Test
    fun theNoticeAppearsFourteenDaysBeforeTheEnd() =
        runTest {
            server.household()
            app.session.setServer("https://home.example.org")
            app.session.signIn("hw_test", user, endsInDays(30))
            app.household.get()
            val store = SessionNoticeStore(app)
            store.await { true }
            assertNull(store.value.message)

            app.session.signIn("hw_test", user, endsInDays(SESSION_NOTICE_DAYS))
            val state = store.await { it.message != null }
            val date = Dates.format(Dates.addDays(Dates.today("Europe/Zurich"), SESSION_NOTICE_DAYS))
            assertEquals(tr("m_session_expiring_notice", "date" to date), state.message)
            assertEquals(tr("m_session_sign_in_again"), state.actionLabel)
            store.close()
        }

    @Test
    fun theEndTheServerReportsReplacesTheStoredOneAndTheNoticeGoes() =
        runTest {
            server.household()
            val renewed = endsInDays(90)
            server.on(
                "GET",
                "/api/v1/auth/me",
                """{"user":{"id":"u1","username":"anna","displayName":"Anna","role":"member","locale":"de"},
                    "auth":"token","scopes":["read"],"tokenExpiresAt":"$renewed"}""",
            )
            app.session.setServer("https://home.example.org")
            app.session.signIn("hw_test", user, endsInDays(3))
            app.household.get()
            val store = SessionNoticeStore(app)
            app.session.state.awaitValue { it.tokenExpiresAt == renewed }
            store.await { it.message == null }
            assertNull(store.value.message)
            store.close()
        }

    @Test
    fun withoutAKnownEndThereIsNoNotice() =
        runTest {
            server.household()
            app.session.setServer("https://home.example.org")
            app.session.signIn("hw_test", user)
            app.household.get()
            val store = SessionNoticeStore(app)
            store.await { true }
            assertNull(store.value.message)
            store.close()
        }

    @Test
    fun signingInAgainRevokesTheTokenAndKeepsServerAndUserName() =
        runTest {
            server.household()
            server.on("DELETE", "/api/v1/auth/token", "", HttpStatusCode.NoContent)
            app.session.setServer("https://home.example.org")
            app.session.signIn("hw_test", user, endsInDays(3))
            app.household.get()
            val store = SessionNoticeStore(app)
            store.await { it.message != null }
            store.signInAgain()
            app.session.state.awaitValue { !it.signedIn }
            assertFalse(app.session.state.value.signedIn)
            assertEquals("https://home.example.org", app.session.serverUrl)
            assertEquals("anna", app.session.lastUsername)
            store.close()
        }
}
