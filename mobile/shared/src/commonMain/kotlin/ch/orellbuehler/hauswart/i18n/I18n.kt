package ch.orellbuehler.hauswart.i18n

import kotlin.concurrent.Volatile

object I18n {
    val locales: List<String> = listOf("de", "en")

    @Volatile
    private var current: String = "de"

    private val de: Map<String, String> by lazy { GeneratedMessages.load("de") }
    private val en: Map<String, String> by lazy { GeneratedMessages.load("en") }

    var locale: String
        get() = current
        set(value) {
            current = if (value in locales) value else "en"
        }

    fun has(key: String): Boolean = lookup(key) != null

    fun t(key: String): String = lookup(key) ?: key

    fun t(
        key: String,
        args: Map<String, Any?>,
    ): String {
        val pattern = lookup(key) ?: return key
        return formatMessage(pattern, args, current)
    }

    private fun lookup(key: String): String? {
        val messages = if (current == "en") en else de
        return messages[key] ?: de[key]
    }
}

fun tr(
    key: String,
    vararg args: Pair<String, Any?>,
): String = I18n.t(key, mapOf(*args))
