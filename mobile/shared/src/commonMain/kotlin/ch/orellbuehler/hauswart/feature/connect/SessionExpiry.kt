package ch.orellbuehler.hauswart.feature.connect

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/** From this many days before the device token ends the home screen asks to sign in again. */
const val SESSION_NOTICE_DAYS = 14

/** When the device token ends: the household's calendar day, written out, and the days left (negative once it ended). */
data class SessionExpiry(
    val date: String,
    val dateText: String,
    val daysLeft: Int,
)

/** The expiry of the token that ends at [expiresAt] (a UTC ISO string); null when it is not known. */
fun sessionExpiryOf(
    expiresAt: String?,
    today: String,
    timeZone: String,
): SessionExpiry? {
    val date = expiresAt?.let { Dates.dateOf(it, timeZone) } ?: return null
    return SessionExpiry(date, Dates.format(date), Dates.diffDays(today, date))
}

data class SessionNoticeState(
    /** What the notice says; null while it is not time yet. */
    val message: String? = null,
    val actionLabel: String = "",
    val signingOut: Boolean = false,
)

/**
 * The notice on the home screen that the device token ends soon. The server gives a token that is used
 * its 90 days again, so the store first asks when the token ends now; the notice stays only when that
 * fails or the server is too old to renew. Signing in again takes one password entry, as the server
 * address and the user name are kept.
 */
class SessionNoticeStore(
    private val app: HauswartApp,
) : Store<SessionNoticeState>(SessionNoticeState()) {
    init {
        // Offline or an older server: the end the app already knows stays, and the notice says so.
        launch({}) {
            app.api.auth
                .authMe()
                .tokenExpiresAt
                ?.let { app.session.renewed(it) }
        }
        scope.launch {
            combine(app.session.state, app.household.info) { session, _ -> session.tokenExpiresAt }.collect { show(it) }
        }
    }

    /** Ends the session now (the token is revoked on the server); the app shows the sign-in screen. */
    fun signInAgain() {
        if (current.signingOut) return
        update { it.copy(signingOut = true) }
        launch({ update { it.copy(signingOut = false) } }) {
            app.signOut()
        }
    }

    private fun show(expiresAt: String?) {
        val zone = app.household.timezone
        val expiry = sessionExpiryOf(expiresAt, app.household.today(), zone)
        if (expiry == null || expiry.daysLeft > SESSION_NOTICE_DAYS) {
            update { it.copy(message = null) }
            return
        }
        val key = if (expiry.daysLeft < 0) "m_session_ended_notice" else "m_session_expiring_notice"
        update { it.copy(message = tr(key, "date" to expiry.dateText), actionLabel = tr("m_session_sign_in_again")) }
    }
}
