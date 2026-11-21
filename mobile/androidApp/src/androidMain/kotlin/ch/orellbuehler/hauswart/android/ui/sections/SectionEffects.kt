package ch.orellbuehler.hauswart.android.ui.sections

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember

/**
 * Runs [block] when [value] changes after the first composition. A store that outlives a rotation
 * still holds the outcome of an earlier action (a counter that went up); this reacts only to a new one.
 */
@Composable
fun <T> OnValueChange(
    value: T,
    block: (T) -> Unit,
) {
    val seen = remember { mutableStateOf(value) }
    LaunchedEffect(value) {
        if (seen.value != value) {
            seen.value = value
            block(value)
        }
    }
}
