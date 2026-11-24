package ch.orellbuehler.hauswart.android.ui.docs

import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.viewinterop.AndroidView
import ch.orellbuehler.hauswart.feature.docs.DOC_BASE_URL
import ch.orellbuehler.hauswart.feature.docs.docDocument
import android.graphics.Color as AndroidColor

/**
 * A rendered documentation page in a web view with JavaScript off, in the colours of the app.
 * [onLink] gets the address of a tapped link and returns true when it dealt with it; false lets the
 * view follow it (a jump inside the page). Give it a bounded height: it scrolls by itself. [jumpTo] is the
 * address of a heading (see `tocAnchorUrl`); it is loaded again whenever [jumpToken] changes, which scrolls the view.
 */
@Composable
fun DocWebView(
    bodyHtml: String,
    onLink: (String) -> Boolean,
    modifier: Modifier = Modifier,
    jumpTo: String? = null,
    jumpToken: Int = 0,
) {
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val html = remember(bodyHtml, dark) { docDocument(bodyHtml, dark) }
    val handler by rememberUpdatedState(onLink)
    val jumped = remember { intArrayOf(0) }
    AndroidView(
        modifier = modifier,
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = false
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.domStorageEnabled = false
                setBackgroundColor(AndroidColor.TRANSPARENT)
                webViewClient =
                    object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(
                            view: WebView,
                            request: WebResourceRequest,
                        ): Boolean = handler(request.url.toString())
                    }
            }
        },
        update = { view ->
            if (view.tag != html) {
                view.tag = html
                view.loadDataWithBaseURL(DOC_BASE_URL, html, "text/html", "utf-8", null)
            }
            if (jumpTo != null && jumpToken != jumped[0]) {
                jumped[0] = jumpToken
                view.loadUrl(jumpTo)
            }
        },
        onRelease = { it.destroy() },
    )
}
