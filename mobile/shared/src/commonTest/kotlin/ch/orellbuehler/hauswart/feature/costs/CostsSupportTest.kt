package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.api.generated.CostBook
import ch.orellbuehler.hauswart.api.generated.RecentCategoriesItemsItem
import ch.orellbuehler.hauswart.i18n.I18n
import kotlinx.serialization.json.Json
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CostsSupportTest {
    @AfterTest
    fun reset() {
        I18n.locale = "de"
    }

    private fun book(
        id: String,
        archived: Boolean = false,
        isDefault: Boolean = false,
        entries: Int = 0,
    ): CostBook = Json.decodeFromString(costBook(id, "Buch $id", archived = archived, isDefault = isDefault, entryCount = entries))

    private val books =
        listOf(book("b1", isDefault = true), book("b2"), book("b3", archived = true, entries = 4), book("b4", archived = true))

    @Test
    fun theBookComesFromTheAskThenTheMemoryAndNeverFromAnUnknownId() {
        assertEquals("b2", chooseBook("b2", "b1", books))
        assertEquals(ALL_BOOKS, chooseBook(ALL_BOOKS, "b1", books))
        assertEquals(ALL_BOOKS, chooseBook("gone", "b1", books))
        assertEquals("b1", chooseBook(null, "b1", books))
        assertEquals(ALL_BOOKS, chooseBook(null, "gone", books))
        assertEquals(ALL_BOOKS, chooseBook(null, null, books))
    }

    @Test
    fun theSwitcherOffersOpenBooksAndArchivedOnesThatStillHoldSomething() {
        assertEquals(listOf("b1", "b2", "b3"), switcherBooks(books, "b1").map { it.id })
        assertEquals(listOf("b1", "b2", "b3", "b4"), switcherBooks(books, "b4").map { it.id })
    }

    @Test
    fun aQuickEntryStartsInTheAskedLastUsedRememberedOrDefaultBookThatIsOpen() {
        assertEquals("b2", chooseQuickBook("b2", "b1", "b1", books))
        assertEquals("b2", chooseQuickBook(null, "b2", "b1", books))
        assertEquals("b1", chooseQuickBook(null, "b3", "b1", books))
        assertEquals("b1", chooseQuickBook(null, null, null, books))
        assertEquals("b1", chooseQuickBook("b3", "", "", books))
    }

    @Test
    fun theBookArgumentRoundTrips() {
        assertEquals("all", bookArgOf(ALL_BOOKS))
        assertEquals("b1", bookArgOf("b1"))
        assertEquals(ALL_BOOKS, bookOfArg("all"))
        assertEquals("b1", bookOfArg("b1"))
        assertEquals(null, bookOfArg(null))
        assertEquals(null, bookOfArg(""))
    }

    @Test
    fun everyCategoryAppearsOnceInBothFixedOrders() {
        CATEGORY_ORDERS.forEach { order ->
            assertEquals(COST_CATEGORIES.toSet(), order.toSet())
            assertEquals(order.size, order.toSet().size)
        }
    }

    private fun used(
        bookId: String,
        category: String,
        count: Long,
    ) = RecentCategoriesItemsItem(bookId, category, count)

    @Test
    fun categoriesAreRankedByTheBookThenEverythingThenTheFixedOrder() {
        val fixed = rankCategories(emptyList(), "b1", taxRelevant = false)
        assertEquals("groceries", fixed.first())
        assertEquals("repair", rankCategories(emptyList(), "b1", taxRelevant = true).first())

        val ranked = rankCategories(listOf(used("b1", "gifts", 2), used("b2", "travel", 9), used("b1", "health", 1)), "b1", false)
        assertEquals(listOf("gifts", "health", "travel"), ranked.take(3))
        assertEquals(COST_CATEGORIES.size, ranked.size)
    }

    @Test
    fun theChipsShowEightAndKeepAPickedCategoryVisible() {
        val ranked = rankCategories(emptyList(), null, false)
        assertEquals(VISIBLE_CATEGORIES, chipCategories(ranked, "", false).size)
        assertEquals(ranked, chipCategories(ranked, "", true))
        val picked = chipCategories(ranked, "other", false)
        assertEquals(VISIBLE_CATEGORIES + 1, picked.size)
        assertEquals("other", picked.last())
        assertEquals(VISIBLE_CATEGORIES, chipCategories(ranked, ranked[2], false).size)
    }

    @Test
    fun monthTitlesAreWrittenOutInTheLanguageOfTheApp() {
        assertEquals("November 2026", costMonthTitle("2026-11-12"))
        assertEquals("März 2027", costMonthTitle("2027-03-01"))
        I18n.locale = "en"
        assertEquals("March 2027", costMonthTitle("2027-03-01"))
        assertEquals("garbage", costMonthTitle("garbage"))
    }

    @Test
    fun amountsAreReadInTheCurrencyOfTheEntryAndNeverAsFloats() {
        assertEquals(1250L, parseAmountText("12.50", "CHF").minor)
        assertEquals(1250L, parseAmountText("12,5", "CHF").minor)
        assertEquals(1200L, parseAmountText("12.", "CHF").minor)
        assertEquals(-1250L, parseAmountText("12.50", "CHF", refund = true).minor)
        assertEquals(-1250L, parseAmountText("-12.50", "CHF", refund = true).minor)
        assertEquals(123456L, parseAmountText("1'234.56", "CHF").minor)
        assertEquals(1250L, parseAmountText("1250", "JPY").minor)
        assertTrue(parseAmountText("12.345", "CHF").error != null)
        assertTrue(parseAmountText("", "CHF").error != null)
        assertTrue(parseAmountText("0", "CHF").error != null)
        assertTrue(parseAmountText("abc", "CHF").error != null)
        assertTrue(parseAmountText("10000000000", "CHF").error != null)
        assertTrue(parseAmountText("5", "xx").error != null)
        assertTrue(parseAmountText("-5", "CHF", positiveOnly = true).error != null)
        assertEquals(500L, parseAmountText("5", "CHF", positiveOnly = true).minor)
    }

    @Test
    fun currenciesAreTypedAsUpperCaseLetters() {
        assertEquals("CHF", cleanCurrency("chf"))
        assertEquals("EUR", cleanCurrency("e1u2r3x"))
        assertEquals("", cleanCurrency("12"))
    }
}
