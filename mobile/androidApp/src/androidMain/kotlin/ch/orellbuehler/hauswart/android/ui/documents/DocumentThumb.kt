package ch.orellbuehler.hauswart.android.ui.documents

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.sections.decodeSampled
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The first page of a document as a small picture; [request] asks for it once, [bytes] reads what arrived ([version] changes when it did). */
@Composable
internal fun DocumentThumb(
    version: Int,
    request: () -> Unit,
    bytes: () -> ByteArray?,
    width: Dp = 36.dp,
    height: Dp = 48.dp,
) {
    LaunchedEffect(Unit) { request() }
    val data = bytes()
    val bitmap by produceState<ImageBitmap?>(null, data, version) {
        value = data?.let { d -> withContext(Dispatchers.Default) { decodeSampled(d, 256)?.asImageBitmap() } }
    }
    Box(
        Modifier.size(width = width, height = height).clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        val image = bitmap
        if (image != null) {
            Image(image, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth())
        } else {
            Icon(Icons.Outlined.Description, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
