package ch.orellbuehler.hauswart.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.RowIcon
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.rememberUriOpener
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OK
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OVERDUE
import ch.orellbuehler.hauswart.feature.settings.IntegrationOutcome
import ch.orellbuehler.hauswart.i18n.tr

/** A row that hands [url] to the system browser: what a device token cannot do stays in the web app. */
@Composable
fun OpenInBrowserRow(
    title: String,
    url: String,
) {
    val open = rememberUriOpener()
    ListRow(
        title = title,
        subtitle = tr("m_settings_open_browser"),
        trailing = { RowIcon(Icons.AutoMirrored.Outlined.OpenInNew) },
        onClick = { open(url) },
    )
}

/** The answer of a test or a sync: a chip with the result and its detail lines. */
@Composable
fun OutcomeBox(
    outcome: IntegrationOutcome,
    modifier: Modifier = Modifier,
) {
    Column(modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        StatusChip(
            text = outcome.title,
            tone = if (outcome.ok) TONE_OK else TONE_OVERDUE,
            icon = if (outcome.ok) Icons.Outlined.CheckCircle else Icons.Outlined.ErrorOutline,
        )
        outcome.lines.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
}
