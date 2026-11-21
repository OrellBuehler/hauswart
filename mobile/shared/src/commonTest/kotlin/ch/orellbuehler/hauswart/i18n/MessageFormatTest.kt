package ch.orellbuehler.hauswart.i18n

import kotlin.test.Test
import kotlin.test.assertEquals

class MessageFormatTest {
    private class Case(
        val name: String,
        val pattern: String,
        val args: Map<String, Any?>,
        val expected: String,
        val locale: String = "en",
    )

    private val plural = "{n, plural, =0 {none} one {# item} other {# items}}"

    private val cases =
        listOf(
            Case("plain", "Hello world", emptyMap(), "Hello world"),
            Case("empty", "", emptyMap(), ""),
            Case("param", "Hello {name}!", mapOf("name" to "Ada"), "Hello Ada!"),
            Case("two params", "{a} of {b}", mapOf("a" to 2, "b" to 5), "2 of 5"),
            Case("double without fraction", "{x}", mapOf("x" to 3.0), "3"),
            Case("double with fraction", "{x}", mapOf("x" to 2.5), "2.5"),
            Case("long", "{x}", mapOf("x" to 12345678901L), "12345678901"),
            Case("null arg", "[{x}]", mapOf("x" to null), "[]"),
            Case("missing arg", "Hello {name}!", emptyMap(), "Hello {name}!"),
            Case("plural exact zero", plural, mapOf("n" to 0), "none"),
            Case("plural one", plural, mapOf("n" to 1), "1 item"),
            Case("plural other", plural, mapOf("n" to 7), "7 items"),
            Case("plural double one", plural, mapOf("n" to 1.0), "1 item"),
            Case("plural double fraction", plural, mapOf("n" to 1.5), "1.5 items"),
            Case("plural string number", plural, mapOf("n" to "3"), "3 items"),
            Case("plural exact beats category", "{n, plural, =1 {exactly} one {category} other {many}}", mapOf("n" to 1), "exactly"),
            Case("plural exact two", "{n, plural, =2 {pair} other {many}}", mapOf("n" to 2), "pair"),
            Case("plural missing arg", plural, emptyMap(), "{n}"),
            Case("plural without matching branch", "{n, plural, =0 {none}}", mapOf("n" to 5), ""),
            Case("plural in text", "You have {n, plural, one {# task} other {# tasks}} left.", mapOf("n" to 2), "You have 2 tasks left."),
            Case("german plural", "{n, plural, one {# Aufgabe} other {# Aufgaben}}", mapOf("n" to 1), "1 Aufgabe", "de"),
            Case("hash outside plural", "Defect #{number}", mapOf("number" to 4), "Defect #4"),
            Case("param in branch", "{c, plural, one {{who} has one} other {{who} has {c}}}", mapOf("c" to 3, "who" to "Ada"), "Ada has 3"),
            Case("select match", "{x, select, a {first} b {second} other {rest}}", mapOf("x" to "b"), "second"),
            Case("select other", "{x, select, a {first} other {rest}}", mapOf("x" to "z"), "rest"),
            Case("select numeric value", "{pos, select, 1 {last} other {{pos}th-to-last}}", mapOf("pos" to 3), "3th-to-last"),
            Case("select numeric match", "{pos, select, 1 {last} other {{pos}th-to-last}}", mapOf("pos" to 1.0), "last"),
            Case("select missing arg", "{x, select, a {first} other {rest}}", emptyMap(), "{x}"),
            Case(
                "plural inside select",
                "{kind, select, task {{n, plural, one {# task} other {# tasks}}} other {{n} things}}",
                mapOf("kind" to "task", "n" to 2),
                "2 tasks",
            ),
            Case(
                "select inside plural",
                "{n, plural, one {{kind, select, task {one task} other {one thing}}} other {# {kind}s}}",
                mapOf("n" to 4, "kind" to "task"),
                "4 tasks",
            ),
            Case("hash through select", "{n, plural, other {{k, select, a {# a} other {# x}}}}", mapOf("n" to 3, "k" to "a"), "3 a"),
            Case("whitespace in tags", "{ n , plural , one { one } other { many } }", mapOf("n" to 1), " one "),
            Case("number type", "{n, number}", mapOf("n" to 5), "5"),
            Case("selectordinal en", "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}", mapOf("n" to 22), "22nd"),
            Case("selectordinal eleven", "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}", mapOf("n" to 11), "11th"),
            Case("selectordinal de", "{n, selectordinal, one {#st} other {#.}}", mapOf("n" to 1), "1.", "de"),
            Case("apostrophe literal", "The counter's value", emptyMap(), "The counter's value"),
            Case("doubled apostrophe", "It''s {x}", mapOf("x" to 1), "It's 1"),
            Case("quoted braces", "Use '{x}' here", mapOf("x" to 1), "Use {x} here"),
            Case("malformed unclosed argument", "Hello {name", mapOf("name" to "Ada"), "Hello {name"),
            Case("malformed stray close", "Hello }", emptyMap(), "Hello }"),
            Case("malformed unclosed plural", "{n, plural, one {# item", mapOf("n" to 1), "{n, plural, one {# item"),
            Case("plural without options", "{n, plural}", mapOf("n" to 1), "1"),
            Case("malformed empty options", "{n, plural, }", mapOf("n" to 1), "{n, plural, }"),
            Case("malformed no branch body", "{n, plural, one other {x}}", mapOf("n" to 1), "{n, plural, one other {x}}"),
            Case("malformed empty name", "{}", emptyMap(), "{}"),
            Case("malformed unknown type", "{n, bogus, x {y}}", mapOf("n" to 1), "{n, bogus, x {y}}"),
            Case(
                "malformed depth",
                "{a, select, other {".repeat(40) + "x" + "}}".repeat(40),
                mapOf("a" to 1),
                "{a, select, other {".repeat(40) + "x" + "}}".repeat(40),
            ),
        )

    @Test
    fun cases() {
        cases.forEach { c ->
            assertEquals(c.expected, formatMessage(c.pattern, c.args, c.locale), c.name)
        }
    }
}
