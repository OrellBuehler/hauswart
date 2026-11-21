package ch.orellbuehler.hauswart.feature.costsplit

import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.feature.costs.CheckedShares
import ch.orellbuehler.hauswart.feature.costs.PersonOption
import ch.orellbuehler.hauswart.feature.costs.SHARE_BPS_TOTAL
import ch.orellbuehler.hauswart.feature.costs.ShareBps
import ch.orellbuehler.hauswart.feature.costs.ShareLine
import ch.orellbuehler.hauswart.feature.costs.amountsFor
import ch.orellbuehler.hauswart.feature.costs.parseSharePercent
import ch.orellbuehler.hauswart.feature.costs.shareToInput
import ch.orellbuehler.hauswart.feature.costs.sharesFor
import ch.orellbuehler.hauswart.i18n.tr

private val zeroPercent = Regex("^(?:0+(?:[.,]0*)?|[.,]0+)\\s*%?$")

/** The people of [people] ticked in [participants], in the order of [people]. */
fun chosenParticipants(
    participants: List<String>,
    people: List<PersonOption>,
): List<String> = people.map { it.id }.filter { it in participants }

/** The people to send for an equal split: null for everybody (the server's own default) or nobody. */
fun narrowedParticipants(
    participants: List<String>,
    people: List<PersonOption>,
): List<String>? {
    val chosen = chosenParticipants(participants, people)
    return if (chosen.isNotEmpty() && chosen.size < people.size) chosen else null
}

/** Reads the percent texts of a custom split; people with a blank or zero text bear nothing. */
fun checkCustomShares(
    shares: Map<String, String>,
    people: List<PersonOption>,
): CheckedShares {
    val items = mutableListOf<ShareBps>()
    var invalid = false
    for (person in people) {
        val text = shares[person.id].orEmpty().trim()
        if (text.isEmpty() || zeroPercent.matches(text)) continue
        val bps = parseSharePercent(text)
        if (bps == null) invalid = true else items += ShareBps(person.id, bps)
    }
    val total = items.sumOf { it.shareBps }
    val error =
        when {
            invalid -> tr("cost_shares_invalid")
            items.isEmpty() -> tr("cost_shares_empty")
            total != SHARE_BPS_TOTAL -> tr("cost_shares_sum", "total" to shareToInput(total))
            else -> null
        }
    return CheckedShares(items, total, error)
}

/** "Summe: 100 %" or "Es fehlen noch 20 %". */
fun sharesStatusText(checked: CheckedShares): String =
    when {
        checked.error != null && checked.items.isNotEmpty() && checked.totalBps < SHARE_BPS_TOTAL ->
            tr("cost_shares_missing", "percent" to shareToInput(SHARE_BPS_TOTAL - checked.totalBps))
        checked.error != null && checked.totalBps > SHARE_BPS_TOTAL ->
            tr("cost_shares_over", "percent" to shareToInput(checked.totalBps - SHARE_BPS_TOTAL))
        checked.error != null -> checked.error
        else -> tr("cost_shares_total_ok")
    }

/** Each person's part of [amountMinor] as the server will book it; empty while the amount is not known. */
fun splitPreview(
    mode: String,
    amountMinor: Long?,
    currency: String,
    people: List<PersonOption>,
    participants: List<String>,
    checked: CheckedShares?,
): List<ShareLine> {
    if (amountMinor == null) return emptyList()
    val shares =
        when (mode) {
            "ownership" -> sharesFor("ownership", people)
            "equal" -> sharesFor("equal", people.filter { it.id in participants })
            "custom" -> checked?.items.orEmpty()
            else -> emptyList()
        }
    return amountsFor(amountMinor, shares).map { (userId, part) ->
        val bps = shares.first { it.userId == userId }.shareBps
        ShareLine(
            userId = userId,
            name = people.firstOrNull { it.id == userId }?.name ?: tr("cost_person_unknown"),
            percent = tr("cost_percent", "value" to shareToInput(bps)),
            amount = Money.format(part, currency),
        )
    }
}
