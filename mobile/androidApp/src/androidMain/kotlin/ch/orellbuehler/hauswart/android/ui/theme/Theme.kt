package ch.orellbuehler.hauswart.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

// The web app's palette (src/app.css): a neutral slate, primary near black, the teal brand colour as tertiary.
private val Light =
    lightColorScheme(
        primary = Color(0xFF151923),
        onPrimary = Color(0xFFFAFAFA),
        primaryContainer = Color(0xFFE3E6EC),
        onPrimaryContainer = Color(0xFF151923),
        secondary = Color(0xFF4A5060),
        onSecondary = Color(0xFFFFFFFF),
        secondaryContainer = Color(0xFFEEF0F3),
        onSecondaryContainer = Color(0xFF151923),
        tertiary = Color(0xFF107F6D),
        onTertiary = Color(0xFFFFFFFF),
        tertiaryContainer = Color(0xFFD5EDE4),
        onTertiaryContainer = Color(0xFF0E3B2F),
        background = Color(0xFFFAFBFC),
        onBackground = Color(0xFF131720),
        surface = Color(0xFFFAFBFC),
        onSurface = Color(0xFF131720),
        surfaceVariant = Color(0xFFEEF0F3),
        onSurfaceVariant = Color(0xFF5D626F),
        surfaceContainerLowest = Color(0xFFFFFFFF),
        surfaceContainerLow = Color(0xFFF6F7F9),
        surfaceContainer = Color(0xFFF1F2F5),
        surfaceContainerHigh = Color(0xFFEBEDF1),
        surfaceContainerHighest = Color(0xFFE4E7EC),
        outline = Color(0xFFB9BEC8),
        outlineVariant = Color(0xFFE2E5EA),
        error = Color(0xFFB81E1E),
        onError = Color(0xFFFFFFFF),
        errorContainer = Color(0xFFFBE3E3),
        onErrorContainer = Color(0xFF7A1010),
    )

private val Dark =
    darkColorScheme(
        primary = Color(0xFFF3F4F6),
        onPrimary = Color(0xFF14161B),
        primaryContainer = Color(0xFF2A2D36),
        onPrimaryContainer = Color(0xFFF3F4F6),
        secondary = Color(0xFFB7BBC6),
        onSecondary = Color(0xFF14161B),
        secondaryContainer = Color(0xFF272A32),
        onSecondaryContainer = Color(0xFFF3F4F6),
        tertiary = Color(0xFF26D9B5),
        onTertiary = Color(0xFF07382C),
        tertiaryContainer = Color(0xFF1C4A3D),
        onTertiaryContainer = Color(0xFFCDEEE3),
        background = Color(0xFF0E0F13),
        onBackground = Color(0xFFF3F4F6),
        surface = Color(0xFF0E0F13),
        onSurface = Color(0xFFF3F4F6),
        surfaceVariant = Color(0xFF23252B),
        onSurfaceVariant = Color(0xFFA3A7B1),
        surfaceContainerLowest = Color(0xFF0A0B0E),
        surfaceContainerLow = Color(0xFF15161B),
        surfaceContainer = Color(0xFF191B20),
        surfaceContainerHigh = Color(0xFF22242A),
        surfaceContainerHighest = Color(0xFF2B2D34),
        outline = Color(0xFF4A4D57),
        outlineVariant = Color(0xFF2B2D34),
        error = Color(0xFFF08A8A),
        onError = Color(0xFF4A0C0C),
        errorContainer = Color(0xFF5E1717),
        onErrorContainer = Color(0xFFFBDCDC),
    )

private val HauswartShapes =
    Shapes(
        extraSmall = RoundedCornerShape(6.dp),
        small = RoundedCornerShape(8.dp),
        medium = RoundedCornerShape(10.dp),
        large = RoundedCornerShape(14.dp),
        extraLarge = RoundedCornerShape(20.dp),
    )

/** Colours that carry a meaning the Material scheme has no slot for. */
object StatusColors {
    val overdue: Color @Composable get() = MaterialTheme.colorScheme.error
    val due: Color @Composable get() = if (isSystemInDarkTheme()) Color(0xFFF2B766) else Color(0xFFB26A00)
    val ok: Color @Composable get() = MaterialTheme.colorScheme.tertiary
    val muted: Color @Composable get() = MaterialTheme.colorScheme.onSurfaceVariant
}

@Composable
fun HauswartTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) Dark else Light,
        shapes = HauswartShapes,
        content = content,
    )
}
