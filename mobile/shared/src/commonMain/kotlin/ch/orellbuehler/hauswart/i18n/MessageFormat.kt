package ch.orellbuehler.hauswart.i18n

import kotlin.math.abs

private const val MAX_DEPTH = 32

private class FormatError : Exception()

internal fun formatMessage(
    pattern: String,
    args: Map<String, Any?>,
    locale: String,
): String =
    try {
        MessageParser(pattern, args, locale).run()
    } catch (_: FormatError) {
        pattern
    }

private class MessageParser(
    private val s: String,
    private val args: Map<String, Any?>,
    private val locale: String,
) {
    private var i = 0

    fun run(): String = parseText(null, false, 0)

    private fun parseText(
        hash: String?,
        nested: Boolean,
        depth: Int,
    ): String {
        if (depth > MAX_DEPTH) throw FormatError()
        val out = StringBuilder()
        while (i < s.length) {
            val c = s[i]
            when {
                c == '\'' -> quote(out, hash != null)
                c == '{' -> {
                    i++
                    argument(out, hash, depth)
                }
                c == '}' -> {
                    if (!nested) throw FormatError()
                    i++
                    return out.toString()
                }
                c == '#' && hash != null -> {
                    out.append(hash)
                    i++
                }
                else -> {
                    out.append(c)
                    i++
                }
            }
        }
        if (nested) throw FormatError()
        return out.toString()
    }

    private fun quote(
        out: StringBuilder,
        inPlural: Boolean,
    ) {
        val next = s.getOrNull(i + 1)
        when {
            next == '\'' -> {
                out.append('\'')
                i += 2
            }
            next == '{' || next == '}' || (inPlural && next == '#') -> {
                i++
                while (i < s.length) {
                    if (s[i] == '\'') {
                        if (s.getOrNull(i + 1) == '\'') {
                            out.append('\'')
                            i += 2
                            continue
                        }
                        i++
                        return
                    }
                    out.append(s[i])
                    i++
                }
            }
            else -> {
                out.append('\'')
                i++
            }
        }
    }

    private fun readUntil(stops: String): String {
        val start = i
        while (i < s.length && s[i] !in stops) i++
        if (i >= s.length) throw FormatError()
        return s.substring(start, i)
    }

    private fun skipWhitespace() {
        while (i < s.length && s[i].isWhitespace()) i++
    }

    private fun argument(
        out: StringBuilder,
        hash: String?,
        depth: Int,
    ) {
        val name = readUntil(",}").trim()
        if (name.isEmpty()) throw FormatError()
        if (s[i] == '}') {
            i++
            out.append(simple(name))
            return
        }
        i++
        val type = readUntil(",}").trim()
        if (s[i] == '}') {
            i++
            out.append(simple(name))
            return
        }
        i++
        when (type) {
            "plural" -> plural(out, name, ordinal = false, depth = depth)
            "selectordinal" -> plural(out, name, ordinal = true, depth = depth)
            "select" -> select(out, name, hash, depth)
            "number", "date", "time" -> {
                readUntil("}")
                i++
                out.append(simple(name))
            }
            else -> throw FormatError()
        }
    }

    private fun simple(name: String): String = if (args.containsKey(name)) display(args[name]) else "{$name}"

    private fun options(
        hash: String?,
        depth: Int,
    ): List<Pair<String, String>> {
        val result = mutableListOf<Pair<String, String>>()
        while (true) {
            skipWhitespace()
            if (i >= s.length) throw FormatError()
            if (s[i] == '}') {
                i++
                break
            }
            val start = i
            while (i < s.length && !s[i].isWhitespace() && s[i] != '{' && s[i] != '}') i++
            val selector = s.substring(start, i)
            if (selector.isEmpty()) throw FormatError()
            skipWhitespace()
            if (i >= s.length || s[i] != '{') throw FormatError()
            i++
            result += selector to parseText(hash, true, depth + 1)
        }
        if (result.isEmpty()) throw FormatError()
        return result
    }

    private fun plural(
        out: StringBuilder,
        name: String,
        ordinal: Boolean,
        depth: Int,
    ) {
        val present = args.containsKey(name)
        val raw = args[name]
        val number = toNumber(raw)
        val options = options(if (present) display(raw) else null, depth)
        if (!present) {
            out.append("{$name}")
            return
        }
        val exact = number?.let { n -> options.firstOrNull { it.first.startsWith("=") && it.first.drop(1).toDoubleOrNull() == n } }
        val chosen =
            exact
                ?: number?.let { n ->
                    val category = pluralCategory(n, ordinal)
                    options.firstOrNull { it.first == category }
                }
                ?: options.firstOrNull { it.first == "other" }
        out.append(chosen?.second.orEmpty())
    }

    private fun select(
        out: StringBuilder,
        name: String,
        hash: String?,
        depth: Int,
    ) {
        val options = options(hash, depth)
        if (!args.containsKey(name)) {
            out.append("{$name}")
            return
        }
        val value = display(args[name])
        val chosen = options.firstOrNull { it.first == value } ?: options.firstOrNull { it.first == "other" }
        out.append(chosen?.second.orEmpty())
    }

    private fun pluralCategory(
        number: Double,
        ordinal: Boolean,
    ): String {
        val n = abs(number)
        if (!ordinal) return if (n == 1.0) "one" else "other"
        if (locale != "en" || n != kotlin.math.floor(n)) return "other"
        val whole = n.toLong()
        return when {
            whole % 10 == 1L && whole % 100 != 11L -> "one"
            whole % 10 == 2L && whole % 100 != 12L -> "two"
            whole % 10 == 3L && whole % 100 != 13L -> "few"
            else -> "other"
        }
    }

    private fun toNumber(value: Any?): Double? =
        when (value) {
            is Number -> value.toDouble()
            is String -> value.trim().toDoubleOrNull()
            else -> null
        }

    private fun display(value: Any?): String =
        when (value) {
            null -> ""
            is Double -> displayDouble(value)
            is Float -> displayDouble(value.toDouble())
            else -> value.toString()
        }

    private fun displayDouble(value: Double): String =
        if (value.isFinite() && value == kotlin.math.floor(value) && abs(value) < 1e15) value.toLong().toString() else value.toString()
}
