package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.api.generated.CostBalances
import ch.orellbuehler.hauswart.api.generated.DashboardBalancesSuggestedPaymentsItem
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.feature.dashboard.TONE_MUTED
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OK
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OVERDUE
import ch.orellbuehler.hauswart.i18n.tr
import kotlin.math.abs

/** A line of text and the tone (`ok`, `overdue`, `muted`) it is shown in. */
data class ToneText(
    val text: String,
    val tone: String,
)

const val BALANCE_EMPTY = "empty"
const val BALANCE_SQUARE = "square"
const val BALANCE_OPEN = "open"

fun personName(name: String?): String = name ?: tr("cost_person_unknown")

/** "bekommt CHF 25.00", "schuldet CHF 12.50" or "ausgeglichen": a person's balance in a few words. */
fun balanceWording(
    balanceMinor: Long,
    currency: String,
): ToneText {
    val amount = Money.format(abs(balanceMinor), currency)
    return when {
        balanceMinor > 0 -> ToneText(tr("balances_gets", "amount" to amount), TONE_OK)
        balanceMinor < 0 -> ToneText(tr("balances_owes", "amount" to amount), TONE_OVERDUE)
        else -> ToneText(tr("balances_even"), TONE_MUTED)
    }
}

/** The same for the person looking: "Du bekommst CHF 25.00". */
fun youWording(
    balanceMinor: Long,
    currency: String,
): ToneText {
    val amount = Money.format(abs(balanceMinor), currency)
    return when {
        balanceMinor > 0 -> ToneText(tr("balances_you_get", "amount" to amount), TONE_OK)
        balanceMinor < 0 -> ToneText(tr("balances_you_owe", "amount" to amount), TONE_OVERDUE)
        else -> ToneText(tr("balances_you_even"), TONE_MUTED)
    }
}

/** "Anna schuldet Ben CHF 12.50". */
fun paymentSentence(
    payment: DashboardBalancesSuggestedPaymentsItem,
    currency: String,
): String =
    tr(
        "balances_owes_sentence",
        "from" to personName(payment.fromName),
        "to" to personName(payment.toName),
        "amount" to Money.format(payment.amountMinor, currency),
    )

/** [BALANCE_EMPTY]: nothing to settle yet, [BALANCE_SQUARE]: everything is even, [BALANCE_OPEN]: somebody owes somebody. */
fun balanceState(balances: CostBalances): String {
    if (balances.suggestedPayments.isNotEmpty()) return BALANCE_OPEN
    val activity =
        balances.people.any { it.paidMinor != 0L || it.shareMinor != 0L || it.sentMinor != 0L || it.receivedMinor != 0L }
    return if (activity) BALANCE_SQUARE else BALANCE_EMPTY
}

/** The line for the person looking; null before anything happened or when they are not among the people. */
fun viewerLine(
    balances: CostBalances,
    userId: String?,
): ToneText? {
    val person = balances.people.firstOrNull { it.userId == userId } ?: return null
    if (balanceState(balances) == BALANCE_EMPTY) return null
    return youWording(person.balanceMinor, balances.currency)
}

/** The note about recorded payments across all books that a single book's balances leave out; null when there are none. */
fun crossBookNote(balances: CostBalances): String? {
    val cross = balances.crossBookSettlements ?: return null
    if (cross.count <= 0) return null
    return tr("balances_cross_book", "count" to cross.count, "amount" to Money.format(cross.totalMinor, balances.currency))
}
