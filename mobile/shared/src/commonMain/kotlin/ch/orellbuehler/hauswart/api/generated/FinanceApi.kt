// Generated from docs/openapi.json by `bun run mobile:api`. Do not edit.
@file:OptIn(ExperimentalSerializationApi::class)

package ch.orellbuehler.hauswart.api.generated

import ch.orellbuehler.hauswart.api.ApiHttp
import ch.orellbuehler.hauswart.api.BinaryBody
import ch.orellbuehler.hauswart.api.Patch
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

class FinanceApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * Your suggestions from the connected finance app
     *
     * Costs, assets, bill tasks and links the finance provider offers, waiting for a decision (`status` defaults to `pending`). A `link` is a transaction that looks like a cost entry somebody booked by hand (same amount and currency, booked at most 3 days from the entry's date, similar payee or title, paid by you, not tied to a finance item yet; found when the transaction is offered or, when the transaction was waiting as a cost already, when such an entry is booked later): its payload carries the `entryId`, the `entry` as it is now (null if it was deleted) and the `transaction`. Accepting it ties the entry to the transaction instead of booking a second entry; dismissing it offers the transaction as a normal cost suggestion. Strictly your own: no other member sees them, and other members' suggestions are never listed or reachable by id.
     *
     * @param kind cost | bill_task | asset | link
     *
     * @param status pending | accepted | dismissed
     */
    suspend fun financeSuggestionsList(
        kind: String? = null,
        status: String? = null,
        cursor: String? = null,
        limit: Long? = null,
    ): FinanceSuggestionsListResponse =
        http.json("GET", "/api/v1/finance/suggestions", listOf("kind" to kind, "status" to status, "cursor" to cursor, "limit" to limit), FinanceSuggestionsListResponse.serializer())

    /**
     * Accept a suggestion
     *
     * Creates the cost entry (paid by you, in the book the body names with `bookId`, else the one offered with the suggestion (`payload.bookId`, set by the connection's settings) while it is open, else the default book; split as that book says unless the body says otherwise), the asset or the bill task. The body may override book, category, title, split (`participantIds` narrow an equal split), asset link and so on; fields of another kind are a 400. `tagIds` (a cost only) label the entry. `receiptTaskId` (a cost only) books the entry for a task of the receipt queue like `POST /costs` does; a task that is not waiting any more is a 409 and the suggestion stays pending. Accepting a `link` takes no body fields: the entry named in its payload remembers the transaction (so it is never booked twice and the finance app gets its back-link), nothing new is booked, and the answer's entity is that entry; 409 when the entry was deleted, is tied to a finance item already or no longer has the transaction's amount and currency (dismiss the link then). Accepting twice is a 409. A 409 carries `details.code` where it tells: `suggestion_decided` (accepted or dismissed already, or the transaction is booked), `entry_tied` (a link's entry is tied to a finance item already) or `receipt_task_closed`.
     */
    suspend fun financeSuggestionsAccept(
        id: String,
        body: FinanceSuggestionsAcceptRequest,
    ): FinanceSuggestionAccepted =
        http.json("POST", "/api/v1/finance/suggestions/${ApiHttp.segment(id)}/accept", emptyList(), FinanceSuggestionsAcceptRequest.serializer(), body, FinanceSuggestionAccepted.serializer())

    /**
     * Dismiss a suggestion
     *
     * A dismissed suggestion is never offered again, except a `link`: dismissing it means "not that entry", so its transaction comes back as a normal cost suggestion. Dismissing an accepted one is a 409 with `details.code` `suggestion_decided`.
     */
    suspend fun financeSuggestionsDismiss(
        id: String,
    ): FinanceSuggestion =
        http.json("POST", "/api/v1/finance/suggestions/${ApiHttp.segment(id)}/dismiss", emptyList(), FinanceSuggestion.serializer())

    /**
     * Your pending cost suggestions that match an entry being typed
     *
     * For the cost form: `amountMinor` (signed like `POST /costs`), `currency` (default: the household's) and `date` of the entry being typed. Answers your own pending cost suggestions from the finance app with the same amount and currency booked at most 3 days from `date`, nearest date first (at most 20), so the form can offer "tie to bank transaction"; send the chosen id as `financeSuggestionId` to `POST /costs` or `PATCH /costs/{id}`. Strictly your own.
     */
    suspend fun financeMatches(
        amountMinor: Long,
        currency: String? = null,
        date: String,
    ): FinanceMatchesResponse =
        http.json("GET", "/api/v1/finance/matches", listOf("amountMinor" to amountMinor, "currency" to currency, "date" to date), FinanceMatchesResponse.serializer())

    /**
     * Sync your finance connection now
     *
     * Runs one sync of your own connection (404 without one). A provider that cannot be reached is a normal answer (`ok: false` with an error code), not an HTTP error.
     */
    suspend fun financeSync(): FinanceSync =
        http.json("POST", "/api/v1/finance/sync", emptyList(), FinanceSync.serializer())
}

@Serializable
data class FinanceSuggestionsListResponse(
    val items: List<FinanceSuggestion>,
    val nextCursor: String?,
)

@Serializable
data class FinanceSuggestionsAcceptRequestSharesItem(
    val userId: String,
    val shareBps: Long,
)

@Serializable
data class FinanceSuggestionsAcceptRequest(
    val title: String? = null,
    val bookId: String? = null,
    /** repair | utilities | renewal_fund | purchase | mortgage_interest | mortgage_principal | insurance | renovation | maintenance | fuel | taxes_fees | groceries | household | dining | leisure | travel | health | gifts | transport | subscriptions | other */
    val category: String? = null,
    val notes: String? = null,
    val assetId: String? = null,
    val roomId: String? = null,
    val defectId: String? = null,
    val serviceLogId: String? = null,
    val paidByUserId: String? = null,
    /** ownership | equal | custom | none */
    val splitMode: String? = null,
    val shares: List<FinanceSuggestionsAcceptRequestSharesItem>? = null,
    val participantIds: List<String>? = null,
    val countsAsExpense: Boolean? = null,
    /** unknown | maintenance | investment | no */
    val deductible: String? = null,
    val tagIds: List<String>? = null,
    val receiptTaskId: String? = null,
    val name: String? = null,
    /** device | plant | fixture | vehicle | other */
    val assetKind: String? = null,
) {
    companion object {
        val CATEGORY_VALUES: List<String> = listOf("repair", "utilities", "renewal_fund", "purchase", "mortgage_interest", "mortgage_principal", "insurance", "renovation", "maintenance", "fuel", "taxes_fees", "groceries", "household", "dining", "leisure", "travel", "health", "gifts", "transport", "subscriptions", "other")
        val SPLIT_MODE_VALUES: List<String> = listOf("ownership", "equal", "custom", "none")
        val DEDUCTIBLE_VALUES: List<String> = listOf("unknown", "maintenance", "investment", "no")
        val ASSET_KIND_VALUES: List<String> = listOf("device", "plant", "fixture", "vehicle", "other")
    }
}

@Serializable
data class FinanceMatchesResponseItemsItem(
    val id: String,
    /** pending | accepted | dismissed */
    val status: String,
    val acceptedEntityId: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
    @EncodeDefault val kind: String = "cost",
    val payload: FinanceSuggestionCostPayload,
) {
    companion object {
        val STATUS_VALUES: List<String> = listOf("pending", "accepted", "dismissed")
    }
}

@Serializable
data class FinanceMatchesResponse(
    val items: List<FinanceMatchesResponseItemsItem>,
)
