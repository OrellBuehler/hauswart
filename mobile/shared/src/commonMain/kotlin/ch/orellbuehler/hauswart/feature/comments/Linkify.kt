package ch.orellbuehler.hauswart.feature.comments

/** A stretch of text; [href] is set when it is a web address to open. */
data class TextSegment(
    val text: String,
    val href: String?,
)

private val urlPattern = Regex("https?://[^\\s<>\"]+", RegexOption.IGNORE_CASE)
private val trailingPunctuation = setOf('.', ',', ';', ':', '!', '?', '\'')
private val closers = mapOf(')' to '(', ']' to '[', '}' to '{')

/** Cuts sentence punctuation and unbalanced closing brackets off the end of a matched address. */
private fun trimUrl(raw: String): String {
    var url = raw
    while (url.isNotEmpty()) {
        val last = url.last()
        val opener = closers[last]
        val cut = last in trailingPunctuation || (opener != null && url.count { it == last } > url.count { it == opener })
        if (!cut) break
        url = url.dropLast(1)
    }
    return url
}

/**
 * Splits plain text into text and http(s) link segments, as the web does. The apps render the
 * segments as text and links, so nothing is ever parsed as markup.
 */
fun linkify(text: String): List<TextSegment> {
    val segments = mutableListOf<TextSegment>()
    var last = 0
    for (match in urlPattern.findAll(text)) {
        val url = trimUrl(match.value)
        if (!isWebAddress(url)) continue
        if (match.range.first > last) segments += TextSegment(text.substring(last, match.range.first), null)
        segments += TextSegment(url, url)
        last = match.range.first + url.length
    }
    if (last < text.length) segments += TextSegment(text.substring(last), null)
    return segments
}

private fun isWebAddress(url: String): Boolean = url.substringAfter("://", "").isNotEmpty()
