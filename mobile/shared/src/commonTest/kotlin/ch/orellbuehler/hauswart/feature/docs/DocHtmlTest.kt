package ch.orellbuehler.hauswart.feature.docs

import ch.orellbuehler.hauswart.feature.applink.LINK_ASSET
import ch.orellbuehler.hauswart.feature.applink.LINK_DOC
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class DocHtmlTest {
    private val server = "https://home.example.org"

    @Test
    fun linksAreSortedByWhatTheyPointAt() {
        class Case(
            val url: String,
            val kind: String,
            val value: String? = null,
            val appKind: String? = null,
            val appId: String? = null,
        )
        listOf(
            Case("${DOC_BASE_URL}docs/boiler", DOC_LINK_APP, appKind = LINK_DOC, appId = "boiler"),
            Case("${DOC_BASE_URL}assets/a1", DOC_LINK_APP, appKind = LINK_ASSET, appId = "a1"),
            Case("$server/docs/heating", DOC_LINK_APP, appKind = LINK_DOC, appId = "heating"),
            Case("${DOC_BASE_URL}api/v1/attachments/abc_12/content", DOC_LINK_ATTACHMENT, value = "abc_12"),
            Case("$server/api/v1/attachments/xyz/content", DOC_LINK_ATTACHMENT, value = "xyz"),
            Case("#h-intro", DOC_LINK_ANCHOR),
            Case("${DOC_BASE_URL}#h-intro", DOC_LINK_ANCHOR),
            Case("https://example.org/manual.pdf", DOC_LINK_EXTERNAL, value = "https://example.org/manual.pdf"),
            Case("mailto:help@example.org", DOC_LINK_EXTERNAL, value = "mailto:help@example.org"),
            Case("tel:+41000000000", DOC_LINK_EXTERNAL, value = "tel:+41000000000"),
            Case("javascript:alert(1)", DOC_LINK_UNSUPPORTED),
            Case("file:///etc/passwd", DOC_LINK_UNSUPPORTED),
            Case("${DOC_BASE_URL}api/v1/tasks", DOC_LINK_UNSUPPORTED),
            Case("${DOC_BASE_URL}settings/tokens/x", DOC_LINK_UNSUPPORTED),
        ).forEach { c ->
            val target = classifyDocLink(c.url, server)
            assertEquals(c.kind, target.kind, c.url)
            if (c.value != null) assertEquals(c.value, target.value, c.url)
            if (c.appKind != null) {
                assertEquals(c.appKind, target.link?.kind, c.url)
                assertEquals(c.appId, target.link?.id, c.url)
            }
        }
    }

    @Test
    fun aServerAddressOnlyCountsAtAPathBoundary() {
        assertEquals(DOC_LINK_EXTERNAL, classifyDocLink("https://home.example.org.evil.example/docs/x", server).kind)
        assertEquals(DOC_LINK_EXTERNAL, classifyDocLink("https://example.org/docs/x", null).kind)
    }

    @Test
    fun textIsEscaped() {
        assertEquals("&lt;b&gt;&amp;&quot;&#39;", escapeHtml("<b>&\"'"))
        val head = docHeaderHtml("<script>x</script>", listOf("A&B"), listOf("/assets/a1" to "Oven \"1\""), "by <me>")
        assertTrue("&lt;script&gt;" in head)
        assertTrue("<script>" !in head)
        assertTrue("href=\"/assets/a1\"" in head)
        assertTrue("Oven &quot;1&quot;" in head)
    }

    @Test
    fun backlinksEncodeTheSlug() {
        val html = docBacklinksHtml(listOf("a b/c" to "Title"))
        assertTrue("href=\"/docs/a%20b%2Fc\"" in html)
        assertEquals("", docBacklinksHtml(emptyList()))
    }

    @Test
    fun theDocumentForbidsScriptsAndFollowsTheTheme() {
        val light = docDocument("<p>x</p>", dark = false)
        val dark = docDocument("<p>x</p>", dark = true)
        assertTrue("default-src 'none'" in light)
        assertTrue("color-scheme: light" in light)
        assertTrue("color-scheme: dark" in dark)
        assertTrue("<p>x</p>" in light)
        assertNotNull(Regex("<body>").find(dark))
    }
}
