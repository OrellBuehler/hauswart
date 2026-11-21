package ch.orellbuehler.hauswart.feature.files

import kotlin.math.floor

/** What an upload accepts, as on the web: JPEG, PNG, WebP and PDF. */
val UPLOAD_MIME_TYPES: List<String> = listOf("image/jpeg", "image/png", "image/webp", "application/pdf")

/** The largest file the server takes (25 MiB). */
const val MAX_UPLOAD_BYTES: Long = 25L * 1024 * 1024

private val typesByExtension =
    mapOf(
        "jpg" to "image/jpeg",
        "jpeg" to "image/jpeg",
        "png" to "image/png",
        "webp" to "image/webp",
        "pdf" to "application/pdf",
        "heic" to "image/heic",
        "heif" to "image/heif",
    )

private val extensionsByType =
    mapOf(
        "image/jpeg" to "jpg",
        "image/png" to "png",
        "image/webp" to "webp",
        "application/pdf" to "pdf",
        "text/plain" to "txt",
    )

fun isImageMime(mime: String): Boolean = mime.lowercase().startsWith("image/")

fun isPdfMime(mime: String): Boolean = mime.lowercase() == "application/pdf"

fun isHeicMime(
    mime: String,
    name: String,
): Boolean =
    Regex("^image/hei[cf]", RegexOption.IGNORE_CASE).containsMatchIn(mime) ||
        Regex("\\.hei[cf]$", RegexOption.IGNORE_CASE).containsMatchIn(name)

/** The type a picker reported, or when it reported none the one the extension of [name] says; empty when unknown. */
fun fileMime(
    mime: String?,
    name: String,
): String {
    val given =
        mime
            ?.trim()
            ?.lowercase()
            ?.substringBefore(';')
            .orEmpty()
    if (given.isNotEmpty() && given != "application/octet-stream") return given
    val extension = name.substringAfterLast('.', "").lowercase()
    return typesByExtension[extension] ?: given
}

/** 1536 -> "1.5 KB". */
fun formatBytes(bytes: Long): String {
    val units = listOf("B", "KB", "MB", "GB")
    var value = bytes.toDouble()
    var unit = 0
    while (value >= 1024 && unit < units.lastIndex) {
        value /= 1024
        unit++
    }
    val text =
        if (unit == 0) {
            value.toLong().toString()
        } else {
            val tenths = floor(value * 10 + 0.5).toLong()
            if (tenths % 10 == 0L) (tenths / 10).toString() else "${tenths / 10}.${tenths % 10}"
        }
    return "$text ${units[unit]}"
}

/** A file name for [title] with the extension of [mime], without characters a file system dislikes. */
fun fileNameFor(
    title: String,
    mime: String,
): String {
    val base =
        title
            .map { if (it.isLetterOrDigit() || it in " ._-()") it else '_' }
            .joinToString("")
            .trim()
            .trim('.')
            .take(80)
            .ifEmpty { "file" }
    val extension = extensionsByType[mime.lowercase().substringBefore(';')] ?: return base
    return if (base.lowercase().endsWith(".$extension")) base else "$base.$extension"
}
