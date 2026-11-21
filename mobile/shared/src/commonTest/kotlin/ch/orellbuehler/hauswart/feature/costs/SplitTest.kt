package ch.orellbuehler.hauswart.feature.costs

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SplitTest {
    // The same vectors as `allocate` in src/lib/money-share.test.ts.
    private val vectors =
        listOf(
            Triple(10000L, listOf(5000L, 5000L), listOf(5000L, 5000L)),
            Triple(1001L, listOf(5000L, 5000L), listOf(501L, 500L)),
            Triple(-1001L, listOf(5000L, 5000L), listOf(-501L, -500L)),
            Triple(1000L, listOf(1L, 1L, 1L), listOf(334L, 333L, 333L)),
            Triple(100L, listOf(3333L, 3333L, 3334L), listOf(33L, 33L, 34L)),
            Triple(1L, listOf(5000L, 5000L), listOf(1L, 0L)),
            Triple(0L, listOf(5000L, 5000L), listOf(0L, 0L)),
            Triple(12345L, listOf(10000L), listOf(12345L)),
            Triple(7L, listOf(7000L, 3000L), listOf(5L, 2L)),
            Triple(10L, listOf(1L, 1L, 1L), listOf(4L, 3L, 3L)),
            Triple(5L, listOf(2000L, 8000L), listOf(1L, 4L)),
            Triple(3L, listOf(4500L, 5500L), listOf(1L, 2L)),
            Triple(5L, listOf(0L, 1L, 1L), listOf(0L, 3L, 2L)),
            Triple(1L, listOf(0L, 1L, 0L), listOf(0L, 1L, 0L)),
        )

    @Test
    fun allocateMatchesTheWeb() {
        vectors.forEach { (amount, weights, expected) ->
            assertEquals(expected, allocate(amount, weights), "$amount by $weights")
        }
    }

    @Test
    fun aRefundSplitsLikeTheExpenseItReverses() {
        listOf(1L, 2L, 3L, 99L, 1001L, 123457L).forEach { amount ->
            val plus = allocate(amount, listOf(3333, 3333, 3334))
            val minus = allocate(-amount, listOf(3333, 3333, 3334))
            assertEquals(plus, minus.map { -it })
        }
    }

    @Test
    fun partsAddUpExactlyWhateverTheWeights() {
        var seed = 42L

        fun rand(n: Int): Int {
            seed = (seed * 1103515245 + 12345) % 2147483648
            return (seed % n).toInt()
        }
        repeat(2000) {
            val amount = (if (rand(2) == 0) 1 else -1) * rand(5_000_000).toLong()
            val weights = List(1 + rand(6)) { rand(10_000).toLong() }
            if (weights.sum() == 0L) return@repeat
            val parts = allocate(amount, weights)
            assertEquals(amount, parts.sum())
            parts.forEachIndexed { k, part ->
                val exact = amount.toDouble() * weights[k] / weights.sum()
                assertTrue(kotlin.math.abs(part - exact) < 1.0, "$amount $weights")
            }
        }
    }

    @Test
    fun refusesNonsense() {
        assertFailsWith<IllegalArgumentException> { allocate(5, emptyList()) }
        assertFailsWith<IllegalArgumentException> { allocate(5, listOf(0, 0)) }
        assertFailsWith<IllegalArgumentException> { allocate(5, listOf(-1, 2)) }
    }

    private fun people(vararg bps: Long) = bps.mapIndexed { i, b -> PersonOption("u${i + 1}", "P${i + 1}", b) }

    @Test
    fun anEqualSplitDividesBasisPointsFirst() {
        // 300.00 among three is 100.02, 99.99 and 99.99, as the server books it
        val shares = sharesFor("equal", people(0, 0, 0))
        assertEquals(listOf(3334L, 3333L, 3333L), shares.map { it.shareBps })
        assertEquals(listOf("u1" to 10002L, "u2" to 9999L, "u3" to 9999L), amountsFor(30000, shares))
    }

    @Test
    fun ownershipWeighsByTheSharesAndFallsBackToEqual() {
        assertEquals(listOf(6000L, 4000L), sharesFor("ownership", people(6000, 4000)).map { it.shareBps })
        assertEquals(listOf(10000L), sharesFor("ownership", people(5000, 0)).map { it.shareBps }.take(1))
        assertEquals(listOf(5000L, 5000L), sharesFor("ownership", people(0, 0)).map { it.shareBps })
        assertEquals(emptyList(), sharesFor("none", people(1, 1)))
    }

    @Test
    fun sharesAreTakenInIdOrder() {
        val reversed = listOf(PersonOption("u2", "B", 0), PersonOption("u1", "A", 0))
        assertEquals(listOf("u1", "u2"), sharesFor("equal", reversed).map { it.userId })
        assertEquals(emptyList(), amountsFor(100, emptyList()))
    }

    @Test
    fun percentsRoundTrip() {
        mapOf(5000L to "50", 3333L to "33.33", 3330L to "33.3", 3305L to "33.05", 10000L to "100", 1L to "0.01").forEach { (bps, text) ->
            assertEquals(text, shareToInput(bps))
            assertEquals(bps, parseSharePercent(text))
        }
        assertEquals(7000L, parseSharePercent("70 %"))
        assertEquals(3350L, parseSharePercent("33,5"))
        assertNull(parseSharePercent("0"))
        assertNull(parseSharePercent("100.01"))
        assertNull(parseSharePercent("abc"))
        assertNull(parseSharePercent("33.333"))
        assertNull(parseSharePercent(""))
    }

    @Test
    fun equalShareInputsGiveTheRemainderToTheFirst() {
        assertEquals(mapOf("a" to "33.34", "b" to "33.33", "c" to "33.33"), equalShareInputs(listOf("a", "b", "c")))
        assertEquals(emptyMap(), equalShareInputs(emptyList()))
    }
}
