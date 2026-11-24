package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.ApiException
import ch.orellbuehler.hauswart.api.generated.FinanceMatchesResponseItemsItem
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.feature.inbox.hasFinanceConnection
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.CancellationException
import kotlin.math.abs

/** How far apart the bank's booking date and the entry's date may be (the server's rule). */
const val MATCH_DAYS = 3

/** How long a form waits after the last change before it asks for matching transactions. */
const val MATCH_DEBOUNCE_MS = 400L

/** The facts of the entry being typed that `GET /finance/matches` asks for. */
data class MatchQuery(
    val amountMinor: Long,
    val currency: String,
    val date: String,
) {
    internal val key: String get() = "$amountMinor|$currency|$date"
}

/** What to ask for, or null while the form does not know enough: a valid non-zero amount, a currency and a real date. */
internal fun matchQueryOf(
    amountMinor: Long?,
    currency: String,
    date: String,
): MatchQuery? {
    if (amountMinor == null || amountMinor == 0L) return null
    if (!isCurrencyCode(currency) || !Dates.isValid(date)) return null
    return MatchQuery(amountMinor, currency, date)
}

/** One transaction of the bank that may be the entry being typed. */
data class MatchView(
    val id: String,
    val title: String,
    /** "Gebucht am 12.11.2026, am selben Tag" */
    val booked: String,
    val amount: String,
    val chosen: Boolean,
    /** What a screen reader says for the row. */
    val label: String,
)

/** The "tie to a bank transaction" section of a form. */
data class MatchesView(
    val items: List<MatchView> = emptyList(),
    /** The matches could not be looked up. */
    val failed: Boolean = false,
    /** The choice was let go because amount or date moved away from the transaction. */
    val released: Boolean = false,
    val title: String = "",
    val description: String = "",
    val releasedNote: String = "",
    val retryLabel: String = "",
    /** Why the server refused the choice. */
    val error: String? = null,
) {
    /** The section is worth showing: matches to pick from, or a failed lookup to retry. */
    val visible: Boolean get() = items.isNotEmpty() || failed
}

/** The bank transaction as the bank wrote it, with the payee when that says more. */
internal fun matchTitle(match: FinanceMatchesResponseItemsItem): String {
    val title = match.payload.title
    val payee = match.payload.payee
    return if (!payee.isNullOrBlank() && !title.lowercase().contains(payee.lowercase())) "$title · $payee" else title
}

/** How the bank's booking date lies to the date of the entry, in words ("am selben Tag", "1 Tag später"). */
internal fun matchWhen(
    bookedOn: String,
    entryDate: String,
): String {
    val days = Dates.diffDays(entryDate, bookedOn)
    return when {
        days == 0 -> tr("match_same_day")
        days > 0 -> tr("match_days_later", "count" to days)
        else -> tr("match_days_earlier", "count" to -days)
    }
}

/** Whether the transaction still fits the entry as typed (the server's rule for listing and tying). */
internal fun matchFits(
    match: FinanceMatchesResponseItemsItem,
    query: MatchQuery,
): Boolean =
    match.payload.amountMinor == query.amountMinor &&
        match.payload.currency == query.currency &&
        abs(Dates.diffDays(query.date, match.payload.date)) <= MATCH_DAYS

/** The words for a refused bank transaction, or null when the failure is not about it. */
internal fun tieFailure(
    e: UiError,
    sent: Boolean,
): String? {
    if (!sent) return null
    return when {
        e.code == "invalid_request" && e.fields.containsKey("financeSuggestionId") -> tr("match_error_changed")
        e.code == "not_found" -> tr("match_error_gone")
        e.code == "conflict" && e.detailCode == "suggestion_decided" -> tr("match_error_decided")
        else -> null
    }
}

/**
 * The matching of a form with the person's pending bank transactions, shared by the full entry form and the quick
 * form: it knows whether a finance app is connected, asks `GET /finance/matches` for the entry as typed and keeps the
 * transaction the person chose, letting it go when amount or date move away from it.
 */
internal class BankMatching(
    private val app: HauswartApp,
) {
    /** Whether the entry may be tied to a transaction at all (a finance app is connected and the entry has no link yet). */
    var eligible: Boolean = false

    private var found: List<FinanceMatchesResponseItemsItem> = emptyList()
    private var asked: String = ""
    private var query: MatchQuery? = null
    private var chosen: String = ""
    private var failed = false
    private var released = false
    private var refusal: String? = null

    /** Whether the person has a working finance connection; one that cannot be read counts as none. */
    suspend fun connected(): Boolean =
        try {
            hasFinanceConnection(
                app.api.integrations
                    .integrationsList()
                    .items,
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            false
        }

    /**
     * Takes the entry as typed now. A choice that no longer fits it is let go. Returns whether the list has to be
     * asked for again.
     */
    fun ask(next: MatchQuery?): Boolean {
        val wanted = if (eligible) next else null
        query = wanted
        if (wanted == null) {
            found = emptyList()
            asked = ""
            failed = false
            chosen = ""
            return false
        }
        if (chosen.isNotEmpty() && found.none { it.id == chosen && matchFits(it, wanted) }) {
            chosen = ""
            released = true
        }
        return wanted.key != asked || failed
    }

    /** Asks the server for the transactions that fit the entry as typed. */
    suspend fun fetch() {
        val wanted = query ?: return
        found =
            app.api.finance
                .financeMatches(amountMinor = wanted.amountMinor, currency = wanted.currency, date = wanted.date)
                .items
        asked = wanted.key
        failed = false
        if (chosen.isNotEmpty() && found.none { it.id == chosen }) chosen = ""
    }

    /** The lookup failed: the section offers to try again. */
    fun fail() {
        found = emptyList()
        asked = ""
        failed = true
    }

    fun choose(id: String) {
        released = false
        refusal = null
        chosen = if (chosen == id) "" else id
    }

    /** The id to send with the entry: the chosen transaction while it fits the entry, else empty. */
    fun chosenFor(next: MatchQuery?): String {
        if (!eligible || next == null || chosen.isEmpty()) return ""
        return if (found.any { it.id == chosen && matchFits(it, next) }) chosen else ""
    }

    /** The server refused the transaction: let go of it and ask again. */
    fun refuse(message: String) {
        chosen = ""
        asked = ""
        refusal = message
    }

    fun view(): MatchesView {
        val wanted = query
        val fitting = if (wanted == null) emptyList() else found.filter { matchFits(it, wanted) }
        return MatchesView(
            items =
                fitting.map { m ->
                    val title = matchTitle(m)
                    MatchView(
                        id = m.id,
                        title = title,
                        booked =
                            tr(
                                "match_booked",
                                "date" to Dates.format(m.payload.date),
                                "when" to matchWhen(m.payload.date, wanted?.date ?: m.payload.date),
                            ),
                        amount = Money.format(m.payload.amountMinor, m.payload.currency),
                        chosen = m.id == chosen,
                        label = tr("match_choose", "title" to title),
                    )
                },
            failed = failed && wanted != null,
            released = released && chosen.isEmpty(),
            title = tr("match_title"),
            description = tr("match_description", "count" to fitting.size),
            releasedNote = tr("match_reset"),
            retryLabel = tr("common_retry"),
            error = refusal,
        )
    }
}
