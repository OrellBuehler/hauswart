package ch.orellbuehler.hauswart.feature.comments

import kotlin.test.Test
import kotlin.test.assertEquals

class LinkifyTest {
    private fun t(text: String) = TextSegment(text, null)

    private fun l(url: String) = TextSegment(url, url)

    @Test
    fun splitsTextAndLinks() {
        val cases =
            listOf(
                "no link here" to listOf(t("no link here")),
                "" to emptyList(),
                "see https://example.org/a now" to listOf(t("see "), l("https://example.org/a"), t(" now")),
                "https://example.org" to listOf(l("https://example.org")),
                "end of sentence https://example.org/x." to listOf(t("end of sentence "), l("https://example.org/x"), t(".")),
                "(see https://example.org/a_(b))" to listOf(t("(see "), l("https://example.org/a_(b)"), t(")")),
                "wrapped (https://example.org/a)" to listOf(t("wrapped ("), l("https://example.org/a"), t(")")),
                "two http://a.example.org, and https://b.example.org!" to
                    listOf(t("two "), l("http://a.example.org"), t(", and "), l("https://b.example.org"), t("!")),
                "ftp://example.org and javascript:alert(1)" to listOf(t("ftp://example.org and javascript:alert(1)")),
            )
        cases.forEach { (input, expected) -> assertEquals(expected, linkify(input), input) }
    }
}
