package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.CostEntry
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.i18n.tr

/** A label and its value on the detail screen; [linkKind] (`asset`, `room`, `defect`) and [linkId] make it a link. */
data class CostFact(
    val label: String,
    val value: String,
    val linkKind: String? = null,
    val linkId: String? = null,
)

data class ShareLine(
    val userId: String,
    val name: String,
    val percent: String,
    val amount: String,
)

data class CostDetailView(
    val id: String,
    val title: String,
    val amount: String,
    val refund: Boolean,
    val category: String,
    val date: String,
    val badges: List<CostBadge>,
    val tags: List<TagView>,
    val facts: List<CostFact>,
    val splitTitle: String,
    val shares: List<ShareLine>,
    val sharesNote: String,
    val notes: String?,
    val reviewNeeded: Boolean,
    /** A fuel log entry booked this entry and deletes it with itself. */
    val fuelOwned: Boolean,
    val fuelHint: String?,
    val bookId: String,
    val assetId: String?,
)

data class CostDetailState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val cost: CostDetailView? = null,
    val reviewing: Boolean = false,
    val deleting: Boolean = false,
    /** A failed delete or review; the entry is still shown. */
    val actionError: UiError? = null,
    /** The message after the entry was marked as reviewed. */
    val reviewedMessage: String? = null,
    /** True once the entry is gone: the screen closes. */
    val deleted: Boolean = false,
)

class CostDetailStore(
    private val app: HauswartApp,
    private val id: String,
) : Store<CostDetailState>(CostDetailState()) {
    init {
        onChange(app, "costs") { if (!current.deleted) load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun markReviewed() {
        val cost = current.cost ?: return
        if (current.reviewing) return
        update { it.copy(reviewing = true, actionError = null) }
        launch({ e -> update { it.copy(reviewing = false, actionError = e) } }) {
            app.api.costs.costsReview(id)
            update { it.copy(reviewing = false, reviewedMessage = tr("cost_review_done_toast", "title" to cost.title)) }
            app.changed("costs")
        }
    }

    fun delete() {
        val cost = current.cost ?: return
        if (current.deleting || cost.fuelOwned) return
        update { it.copy(deleting = true, actionError = null) }
        launch({ e -> update { it.copy(deleting = false, actionError = e) } }) {
            app.api.costs.costsDelete(id)
            update { it.copy(deleting = false, deleted = true) }
            app.changed("costs")
        }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    fun dismissReviewedMessage() {
        update { it.copy(reviewedMessage = null) }
    }

    /** What the delete dialog says. */
    fun deleteText(): String = tr("cost_delete_description", "title" to (current.cost?.title ?: ""))

    private fun load() {
        update { it.copy(loading = it.cost == null, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val household = app.household.get()
            val entry = app.api.costs.costsGet(id)
            update { it.copy(loading = false, cost = detailView(entry, household.timezone)) }
        }
    }

    private fun detailView(
        entry: CostEntry,
        timeZone: String,
    ): CostDetailView {
        val facts = mutableListOf<CostFact>()
        facts += CostFact(tr("cost_book"), entry.bookName)
        facts += CostFact(tr("cost_paid_by"), entry.paidByName ?: tr("cost_payer_open"))
        entry.payee?.let { facts += CostFact(tr("cost_payee"), it) }
        entry.assetName?.let { facts += CostFact(tr("cost_asset"), it, "asset", entry.assetId) }
        entry.roomName?.let { facts += CostFact(tr("cost_room"), it, "room", entry.roomId) }
        if (entry.defectId != null) {
            facts += CostFact(tr("cost_defect"), "#${entry.defectNumber} ${entry.defectTitle ?: ""}".trim(), "defect", entry.defectId)
        }
        entry.serviceLogTitle?.let { facts += CostFact(tr("cost_service_entry"), it) }
        if (entry.bookTaxRelevant || entry.deductible != "unknown") {
            facts += CostFact(tr("cost_deductible"), costDeductibleLabel(entry.deductible))
        }
        facts += CostFact(tr("cost_counts_as_expense"), tr(if (entry.countsAsExpense) "common_yes" else "common_no"))
        facts +=
            CostFact(tr("cost_source"), if (entry.source in CostEntry.SOURCE_VALUES) tr("cost_source_${entry.source}") else entry.source)
        if (entry.financeLinked && entry.source != "finance_transaction" && entry.source != "finance_bill") {
            facts += CostFact(tr("cost_bank_linked"), tr("common_yes"))
        }
        if (entry.reviewedAt != null && !entry.reviewNeeded) {
            val by = app.household.memberName(entry.reviewedByUserId)
            facts +=
                CostFact(
                    tr("cost_reviewed"),
                    listOfNotNull(
                        Dates.dateTime(entry.reviewedAt, timeZone),
                        by?.let {
                            tr(
                                "cost_created_by",
                                "name" to it,
                            )
                        },
                    ).joinToString(" "),
                )
        }
        val creator = app.household.memberName(entry.createdBy)
        facts +=
            CostFact(
                tr("cost_created"),
                listOfNotNull(
                    Dates.dateTime(entry.createdAt, timeZone),
                    creator?.let { tr("cost_created_by", "name" to it) },
                ).joinToString(" "),
            )
        val row = rowView(entry, withBook = false)
        return CostDetailView(
            id = entry.id,
            title = entry.title,
            amount = Money.format(entry.amountMinor, entry.currency),
            refund = entry.amountMinor < 0,
            category = costCategoryLabel(entry.category),
            date = Dates.format(entry.date),
            badges = row.badges,
            tags = row.tags,
            facts = facts,
            splitTitle = costSplitLabel(entry.splitMode),
            shares =
                entry.shares.map {
                    ShareLine(
                        userId = it.userId,
                        name = it.userName ?: tr("cost_person_unknown"),
                        percent = tr("cost_percent", "value" to shareToInput(it.shareBps)),
                        amount = Money.format(it.amountMinor, entry.currency),
                    )
                },
            sharesNote = if (entry.shares.isEmpty()) tr("cost_shares_none") else tr("cost_shares_frozen"),
            notes = entry.notes?.takeIf { it.isNotBlank() },
            reviewNeeded = entry.reviewNeeded,
            fuelOwned = entry.fuelLogId != null,
            fuelHint = if (entry.fuelLogId != null) tr("cost_fuel_owned_delete_hint") else null,
            bookId = entry.bookId,
            assetId = entry.assetId,
        )
    }
}
