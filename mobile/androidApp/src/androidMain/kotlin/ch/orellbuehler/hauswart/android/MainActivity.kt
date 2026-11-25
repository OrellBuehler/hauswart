package ch.orellbuehler.hauswart.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import ch.orellbuehler.hauswart.android.ui.HauswartRoot
import ch.orellbuehler.hauswart.android.ui.nav.PendingLinks
import ch.orellbuehler.hauswart.feature.applink.AppLink
import ch.orellbuehler.hauswart.feature.applink.routeForUrl
import ch.orellbuehler.hauswart.feature.connect.startScreenshotSession

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val application = application as HauswartApplication
        if (savedInstanceState == null) {
            startScreenshots(intent)
            offerLink(intent)
        }
        setContent { HauswartRoot(application.app) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        offerLink(intent)
    }

    override fun onStart() {
        super.onStart()
        val reminders = (application as HauswartApplication).reminders
        reminders.foreground = true
        reminders.sync()
    }

    override fun onStop() {
        (application as HauswartApplication).reminders.foreground = false
        super.onStop()
    }

    /** A tap on a reminder brings the link it leads to; the screen that is showing opens it. */
    private fun offerLink(intent: Intent?) {
        val kind = intent?.getStringExtra(EXTRA_LINK_KIND)?.takeIf { it.isNotEmpty() } ?: return
        PendingLinks.offer(AppLink(kind, intent.getStringExtra(EXTRA_LINK_ID)))
        intent.removeExtra(EXTRA_LINK_KIND)
        intent.removeExtra(EXTRA_LINK_ID)
    }

    /**
     * The store screenshots (`mobile/scripts/screenshots`): a debug build that is started with these
     * extras signs in to the server they name and opens the address of the web app given as link.
     */
    private fun startScreenshots(intent: Intent?) {
        if (!BuildConfig.DEBUG) return
        val server = intent?.getStringExtra("screenshot_server") ?: return
        startScreenshotSession(
            app = (application as HauswartApplication).app,
            serverUrl = server,
            username = intent.getStringExtra("screenshot_username").orEmpty(),
            password = intent.getStringExtra("screenshot_password").orEmpty(),
            locale = intent.getStringExtra("screenshot_locale") ?: "en",
        )
        routeForUrl(intent.getStringExtra("screenshot_link"))?.let { PendingLinks.offer(it) }
    }

    companion object {
        const val EXTRA_LINK_KIND = "link_kind"
        const val EXTRA_LINK_ID = "link_id"
    }
}
