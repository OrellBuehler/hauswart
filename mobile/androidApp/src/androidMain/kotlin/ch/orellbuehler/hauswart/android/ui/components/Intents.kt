package ch.orellbuehler.hauswart.android.ui.components

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/** Hands [uri] (`tel:`, `mailto:`, `geo:`, `https:`) to the app that handles it; false when there is none. */
fun Context.openUri(uri: String): Boolean =
    try {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (_: ActivityNotFoundException) {
        false
    }

@Composable
fun rememberUriOpener(): (String) -> Boolean {
    val context = LocalContext.current
    return remember(context) { { uri: String -> context.openUri(uri) } }
}
