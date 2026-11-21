package ch.orellbuehler.hauswart.android.ui.sections

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import ch.orellbuehler.hauswart.feature.files.FilePayload
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** The authority of the app's file provider (see the manifest). */
private fun Context.authority() = "$packageName.files"

/** A file name that is safe on a file system. */
private fun safeName(name: String): String =
    name
        .map {
            if (it == '/' ||
                it == '\\' ||
                it == ':' ||
                it.code < 32
            ) {
                '_'
            } else {
                it
            }
        }.joinToString("")
        .ifBlank { "file" }

/** Writes [file] to the cache (replacing what an earlier open left there) and returns the address other apps may read it at. */
suspend fun Context.cacheFileUri(file: FilePayload): Uri =
    withContext(Dispatchers.IO) {
        val dir = File(cacheDir, "shared").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val target = File(dir, safeName(file.name))
        target.writeBytes(file.bytes)
        FileProvider.getUriForFile(this@cacheFileUri, authority(), target)
    }

/** Shows [file] in the app the system picks for its type; false when there is none. */
suspend fun Context.viewFile(file: FilePayload): Boolean {
    val uri = cacheFileUri(file)
    val intent =
        Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, file.mime.ifEmpty { "*/*" })
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    return try {
        startActivity(intent)
        true
    } catch (_: ActivityNotFoundException) {
        false
    }
}

/** Hands [file] to the share sheet. */
suspend fun Context.shareFile(file: FilePayload): Boolean {
    val uri = cacheFileUri(file)
    val send =
        Intent(Intent.ACTION_SEND)
            .setType(file.mime.ifEmpty { "*/*" })
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    return try {
        startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (_: ActivityNotFoundException) {
        false
    }
}

/** A new empty file in the cache for the camera app to write a photo to, and the address it is given. */
fun Context.newCaptureTarget(): Pair<File, Uri> {
    val dir = File(cacheDir, "captures").apply { mkdirs() }
    dir.listFiles()?.forEach { it.delete() }
    val file = File(dir, "photo-${System.currentTimeMillis()}.jpg")
    return file to FileProvider.getUriForFile(this, authority(), file)
}
