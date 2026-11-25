package ch.orellbuehler.hauswart.feature.connect

import ch.orellbuehler.hauswart.HauswartApp

/**
 * For the store screenshots (`mobile/scripts/screenshots`), called by debug builds only: shows the
 * app in [locale] and signs in to [serverUrl] without anyone typing. A launch that is already signed
 * in to that server only sets the language; another server replaces the session.
 */
fun startScreenshotSession(
    app: HauswartApp,
    serverUrl: String,
    username: String,
    password: String,
    locale: String,
) {
    app.locale = locale
    if (app.session.state.value.signedIn) {
        if (app.session.serverUrl == serverUrl) return
        app.signedOut()
    }
    app.session.setServer(serverUrl)
    ConnectStore(app).signIn(username, password)
}
