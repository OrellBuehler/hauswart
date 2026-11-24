package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.testing.TestApp

private fun String?.json(): String = if (this == null) "null" else "\"$this\""

private const val EQUAL_SHARES =
    """[{"userId":"u1","userName":"Anna","shareBps":5000,"amountMinor":2125},
        {"userId":"u2","userName":"Ben","shareBps":5000,"amountMinor":2125}]"""

internal fun costEntry(
    id: String,
    title: String = "Wocheneinkauf",
    date: String = "2026-11-12",
    amountMinor: Long = 4250,
    category: String = "groceries",
    bookId: String = "b1",
    bookName: String = "Haushalt",
    paidBy: String? = "u1",
    paidByName: String? = "Anna",
    splitMode: String = "equal",
    shares: String = EQUAL_SHARES,
    payee: String? = null,
    notes: String? = null,
    reviewNeeded: Boolean = false,
    countsAsExpense: Boolean = true,
    source: String = "manual",
    fuelLogId: String? = null,
    assetId: String? = null,
    assetName: String? = null,
    tags: String = "[]",
    currency: String = "CHF",
    deductible: String = "unknown",
    taxRelevant: Boolean = false,
): String =
    """{"id":"$id","bookId":"$bookId","bookName":"$bookName","bookTaxRelevant":$taxRelevant,"date":"$date","title":"$title",
        "amountMinor":$amountMinor,"currency":"$currency","category":"$category","assetId":${assetId.json()},"assetName":${assetName.json()},
        "roomId":null,"roomName":null,"defectId":null,"defectNumber":null,"defectTitle":null,"serviceLogId":null,"serviceLogTitle":null,
        "payee":${payee.json()},"notes":${notes.json()},"paidByUserId":${paidBy.json()},"paidByName":${paidByName.json()},
        "splitMode":"$splitMode","shares":$shares,"tags":$tags,"countsAsExpense":$countsAsExpense,"deductible":"$deductible",
        "source":"$source","providerUrl":null,"fuelLogId":${fuelLogId.json()},"reviewNeeded":$reviewNeeded,"reviewedAt":null,
        "reviewedByUserId":null,"receiptTaskId":null,"financeLinked":false,"recurrenceId":null,"commentCount":0,"createdBy":"u1",
        "createdAt":"2026-11-12T10:00:00.000Z","updatedAt":"2026-11-12T10:00:00.000Z"}"""

internal fun costBook(
    id: String,
    name: String,
    split: String = "equal",
    isDefault: Boolean = false,
    archived: Boolean = false,
    taxRelevant: Boolean = false,
    entryCount: Int = 3,
): String =
    """{"id":"$id","name":"$name","slug":"${name.lowercase()}","icon":null,"defaultSplitMode":"$split","taxRelevant":$taxRelevant,
        "archivedAt":${if (archived) "\"2026-01-01T00:00:00.000Z\"" else "null"},"sortOrder":0,"isDefault":$isDefault,
        "entryCount":$entryCount,"settlementCount":0,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

internal fun page(vararg items: String) = """{"items":[${items.joinToString(",")}],"nextCursor":null}"""

internal fun summary(
    year: Int = 2026,
    expenseTotalMinor: Long = 12300,
    reviewNeededCount: Int = 0,
    equityTotalMinor: Long = 0,
    otherCurrencyCount: Int = 0,
): String =
    """{"year":$year,"currency":"CHF","otherCurrencyCount":$otherCurrencyCount,"expenseTotalMinor":$expenseTotalMinor,
        "equityTotalMinor":$equityTotalMinor,"byCategory":[],"byMonth":[{"month":"2026-11","totalMinor":$expenseTotalMinor,"count":3}],
        "byAsset":[],"byDeductible":[],"people":[],"settlement":[],"unassignedPayerCount":0,"reviewNeededCount":$reviewNeededCount}"""

/** Anna owes nobody; Ben owes Anna 21.25. */
internal fun balances(
    withPayment: Boolean = true,
    bookJson: String = "null",
    cross: String = "null",
): String =
    """{"book":$bookJson,"currency":"CHF","otherCurrencyCount":0,"unassignedPayerCount":0,
        "people":[{"userId":"u1","userName":"Anna","paidMinor":4250,"shareMinor":2125,"sentMinor":0,"receivedMinor":0,"balanceMinor":${if (withPayment) 2125 else 0}},
                  {"userId":"u2","userName":"Ben","paidMinor":0,"shareMinor":2125,"sentMinor":0,"receivedMinor":0,"balanceMinor":${if (withPayment) -2125 else 0}}],
        "crossBookSettlements":$cross,
        "suggestedPayments":${if (withPayment) """[{"fromUserId":"u2","fromName":"Ben","toUserId":"u1","toName":"Anna","amountMinor":2125}]""" else "[]"}}"""

internal fun settlement(
    id: String,
    amountMinor: Long = 2125,
    bookId: String? = "b1",
    note: String? = null,
): String =
    """{"id":"$id","bookId":${bookId.json()},"bookName":${if (bookId == null) "null" else "\"Haushalt\""},"fromUserId":"u2","fromName":"Ben",
        "toUserId":"u1","toName":"Anna","amountMinor":$amountMinor,"currency":"CHF","date":"2026-11-10","note":${note.json()},
        "createdBy":"u2","createdAt":"2026-11-10T10:00:00.000Z","updatedAt":"2026-11-10T10:00:00.000Z"}"""

/** A household of Anna (u1, signed in) and Ben (u2) with two books: Haushalt (default, equal) and Wohnung (ownership, tax relevant). */
internal fun TestApp.costsHousehold() {
    household()
    on(
        "GET",
        "/api/v1/users/directory",
        """{"items":[{"id":"u1","displayName":"Anna","ownershipBps":6000},{"id":"u2","displayName":"Ben","ownershipBps":4000}],"nextCursor":null}""",
    )
    on(
        "GET",
        "/api/v1/cost-books",
        page(
            costBook("b1", "Haushalt", isDefault = true),
            costBook("b2", "Wohnung", split = "ownership", taxRelevant = true),
        ),
    )
}
