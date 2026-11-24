package ch.orellbuehler.hauswart.android.ui.connect

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.connect.SessionNoticeStore

/**
 * Tells that the sign-in of this device ends soon, with a button that signs out to the sign-in
 * screen (server address and user name are kept, so it takes one password entry). Shows nothing
 * until it is time: place it once on the home screen.
 */
@Composable
fun SessionExpiryNotice(modifier: Modifier = Modifier) {
    val store = rememberStore { SessionNoticeStore(it) }
    val state = store.collect()
    val message = state.message ?: return
    Surface(modifier, shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.secondaryContainer) {
        Column(Modifier.padding(start = 12.dp, end = 4.dp, top = 12.dp, bottom = 4.dp)) {
            Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSecondaryContainer)
            TextButton(onClick = store::signInAgain, enabled = !state.signingOut) { Text(state.actionLabel, maxLines = 1) }
        }
    }
}
