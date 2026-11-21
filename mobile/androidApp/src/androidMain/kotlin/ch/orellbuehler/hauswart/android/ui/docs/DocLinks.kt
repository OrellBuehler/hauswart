package ch.orellbuehler.hauswart.android.ui.docs

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.components.openUri
import ch.orellbuehler.hauswart.android.ui.nav.open
import ch.orellbuehler.hauswart.feature.docs.DOC_LINK_ANCHOR
import ch.orellbuehler.hauswart.feature.docs.DOC_LINK_APP
import ch.orellbuehler.hauswart.feature.docs.DOC_LINK_ATTACHMENT
import ch.orellbuehler.hauswart.feature.docs.DOC_LINK_EXTERNAL
import ch.orellbuehler.hauswart.feature.docs.DocLinkTarget

/**
 * What a tap on a link of a rendered page does: a page or device of the app opens in the app, a file
 * is fetched and shown, an external address goes to the browser, mail or phone app. Returns the
 * handler for [DocWebView]: true when the tap was dealt with.
 */
@Composable
internal fun rememberDocLinkHandler(
    nav: NavController,
    classify: (String) -> DocLinkTarget,
    onAttachment: (String) -> Unit,
    onCannotOpen: () -> Unit,
): (String) -> Boolean {
    val context = LocalContext.current
    return remember(nav, context, classify, onAttachment, onCannotOpen) {
        { url: String ->
            val target = classify(url)
            when (target.kind) {
                DOC_LINK_ANCHOR -> false
                DOC_LINK_ATTACHMENT -> {
                    onAttachment(target.value)
                    true
                }
                DOC_LINK_APP -> {
                    val link = target.link
                    if (link == null || !nav.open(link)) onCannotOpen()
                    true
                }
                DOC_LINK_EXTERNAL -> {
                    if (!context.openUri(target.value)) onCannotOpen()
                    true
                }
                else -> {
                    onCannotOpen()
                    true
                }
            }
        }
    }
}
