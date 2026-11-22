package ch.orellbuehler.hauswart.android.ui.connect

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.PrimaryButton
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.connect.ConnectStore
import ch.orellbuehler.hauswart.i18n.tr

/** Shown while nobody is signed in: choose the server, then sign in. */
@Composable
fun ConnectScreen() {
    val store = rememberStore { ConnectStore(it) }
    val state = store.collect()
    var server by remember { mutableStateOf(state.serverUrl) }
    var username by remember { mutableStateOf(state.username) }
    var password by remember { mutableStateOf("") }

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            Modifier
                .safeDrawingPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(ScreenPadding),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Spacer(Modifier.height(32.dp))
            Text(tr("app_name"), style = MaterialTheme.typography.displaySmall)
            Text(tr("app_tagline"), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(8.dp))
            if (state.step == "server") {
                Text(tr("m_connect_title"), style = MaterialTheme.typography.titleLarge)
                Text(tr("m_connect_explain"), style = MaterialTheme.typography.bodyMedium)
                TextField(
                    label = tr("m_connect_server_label"),
                    value = server,
                    onChange = { server = it },
                    keyboardType = KeyboardType.Uri,
                    imeAction = ImeAction.Go,
                    onImeAction = { store.checkServer(server) },
                    enabled = !state.busy,
                )
                state.error?.let { InlineError(it) }
                PrimaryButton(
                    text = tr("m_connect_continue"),
                    pendingText = tr("m_connect_checking"),
                    pending = state.busy,
                    onClick = { store.checkServer(server) },
                )
            } else {
                Text(tr("auth_login_title"), style = MaterialTheme.typography.titleLarge)
                SectionCard {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                tr("m_connect_server"),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(state.serverUrl, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        TextButton(onClick = { store.changeServer() }, enabled = !state.busy) {
                            Text(tr("m_connect_change_server"), maxLines = 1)
                        }
                    }
                }
                if (state.needsSetup) {
                    Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.tertiaryContainer) {
                        Text(
                            tr("m_connect_setup_needed"),
                            modifier = Modifier.padding(12.dp),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onTertiaryContainer,
                        )
                    }
                }
                TextField(
                    label = tr("auth_username"),
                    value = username,
                    onChange = { username = it },
                    keyboardType = KeyboardType.Email,
                    enabled = !state.busy,
                )
                TextField(
                    label = tr("auth_password"),
                    value = password,
                    onChange = { password = it },
                    secret = true,
                    imeAction = ImeAction.Go,
                    onImeAction = { store.signIn(username, password) },
                    enabled = !state.busy,
                )
                state.error?.let { InlineError(it) }
                PrimaryButton(
                    text = tr("auth_login_submit"),
                    pendingText = tr("auth_login_pending"),
                    pending = state.busy,
                    onClick = { store.signIn(username, password) },
                )
            }
        }
    }
}
