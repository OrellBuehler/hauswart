package ch.orellbuehler.hauswart.android.ui.sections

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ch.orellbuehler.hauswart.feature.files.FilePayload
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The largest side an image is decoded at: enough for a phone screen when zoomed in, light on memory. */
private const val MAX_SIDE = 2560
private const val MAX_ZOOM = 6f
private const val DOUBLE_TAP_ZOOM = 2.5f

/**
 * An image full screen: pinch to zoom, drag to move when zoomed, double tap to switch between fit
 * and zoomed. [onShare] hands the file to the share sheet.
 */
@Composable
fun ImageViewer(
    file: FilePayload,
    onShare: () -> Unit,
    onDismiss: () -> Unit,
) {
    val bitmap by produceState<ImageBitmap?>(null, file) {
        value = withContext(Dispatchers.Default) { decodeSampled(file.bytes, MAX_SIDE)?.asImageBitmap() }
    }
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            val image = bitmap
            if (image == null) {
                CircularProgressIndicator(Modifier.align(Alignment.Center))
            } else {
                Image(
                    bitmap = image,
                    contentDescription = file.name,
                    contentScale = ContentScale.Fit,
                    modifier =
                        Modifier
                            .fillMaxSize()
                            .pointerInput(Unit) {
                                detectTransformGestures { _, pan, zoom, _ ->
                                    scale = (scale * zoom).coerceIn(1f, MAX_ZOOM)
                                    offset = if (scale > 1f) offset + pan else Offset.Zero
                                }
                            }.pointerInput(Unit) {
                                detectTapGestures(onDoubleTap = {
                                    scale = if (scale > 1f) 1f else DOUBLE_TAP_ZOOM
                                    offset = Offset.Zero
                                })
                            }.graphicsLayer(scaleX = scale, scaleY = scale, translationX = offset.x, translationY = offset.y),
                )
            }
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onDismiss, colors = IconButtonDefaults.iconButtonColors(contentColor = Color.White)) {
                    Icon(Icons.Outlined.Close, contentDescription = tr("m_attach_viewer_close"))
                }
                Text(
                    file.name,
                    modifier = Modifier.weight(1f),
                    color = Color.White,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                )
                IconButton(onClick = onShare, colors = IconButtonDefaults.iconButtonColors(contentColor = Color.White)) {
                    Icon(Icons.Outlined.Share, contentDescription = tr("attach_download"))
                }
            }
        }
    }
}
