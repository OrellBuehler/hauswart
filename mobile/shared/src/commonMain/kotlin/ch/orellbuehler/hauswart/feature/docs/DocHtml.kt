package ch.orellbuehler.hauswart.feature.docs

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.ApiException
import ch.orellbuehler.hauswart.feature.applink.AppLink
import ch.orellbuehler.hauswart.feature.applink.routeForUrl
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlin.io.encoding.Base64

/**
 * The address the web views load a page at. Links inside the page resolve against it, so a tap on
 * `/docs/boiler` arrives as `https://app.hauswart.invalid/docs/boiler` and [classifyDocLink] maps it to
 * a screen of the app. The host never resolves.
 */
const val DOC_BASE_URL = "https://app.hauswart.invalid/"

const val DOC_LINK_APP = "app"
const val DOC_LINK_ATTACHMENT = "attachment"
const val DOC_LINK_EXTERNAL = "external"
const val DOC_LINK_ANCHOR = "anchor"
const val DOC_LINK_UNSUPPORTED = "unsupported"

/**
 * What a tap on a link of a rendered page does: [DOC_LINK_APP] opens [link] in the app,
 * [DOC_LINK_ATTACHMENT] fetches the file with the id [value] and shows it, [DOC_LINK_EXTERNAL] hands
 * [value] to the system (browser, mail, phone), [DOC_LINK_ANCHOR] stays in the web view and
 * [DOC_LINK_UNSUPPORTED] is something the app does not follow.
 */
data class DocLinkTarget(
    val kind: String,
    val value: String,
    val link: AppLink?,
)

private val attachmentPath = Regex("^/api/v1/attachments/([A-Za-z0-9_-]+)/content(?:\\?.*)?$")
private val externalSchemes = setOf("http", "https", "mailto", "tel")

private fun unsupported(url: String) = DocLinkTarget(DOC_LINK_UNSUPPORTED, url, null)

private fun pathTarget(
    path: String,
    url: String,
): DocLinkTarget {
    attachmentPath.matchEntire(path)?.let { return DocLinkTarget(DOC_LINK_ATTACHMENT, it.groupValues[1], null) }
    val link = routeForUrl(path) ?: return unsupported(url)
    return DocLinkTarget(DOC_LINK_APP, url, link)
}

/**
 * Sorts a link of a rendered page. [serverUrl] is the address of the signed-in server: a link a
 * person pasted with the full address of the app is followed like a path.
 */
fun classifyDocLink(
    url: String,
    serverUrl: String?,
): DocLinkTarget {
    val text = url.trim()
    if (text.startsWith("#")) return DocLinkTarget(DOC_LINK_ANCHOR, text, null)
    if (text.startsWith(DOC_BASE_URL)) {
        val rest = text.removePrefix(DOC_BASE_URL)
        if (rest.isEmpty() || rest.startsWith("#")) return DocLinkTarget(DOC_LINK_ANCHOR, text, null)
        return pathTarget("/$rest", text)
    }
    val server = serverUrl?.trimEnd('/')
    if (server != null && server.isNotEmpty() && text.startsWith("$server/")) {
        return pathTarget(text.removePrefix(server), text)
    }
    val scheme = text.substringBefore(':', "").lowercase()
    if (scheme in externalSchemes && text.length > scheme.length + 1) return DocLinkTarget(DOC_LINK_EXTERNAL, text, null)
    return unsupported(text)
}

fun escapeHtml(text: String): String =
    buildString(text.length + 16) {
        text.forEach {
            when (it) {
                '&' -> append("&amp;")
                '<' -> append("&lt;")
                '>' -> append("&gt;")
                '"' -> append("&quot;")
                '\'' -> append("&#39;")
                else -> append(it)
            }
        }
    }

private fun encodeSegment(segment: String): String =
    buildString {
        segment.encodeToByteArray().forEach { byte ->
            val c = byte.toInt() and 0xff
            if (c in 'a'.code..'z'.code ||
                c in 'A'.code..'Z'.code ||
                c in '0'.code..'9'.code ||
                c == '-'.code ||
                c == '_'.code ||
                c == '.'.code
            ) {
                append(c.toChar())
            } else {
                append('%')
                append("0123456789ABCDEF"[c shr 4])
                append("0123456789ABCDEF"[c and 15])
            }
        }
    }

/** The head of a page: title, the badges for its section, pin, guests and archive, the device and room it belongs to, and who edited it last. */
internal fun docHeaderHtml(
    title: String,
    badges: List<String>,
    places: List<Pair<String, String>>,
    byLine: String,
): String =
    buildString {
        append("<header class=\"hw-head\"><h1>").append(escapeHtml(title)).append("</h1><p class=\"hw-badges\">")
        badges.forEach { append("<span class=\"hw-badge\">").append(escapeHtml(it)).append("</span>") }
        places.forEach { (path, name) ->
            append("<a class=\"hw-badge hw-place\" href=\"")
                .append(escapeHtml(path))
                .append("\">")
                .append(escapeHtml(name))
                .append("</a>")
        }
        append("</p>")
        if (byLine.isNotBlank()) append("<p class=\"hw-by\">").append(escapeHtml(byLine)).append("</p>")
        append("</header>")
    }

/** The "Linked from" list below a page. */
internal fun docBacklinksHtml(links: List<Pair<String, String>>): String {
    if (links.isEmpty()) return ""
    return buildString {
        append("<section class=\"hw-backlinks\"><h2>").append(escapeHtml(tr("docs_backlinks"))).append("</h2><p>")
        links.forEach { (slug, title) ->
            append(
                "<a class=\"hw-badge hw-place\" href=\"/docs/",
            ).append(encodeSegment(slug)).append("\">").append(escapeHtml(title)).append("</a>")
        }
        append("</p></section>")
    }
}

/** The body of a page that has no text yet. */
internal fun docEmptyBodyHtml(): String = "<p class=\"hw-empty\">${escapeHtml(tr("docs_body_empty"))}</p>"

private class DocPalette(
    val background: String,
    val text: String,
    val muted: String,
    val border: String,
    val code: String,
    val brand: String,
    val danger: String,
    val info: String,
    val warning: String,
    val scheme: String,
)

private val lightPalette =
    DocPalette("#fafbfc", "#131720", "#5d626f", "#e2e5ea", "#f1f2f5", "#107f6d", "#b81e1e", "#2563a8", "#a35d00", "light")
private val darkPalette =
    DocPalette("#0e0f13", "#f3f4f6", "#a3a7b1", "#2b2d34", "#191b20", "#26d9b5", "#f08a8a", "#7db2ee", "#f0b44c", "dark")

private fun cssString(text: String): String = "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ") + "\""

private fun styleSheet(p: DocPalette): String =
    """
    :root { color-scheme: ${p.scheme}; }
    * { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }
    body { margin: 0; padding: 16px; background: ${p.background}; color: ${p.text};
      font: 16px/1.65 -apple-system, system-ui, Roboto, "Helvetica Neue", sans-serif; overflow-wrap: anywhere; }
    a { color: ${p.brand}; text-decoration: underline; text-underline-offset: 3px; }
    h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.6em 0 0.55em; font-weight: 600; }
    h1 { font-size: 1.5rem; } h2 { font-size: 1.25rem; padding-bottom: 0.3em; border-bottom: 1px solid ${p.border}; }
    h3 { font-size: 1.08rem; } h4, h5, h6 { font-size: 1rem; }
    p, ul, ol, blockquote, pre, table, details { margin: 0.85em 0; }
    ul, ol { padding-inline-start: 1.5em; } li { margin: 0.25em 0; }
    li > input[type=checkbox] { margin-inline-end: 0.5em; }
    blockquote { margin-inline: 0; padding: 0.1em 0 0.1em 1em; border-inline-start: 3px solid ${p.border}; color: ${p.muted}; }
    hr { border: 0; border-top: 1px solid ${p.border}; margin: 2em 0; }
    code { font: 0.875em ui-monospace, Menlo, Consolas, monospace; background: ${p.code}; border-radius: 4px; padding: 0.15em 0.35em; }
    pre { background: ${p.code}; border: 1px solid ${p.border}; border-radius: 10px; padding: 0.85em 1em; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; font-size: 0.9rem; }
    th, td { border: 1px solid ${p.border}; padding: 0.45em 0.75em; text-align: start; vertical-align: top; overflow-wrap: break-word; }
    th { background: ${p.code}; font-weight: 600; }
    img { display: block; max-width: 100%; height: auto; margin: 1em 0; border-radius: 10px; border: 1px solid ${p.border}; }
    details { border: 1px solid ${p.border}; border-radius: 10px; padding: 0.5em 0.9em; }
    .secret, .callout { margin: 1.1em 0; border: 1px solid; border-radius: 10px; padding: 0.85em 1em; }
    .secret > :first-child, .callout > :first-child { margin-top: 0; }
    .secret > :last-child, .callout > :last-child { margin-bottom: 0; }
    .secret::before, .callout::before { display: block; margin-bottom: 0.5em; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
    .secret { border-style: dashed; border-color: ${p.danger}; } .secret::before { content: ${cssString(
        tr("docs_secret_label"),
    )}; color: ${p.danger}; }
    .callout-info { border-color: ${p.info}; } .callout-info::before { content: ${cssString(tr("docs_callout_info"))}; color: ${p.info}; }
    .callout-warning { border-color: ${p.warning}; } .callout-warning::before { content: ${cssString(
        tr("docs_callout_warning"),
    )}; color: ${p.warning}; }
    .hw-head h1 { margin: 0 0 0.4em; font-size: 1.6rem; }
    .hw-badges { margin: 0.4em 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .hw-badge { display: inline-block; border: 1px solid ${p.border}; border-radius: 999px; padding: 0.1em 0.7em; font-size: 0.8rem; color: ${p.muted}; text-decoration: none; }
    a.hw-place { color: ${p.text}; }
    .hw-by { margin: 0.4em 0 1.2em; font-size: 0.8rem; color: ${p.muted}; }
    .hw-empty { color: ${p.muted}; }
    .hw-backlinks { margin-top: 2em; } .hw-backlinks h2 { font-size: 0.9rem; border: 0; color: ${p.muted}; margin: 0 0 0.5em; }
    .hw-backlinks p { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
    """.trimIndent()

/**
 * The page the web views show: [bodyHtml] (the server's rendering, with the head and the links below
 * put around it by the stores) in the palette of the app. JavaScript is off in the views and the
 * page also forbids it; images come from `data:` addresses the stores filled in (or from `https`).
 */
fun docDocument(
    bodyHtml: String,
    dark: Boolean,
): String =
    "<!doctype html><html><head><meta charset=\"utf-8\">" +
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
        "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: https:; style-src 'unsafe-inline'\">" +
        "<style>" + styleSheet(if (dark) darkPalette else lightPalette) + "</style></head><body>" +
        bodyHtml + "</body></html>"

private val attachmentSource = Regex("src=\"/api/v1/attachments/([A-Za-z0-9_-]+)/content\"")

private const val MAX_INLINE_IMAGES = 30
private const val MAX_INLINE_BYTES = 12L * 1024 * 1024

/**
 * Web views cannot send the device token, so the images of a page (`/api/v1/attachments/<id>/content`)
 * are fetched through the API and put into the HTML as `data:` addresses. An image that cannot be
 * fetched keeps no source: the view shows its alt text instead.
 */
internal class DocImages(
    private val app: HauswartApp,
) {
    suspend fun inline(html: String): String {
        val ids =
            attachmentSource
                .findAll(html)
                .map { it.groupValues[1] }
                .distinct()
                .take(MAX_INLINE_IMAGES)
                .toList()
        if (ids.isEmpty()) return html
        val gate = Semaphore(3)
        val fetched =
            coroutineScope {
                ids
                    .map { id ->
                        async {
                            gate.withPermit {
                                try {
                                    val body = app.api.attachments.attachmentsContent(id, null)
                                    val mime =
                                        body.contentType
                                            ?.substringBefore(';')
                                            ?.trim()
                                            .orEmpty()
                                    if (mime.startsWith("image/")) id to (mime to body.bytes) else null
                                } catch (e: ApiException) {
                                    null
                                }
                            }
                        }
                    }.awaitAll()
            }.filterNotNull().toMap()
        var budget = MAX_INLINE_BYTES
        val uris = HashMap<String, String>()
        ids.forEach { id ->
            val image = fetched[id] ?: return@forEach
            if (image.second.size > budget) return@forEach
            budget -= image.second.size
            uris[id] = "data:${image.first};base64,${Base64.encode(image.second)}"
        }
        return attachmentSource.replace(html) { match ->
            val uri = uris[match.groupValues[1]]
            if (uri == null) "src=\"\"" else "src=\"$uri\""
        }
    }
}
