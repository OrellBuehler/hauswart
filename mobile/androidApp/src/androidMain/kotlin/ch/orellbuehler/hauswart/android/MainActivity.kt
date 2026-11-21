package ch.orellbuehler.hauswart.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import ch.orellbuehler.hauswart.android.ui.HauswartRoot
import ch.orellbuehler.hauswart.android.ui.nav.PendingLinks
import ch.orellbuehler.hauswart.feature.applink.AppLink

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val application = application as HauswartApplication
        if (savedInstanceState == null) offerLink(intent)
        setContent { HauswartRoot(application.app) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        offerLink(intent)
    }

    override fun onStart() {
        super.onStart()
        (application as HauswartApplication).reminders.sync()
    }

    /** A tap on a reminder brings the link it leads to; the screen that is showing opens it. */
    private fun offerLink(intent: Intent?) {
        val kind = intent?.getStringExtra(EXTRA_LINK_KIND)?.takeIf { it.isNotEmpty() } ?: return
        PendingLinks.offer(AppLink(kind, intent.getStringExtra(EXTRA_LINK_ID)))
        intent.removeExtra(EXTRA_LINK_KIND)
        intent.removeExtra(EXTRA_LINK_ID)
    }

    companion object {
        const val EXTRA_LINK_KIND = "link_kind"
        const val EXTRA_LINK_ID = "link_id"
    }
}
