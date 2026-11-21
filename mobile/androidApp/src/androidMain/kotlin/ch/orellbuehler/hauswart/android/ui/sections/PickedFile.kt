package ch.orellbuehler.hauswart.android.ui.sections

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import ch.orellbuehler.hauswart.feature.files.MAX_UPLOAD_BYTES
import ch.orellbuehler.hauswart.feature.files.fileMime
import ch.orellbuehler.hauswart.feature.files.isHeicMime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.max

/** A file the person picked or a photo they took; [bytes] is null when it is too large to be read. */
class PickedFile(
    val name: String,
    val mime: String?,
    val bytes: ByteArray?,
)

/**
 * Reads what [uri] points at. A HEIC photo (the server does not take them) is turned into a JPEG
 * here; a file larger than the server takes is not read at all. Null when it cannot be read.
 */
suspend fun Context.readPickedFile(uri: Uri): PickedFile? =
    withContext(Dispatchers.IO) {
        var name = "file"
        var size = -1L
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                cursor.getString(0)?.let { name = it }
                if (!cursor.isNull(1)) size = cursor.getLong(1)
            }
        }
        if (size > MAX_UPLOAD_BYTES) return@withContext PickedFile(name, null, null)
        val mime = fileMime(contentResolver.getType(uri), name)
        val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return@withContext null
        if (bytes.size > MAX_UPLOAD_BYTES) return@withContext PickedFile(name, mime, null)
        if (!isHeicMime(mime, name)) return@withContext PickedFile(name, mime, bytes)
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@withContext PickedFile(name, mime, bytes)
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
        PickedFile(name.replace(Regex("\\.hei[cf]$", RegexOption.IGNORE_CASE), "") + ".jpg", "image/jpeg", out.toByteArray())
    }

/** Decodes [bytes] at no more than [maxSide] pixels on the longer side, so that a large photo does not fill the memory. */
fun decodeSampled(
    bytes: ByteArray,
    maxSide: Int,
): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / sample > maxSide) sample *= 2
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
}
