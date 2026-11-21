package ch.orellbuehler.hauswart.android.ui.vehicles

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.components.LabeledValue
import ch.orellbuehler.hauswart.feature.vehicles.SparkPoint
import ch.orellbuehler.hauswart.feature.vehicles.VehicleChoice
import ch.orellbuehler.hauswart.feature.vehicles.VehicleFact

internal fun List<VehicleChoice>.pairs(): List<Pair<String, String>> = map { it.value to it.label }

/** Shows [message] as a snackbar and tells the store it was shown. */
@Composable
internal fun MessageEffect(
    message: String?,
    snackbar: SnackbarHostState,
    onShown: () -> Unit,
) {
    LaunchedEffect(message) {
        if (message != null) {
            snackbar.showSnackbar(message)
            onShown()
        }
    }
}

/** A line drawing of a trend; draws nothing for fewer than two points. */
@Composable
internal fun Sparkline(
    points: List<SparkPoint>,
    modifier: Modifier = Modifier,
) {
    if (points.size < 2) return
    val color = MaterialTheme.colorScheme.primary
    val track = MaterialTheme.colorScheme.surfaceContainerHighest
    Canvas(modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(8.dp))) {
        drawRect(track.copy(alpha = 0.4f))
        val pad = 6.dp.toPx()
        val w = size.width - 2 * pad
        val h = size.height - 2 * pad
        val path = Path()
        points.forEachIndexed { i, p ->
            val x = pad + (w * p.x).toFloat()
            val y = pad + (h * p.y).toFloat()
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        drawPath(path, color, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round))
        val last = points.last()
        drawCircle(color, radius = 3.dp.toPx(), center = Offset(pad + (w * last.x).toFloat(), pad + (h * last.y).toFloat()))
    }
}

/** Label and value rows of a card; a warning is shown in the error colour, a note under the value. */
@Composable
internal fun FactRows(facts: List<VehicleFact>) {
    facts.forEach { fact ->
        Column {
            LabeledValue(fact.label, fact.value)
            fact.note?.let {
                Text(
                    it,
                    Modifier.padding(start = 144.dp, end = 16.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = if (fact.warning) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
