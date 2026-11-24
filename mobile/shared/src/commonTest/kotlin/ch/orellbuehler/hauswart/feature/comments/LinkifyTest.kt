package ch.orellbuehler.hauswart.feature.comments

import kotlin.test.Test
import kotlin.test.assertEquals

class LinkifyTest {
    private fun plain(text: String) = TextSegment(text, null)

    private fun link(url: String) = TextSegment(url, url)

    @Test
    fun splitsTextAndLinks() {
        val cases =
            listOf(
                "no link here" to listOf(plain("no link here")),
                "" to emptyList(),
                "see https://example.org/a now" to listOf(plain("see "), link("https://example.org/a"), plain(" now")),
                "https://example.org" to listOf(link("https://example.org")),
                "end of sentence https://example.org/x." to listOf(plain("end of sentence "), link("https://example.org/x"), plain(".")),
                "(see https://example.org/a_(b))" to listOf(plain("(see "), link("https://example.org/a_(b)"), plain(")")),
                "wrapped (https://example.org/a)" to listOf(plain("wrapped ("), link("https://example.org/a"), plain(")")),
                "two http://a.example.org, and https://b.example.org!" to
                    listOf(plain("two "), link("http://a.example.org"), plain(", and "), link("https://b.example.org"), plain("!")),
                "ftp://example.org and javascript:alert(1)" to listOf(plain("ftp://example.org and javascript:alert(1)")),
            )
        cases.forEach { (input, expected) -> assertEquals(expected, linkify(input), input) }
    }
}
