package ch.orellbuehler.hauswart.feature.costs

import kotlin.math.abs

/** One person's frozen share of an entry, in basis points (10000 = 100%). */
data class ShareBps(
    val userId: String,
    val shareBps: Long,
)

/**
 * Divides [amount] in proportion to [weights] so that the parts add up to the amount exactly (largest remainder). Works on
 * the absolute value and puts the sign back, so a refund splits exactly like the expense it reverses. The remainder goes to
 * the largest fractional parts, ties to the earlier weight; a weight of 0 never receives anything. Same as `allocate` of
 * the web app (`src/lib/money.ts`); [amount] must stay within [MAX_COST_MINOR] so that nothing overflows.
 */
fun allocate(
    amount: Long,
    weights: List<Long>,
): List<Long> {
    require(weights.isNotEmpty()) { "Cannot divide an amount between nobody" }
    require(weights.all { it >= 0 }) { "Weights must be non-negative" }
    val total = weights.sum()
    require(total > 0) { "Weights must not all be zero" }
    val absolute = abs(amount)
    val base = weights.map { absolute * it / total }
    val remainder = weights.map { absolute * it % total }
    var left = absolute - base.sum()
    val order =
        weights.indices
            .filter { weights[it] > 0 }
            .sortedWith(compareByDescending<Int> { remainder[it] }.thenBy { it })
    val out = base.toMutableList()
    for (index in order) {
        if (left == 0L) break
        out[index] += 1
        left -= 1
    }
    return out.map { if (amount < 0 && it != 0L) -it else it }
}

/**
 * The frozen shares of an entry the server books for a split without explicit shares: people in id order, `ownership`
 * weighs by their ownership share (nobody with 0% pays, all zero falls back to equal), `equal` weighs everybody the same.
 */
fun sharesFor(
    mode: String,
    people: List<PersonOption>,
): List<ShareBps> {
    if (mode == "none" || people.isEmpty()) return emptyList()
    val sorted = people.sortedBy { it.id }
    val weights = if (mode == "equal") sorted.map { 1L } else sorted.map { maxOf(0L, it.ownershipBps) }
    val effective = if (weights.any { it > 0 }) weights else sorted.map { 1L }
    val bps = allocate(SHARE_BPS_TOTAL, effective)
    return sorted.mapIndexed { i, p -> ShareBps(p.id, bps[i]) }.filter { it.shareBps > 0 }
}

/** Each person's part of [amountMinor], the way the server divides it; the people in id order. */
fun amountsFor(
    amountMinor: Long,
    shares: List<ShareBps>,
): List<Pair<String, Long>> {
    if (shares.isEmpty()) return emptyList()
    val sorted = shares.sortedBy { it.userId }
    val parts = allocate(amountMinor, sorted.map { it.shareBps })
    return sorted.mapIndexed { i, share -> share.userId to parts[i] }
}

/** "50" or "33.33" for basis points. */
fun shareToInput(basisPoints: Long): String {
    val whole = basisPoints / 100
    val fraction = basisPoints % 100
    return when {
        fraction == 0L -> whole.toString()
        fraction % 10 == 0L -> "$whole.${fraction / 10}"
        else -> "$whole.${fraction.toString().padStart(2, '0')}"
    }
}

private val percent = Regex("^(\\d{1,3})(?:[.,](\\d{1,2}))?$")

/** Reads "50", "33.33" or "70 %" as basis points; null when it is not a percentage between 0 (excluded) and 100. */
fun parseSharePercent(input: String): Long? {
    val cleaned = input.trim().removeSuffix("%").trim()
    val match = percent.matchEntire(cleaned) ?: return null
    val (whole, fraction) = match.destructured
    val bps = whole.toLong() * 100 + fraction.padEnd(2, '0').ifEmpty { "0" }.toLong()
    return if (bps in 1..SHARE_BPS_TOTAL) bps else null
}

/** Percent texts that split 100% over the people as evenly as possible (the remainder goes to the first ones). */
fun equalShareInputs(userIds: List<String>): Map<String, String> {
    if (userIds.isEmpty()) return emptyMap()
    val parts = allocate(SHARE_BPS_TOTAL, userIds.map { 1L })
    return userIds.mapIndexed { i, id -> id to shareToInput(parts[i]) }.toMap()
}

/** The percent texts of the people of [userIds] for the stored shares; blank for a person without one. */
fun shareInputsOf(
    shares: List<ShareBps>,
    userIds: List<String>,
): Map<String, String> {
    val byUser = shares.associate { it.userId to it.shareBps }
    return userIds.associateWith { id -> byUser[id]?.let(::shareToInput) ?: "" }
}

/** The result of reading the percent texts of a custom split. */
data class CheckedShares(
    val items: List<ShareBps>,
    val totalBps: Long,
    /** The message to show under the shares; null when they are fine. */
    val error: String?,
)
