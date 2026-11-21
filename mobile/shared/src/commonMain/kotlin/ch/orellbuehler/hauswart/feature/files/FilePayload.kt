package ch.orellbuehler.hauswart.feature.files

import kotlin.io.encoding.Base64

/**
 * A downloaded file on its way to the system viewer or the share sheet. The apps write [bytes] to a
 * cache file; Swift reads them as [base64] text instead of copying a byte array element by element.
 */
class FilePayload(
    val name: String,
    val mime: String,
    val bytes: ByteArray,
) {
    val isImage: Boolean get() = isImageMime(mime)

    fun base64(): String = Base64.encode(bytes)
}

/** The bytes of Base64 [text]; empty when it is not valid Base64. */
fun decodeBase64(text: String): ByteArray = runCatching { Base64.decode(text) }.getOrDefault(ByteArray(0))
