package ch.orellbuehler.hauswart.android.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.i18n.tr

/** A full-width button; while [pending] it is disabled, shows a spinner and [pendingText] instead of [text]. */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    pending: Boolean = false,
    pendingText: String? = null,
    enabled: Boolean = true,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !pending,
        modifier = modifier.fillMaxWidth().heightIn(min = 48.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (pending) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
            }
            Text(if (pending) pendingText ?: text else text, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** The bottom bar of a form screen: one save button. */
@Composable
fun SaveBar(
    onSave: () -> Unit,
    pending: Boolean,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Surface(modifier = modifier, color = MaterialTheme.colorScheme.surfaceContainer) {
        PrimaryButton(
            text = tr("common_save"),
            pendingText = tr("common_saving"),
            onClick = onSave,
            pending = pending,
            enabled = enabled,
            modifier = Modifier.padding(horizontal = ScreenPadding, vertical = 12.dp),
        )
    }
}

@Composable
fun ConfirmDialog(
    title: String,
    text: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    destructive: Boolean = false,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        modifier = modifier,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                colors =
                    if (destructive) {
                        ButtonDefaults.textButtonColors(
                            contentColor = MaterialTheme.colorScheme.error,
                        )
                    } else {
                        ButtonDefaults.textButtonColors()
                    },
            ) { Text(confirmLabel, maxLines = 1) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr("common_cancel"), maxLines = 1) } },
    )
}
