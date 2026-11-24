package ch.orellbuehler.hauswart.i18n

import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class I18nTest {
    private val missingKey = "no_such_key_anywhere"

    @AfterTest
    fun reset() {
        I18n.locale = "de"
    }

    @Test
    fun everyRealMessageFormats() {
        I18n.locales.forEach { locale ->
            val messages = GeneratedMessages.load(locale)
            assertTrue(messages.size > 4000, "$locale has ${messages.size} messages")
            val names = Regex("\\{\\s*(\\w+)")
            messages.forEach { (key, pattern) ->
                val args = names.findAll(pattern).associate { it.groupValues[1] to 2 }
                val formatted = formatMessage(pattern, args, locale)
                if (pattern.contains('{')) {
                    assertFalse(formatted == pattern, "$locale/$key was left unformatted: $pattern")
                }
                assertFalse(formatted.contains("{"), "$locale/$key still has braces: $formatted")
            }
        }
    }

    @Test
    fun mobileMessagesAreLoaded() {
        I18n.locale = "de"
        assertEquals("Erneut versuchen", I18n.t("m_common_retry"))
        I18n.locale = "en"
        assertEquals("Try again", I18n.t("m_common_retry"))
        assertEquals("hauswart", I18n.t("m_app_name"))
    }

    @Test
    fun realKeysRenderInBothLocales() {
        I18n.locale = "de"
        assertEquals("Jeden Tag", I18n.t("trigger_every_day", mapOf("n" to 1)))
        assertEquals("Alle 3 Tage", I18n.t("trigger_every_day", mapOf("n" to 3)))
        assertEquals("und 1 weiteres Buch", I18n.t("dashboard_costs_more_books", mapOf("count" to 1)))
        assertEquals("und 4 weitere Bücher", I18n.t("dashboard_costs_more_books", mapOf("count" to 4)))
        assertEquals("letzten Tag", I18n.t("trigger_cal_day_last", mapOf("pos" to 1)))
        assertEquals("vorletzten Tag", I18n.t("trigger_cal_day_last", mapOf("pos" to 2)))
        assertEquals("3.-letzten Tag", I18n.t("trigger_cal_day_last", mapOf("pos" to 3)))
        assertEquals("Mangel #12 erfasst.", I18n.t("defect_created_toast", mapOf("number" to 12)))
        assertEquals("Mangel #12 erfasst.", tr("defect_created_toast", "number" to 12))

        I18n.locale = "en"
        assertEquals("the last day", I18n.t("trigger_cal_day_last", mapOf("pos" to 1)))
        assertEquals("the second-to-last day", I18n.t("trigger_cal_day_last", mapOf("pos" to 2)))
        assertEquals("the 5th-to-last day", I18n.t("trigger_cal_day_last", mapOf("pos" to 5)))
        assertEquals("Defect #12 recorded.", I18n.t("defect_created_toast", mapOf("number" to 12)))
        assertEquals("Every day", I18n.t("trigger_every_day", mapOf("n" to 1)))
        assertEquals("Every 3 days", I18n.t("trigger_every_day", mapOf("n" to 3)))
        assertEquals("and 1 more book", I18n.t("dashboard_costs_more_books", mapOf("count" to 1)))
        assertEquals("and 4 more books", I18n.t("dashboard_costs_more_books", mapOf("count" to 4)))
    }

    @Test
    fun fallbackAndMissingKeys() {
        assertEquals(missingKey, I18n.t(missingKey))
        assertEquals(missingKey, I18n.t(missingKey, mapOf("n" to 1)))
        assertFalse(I18n.has(missingKey))
        assertTrue(I18n.has("m_app_name"))
        I18n.locale = "en"
        assertEquals(missingKey, I18n.t(missingKey))
        assertTrue(I18n.has("m_app_name"))
    }

    @Test
    fun missingArgsStayVisible() {
        assertEquals("Mangel #{number} erfasst.", I18n.t("defect_created_toast"))
        assertEquals("Mangel #{number} erfasst.", I18n.t("defect_created_toast", emptyMap()))
    }

    @Test
    fun localeSwitching() {
        assertEquals(listOf("de", "en"), I18n.locales)
        assertEquals("de", I18n.locale)
        I18n.locale = "en"
        assertEquals("en", I18n.locale)
        assertEquals("Loading…", I18n.t("m_common_loading"))
        I18n.locale = "fr"
        assertEquals("en", I18n.locale)
        I18n.locale = "de"
        assertEquals("de", I18n.locale)
        assertEquals("Lädt …", I18n.t("m_common_loading"))
    }
}
