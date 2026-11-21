package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.i18n.tr
import kotlin.math.abs
import kotlin.random.Random

internal data class ParsedAmount(
    val minor: Long?,
    val error: String?,
)

private val currencyCode = Regex("^[A-Z]{3}$")

fun isCurrencyCode(currency: String): Boolean = currencyCode.matches(currency)

/** A currency as typed: upper case letters only, at most three. */
fun cleanCurrency(text: String): String = text.uppercase().filter { it in 'A'..'Z' }.take(3)

/** A typed amount with the separator left dangling ("12." or "12,") is read as the whole number. */
fun cleanAmount(text: String): String = text.trim().replace(Regex("[.,]$"), "")

/**
 * The signed amount in minor units of a typed [text]: a refund is negative, and so is anything typed with a minus. A
 * payment is always positive ([positiveOnly]): who paid whom says the direction.
 */
internal fun parseAmountText(
    text: String,
    currency: String,
    refund: Boolean = false,
    positiveOnly: Boolean = false,
): ParsedAmount {
    if (!isCurrencyCode(currency)) return ParsedAmount(null, tr("cost_amount_needs_currency"))
    val cleaned = cleanAmount(text)
    if (cleaned.isEmpty()) return ParsedAmount(null, tr("m_field_required"))
    val value =
        Money.parse(cleaned, currency)
            ?: return ParsedAmount(null, tr("cost_amount_invalid", "decimals" to Money.exponent(currency)))
    if (positiveOnly) {
        if (value <= 0) return ParsedAmount(null, tr("settlement_amount_positive"))
    } else if (value == 0L) {
        return ParsedAmount(null, tr("cost_amount_zero"))
    }
    if (abs(value) > MAX_COST_MINOR) {
        return ParsedAmount(null, tr("cost_amount_too_large", "max" to Money.format(MAX_COST_MINOR, currency)))
    }
    return ParsedAmount(if (refund) -abs(value) else value, null)
}

/** The text a person edits for an amount: "1234.50" (the sign is the refund switch). */
internal fun amountInput(
    minor: Long,
    currency: String,
): String = Money.toInput(abs(minor), currency)

/** A key that names one draft: the same save sent again returns the entry the first one booked. */
internal fun newIdempotencyKey(): String =
    buildString {
        repeat(3) {
            append(
                Random
                    .nextLong()
                    .toULong()
                    .toString(16)
                    .padStart(16, '0'),
            )
        }
    }
