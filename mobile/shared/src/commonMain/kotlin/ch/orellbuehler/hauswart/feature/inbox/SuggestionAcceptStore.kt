package ch.orellbuehler.hauswart.feature.inbox

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.CostBook
import ch.orellbuehler.hauswart.api.generated.FinanceSuggestion
import ch.orellbuehler.hauswart.api.generated.FinanceSuggestionsAcceptRequest
import ch.orellbuehler.hauswart.api.generated.FinanceSuggestionsAcceptRequestSharesItem
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.feature.costs.BookOption
import ch.orellbuehler.hauswart.feature.costs.COST_DEDUCTIBLES
import ch.orellbuehler.hauswart.feature.costs.COST_SPLIT_MODES
import ch.orellbuehler.hauswart.feature.costs.COST_TITLE_MAX
import ch.orellbuehler.hauswart.feature.costs.CostOption
import ch.orellbuehler.hauswart.feature.costs.PersonOption
import ch.orellbuehler.hauswart.feature.costs.ShareLine
import ch.orellbuehler.hauswart.feature.costs.TagOption
import ch.orellbuehler.hauswart.feature.costs.bookOptionOf
import ch.orellbuehler.hauswart.feature.costs.costCategoryOptions
import ch.orellbuehler.hauswart.feature.costs.costDeductibleLabel
import ch.orellbuehler.hauswart.feature.costs.costSplitHint
import ch.orellbuehler.hauswart.feature.costs.costSplitLabel
import ch.orellbuehler.hauswart.feature.costs.countsAsExpenseByDefault
import ch.orellbuehler.hauswart.feature.costs.defaultBook
import ch.orellbuehler.hauswart.feature.costs.equalShareInputs
import ch.orellbuehler.hauswart.feature.costs.openBooks
import ch.orellbuehler.hauswart.feature.costsplit.checkCustomShares
import ch.orellbuehler.hauswart.feature.costsplit.chosenParticipants
import ch.orellbuehler.hauswart.feature.costsplit.narrowedParticipants
import ch.orellbuehler.hauswart.feature.costsplit.sharesStatusText
import ch.orellbuehler.hauswart.feature.costsplit.splitPreview
import ch.orellbuehler.hauswart.feature.inventory.assetKindLabel
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

const val ACCEPT_MAX_TAGS = 10

private val ASSET_KINDS_OFFERED: List<String> = FinanceSuggestionsAcceptRequest.ASSET_KIND_VALUES

/** What the adjust form holds, as typed; the fields that do not belong to the suggestion's kind are ignored. */
data class AcceptForm(
    val title: String = "",
    val bookId: String = "",
    val category: String = "other",
    val paidByUserId: String = "",
    val assetId: String = "",
    val roomId: String = "",
    val notes: String = "",
    val splitMode: String = "ownership",
    val splitTouched: Boolean = false,
    val participants: List<String> = emptyList(),
    val shares: Map<String, String> = emptyMap(),
    val countsAsExpense: Boolean = true,
    val countsTouched: Boolean = false,
    val deductible: String = "unknown",
    val tagIds: List<String> = emptyList(),
    val assetKind: String = "device",
)

data class AcceptFormView(
    val taxClassApplies: Boolean,
    val showParticipants: Boolean,
    val showShares: Boolean,
    val splitHint: String,
    val preview: List<ShareLine>,
    val sharesStatus: String?,
    val sharesOk: Boolean,
)

data class AcceptState(
    val loading: Boolean = true,
    val loadError: UiError? = null,
    /** `cost`, `asset` or `bill_task`; empty until loaded. */
    val kind: String = "",
    val dialogTitle: String = "",
    val submitLabel: String = "",
    /** Date, amount and payee of what is offered. */
    val facts: String = "",
    val titleLabel: String = "",
    val initial: AcceptForm? = null,
    val books: List<BookOption> = emptyList(),
    val people: List<PersonOption> = emptyList(),
    val assets: List<CostOption> = emptyList(),
    val rooms: List<CostOption> = emptyList(),
    val tags: List<TagOption> = emptyList(),
    val categories: List<CostOption> = emptyList(),
    val splitModes: List<CostOption> = emptyList(),
    val deductibles: List<CostOption> = emptyList(),
    val assetKinds: List<CostOption> = emptyList(),
    val saving: Boolean = false,
    val error: String? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    /** Set once the suggestion was accepted; the screen closes. */
    val done: InboxNotice? = null,
)

/** Accepts one suggestion of the finance app with changes. */
class SuggestionAcceptStore(
    private val app: HauswartApp,
    private val id: String,
) : Store<AcceptState>(AcceptState()) {
    private var suggestion: FinanceSuggestion? = null
    private var books: List<CostBook> = emptyList()
    private var people: List<PersonOption> = emptyList()

    init {
        load()
    }

    fun retry() {
        load()
    }

    fun withBook(
        form: AcceptForm,
        bookId: String,
    ): AcceptForm {
        val book = books.firstOrNull { it.id == bookId } ?: return form
        return form.copy(bookId = book.id, splitMode = if (form.splitTouched) form.splitMode else book.defaultSplitMode)
    }

    fun withCategory(
        form: AcceptForm,
        category: String,
    ): AcceptForm =
        form.copy(
            category = category,
            countsAsExpense = if (form.countsTouched) form.countsAsExpense else countsAsExpenseByDefault(category),
        )

    fun withCounts(
        form: AcceptForm,
        counts: Boolean,
    ): AcceptForm = form.copy(countsAsExpense = counts, countsTouched = true)

    fun withSplitMode(
        form: AcceptForm,
        mode: String,
    ): AcceptForm = form.copy(splitMode = mode, splitTouched = true)

    fun toggleParticipant(
        form: AcceptForm,
        userId: String,
    ): AcceptForm = form.copy(participants = if (userId in form.participants) form.participants - userId else form.participants + userId)

    fun withShare(
        form: AcceptForm,
        userId: String,
        percent: String,
    ): AcceptForm = form.copy(shares = form.shares + (userId to percent))

    fun equalizeShares(form: AcceptForm): AcceptForm = form.copy(shares = equalShareInputs(people.map { it.id }))

    fun toggleTag(
        form: AcceptForm,
        tagId: String,
    ): AcceptForm {
        if (tagId in form.tagIds) return form.copy(tagIds = form.tagIds - tagId)
        return if (form.tagIds.size >= ACCEPT_MAX_TAGS) form else form.copy(tagIds = form.tagIds + tagId)
    }

    fun view(form: AcceptForm): AcceptFormView {
        val book = books.firstOrNull { it.id == form.bookId }
        val offered = suggestion as? FinanceSuggestion.Cost
        val checked = if (form.splitMode == "custom") checkCustomShares(form.shares, people) else null
        return AcceptFormView(
            taxClassApplies = book?.taxRelevant ?: true,
            showParticipants = form.splitMode == "equal",
            showShares = form.splitMode == "custom",
            splitHint =
                if (form.splitMode == "equal" && form.participants.size == people.size) {
                    tr("cost_split_equal_everyone_hint")
                } else {
                    costSplitHint(form.splitMode)
                },
            preview =
                splitPreview(
                    form.splitMode,
                    offered?.payload?.amountMinor,
                    offered?.payload?.currency ?: "",
                    people,
                    form.participants,
                    checked,
                ),
            sharesStatus = checked?.let(::sharesStatusText),
            sharesOk = checked != null && checked.error == null,
        )
    }

    fun save(form: AcceptForm) {
        if (current.saving) return
        val s = suggestion ?: return
        val title = form.title.trim()
        if (title.isEmpty()) {
            update { it.copy(fieldErrors = mapOf("title" to tr("m_field_required")), error = null) }
            return
        }
        if (title.length > COST_TITLE_MAX) {
            update { it.copy(fieldErrors = mapOf("title" to tr("field_too_long", "max" to COST_TITLE_MAX)), error = null) }
            return
        }
        val body = body(s, form, title) ?: return
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e -> failed(e, s) }) {
            val result = app.api.finance.financeSuggestionsAccept(id, body)
            val key =
                when (result.entity.type) {
                    "cost" -> "finance_accepted_cost_toast"
                    "asset" -> "finance_accepted_asset_toast"
                    else -> "finance_accepted_bill_task_toast"
                }
            update {
                it.copy(
                    saving = false,
                    done = InboxNotice(tr(key, "title" to title), result.entity.type, result.entity.id),
                )
            }
            app.changed("costs", "assets", "tasks")
        }
    }

    private fun failed(
        e: UiError,
        s: FinanceSuggestion,
    ) {
        val conflict = e.code == "conflict"
        val text =
            if (conflict) tr(if (s is FinanceSuggestion.Link) "finance_link_conflict" else "finance_conflict") else e.message
        update { it.copy(saving = false, error = if (e.fields.isEmpty()) text else null, fieldErrors = e.fields) }
        if (conflict) app.changed("costs")
    }

    /** The request with only what the person changed; null (with the errors shown) when the form does not hold together. */
    private fun body(
        s: FinanceSuggestion,
        form: AcceptForm,
        title: String,
    ): FinanceSuggestionsAcceptRequest? =
        when (s) {
            is FinanceSuggestion.BillTask ->
                FinanceSuggestionsAcceptRequest(title = title.takeIf { it != s.payload.title })
            is FinanceSuggestion.Asset ->
                FinanceSuggestionsAcceptRequest(
                    name = title.takeIf { it != s.payload.name },
                    assetKind = form.assetKind.takeIf { it != "device" },
                    roomId = form.roomId.ifEmpty { null },
                )
            is FinanceSuggestion.Cost -> costBody(s, form, title)
            else -> FinanceSuggestionsAcceptRequest()
        }

    private fun costBody(
        s: FinanceSuggestion.Cost,
        form: AcceptForm,
        title: String,
    ): FinanceSuggestionsAcceptRequest? {
        val cost = s.payload
        var mode: String? = null
        var participantIds: List<String>? = null
        var shares: List<FinanceSuggestionsAcceptRequestSharesItem>? = null
        val book = books.firstOrNull { it.id == form.bookId }
        val bookSplit = book?.defaultSplitMode ?: "ownership"
        if (form.splitMode != bookSplit) mode = form.splitMode
        if (form.splitMode == "equal") {
            if (chosenParticipants(form.participants, people).isEmpty()) {
                update { it.copy(fieldErrors = mapOf("participantIds" to tr("cost_for_whom_none")), error = null) }
                return null
            }
            val narrowed = narrowedParticipants(form.participants, people)
            if (narrowed != null) {
                mode = "equal"
                participantIds = narrowed
            }
        }
        if (form.splitMode == "custom") {
            val checked = checkCustomShares(form.shares, people)
            if (checked.error != null) {
                update { it.copy(fieldErrors = mapOf("shares" to checked.error), error = null) }
                return null
            }
            shares = checked.items.map { FinanceSuggestionsAcceptRequestSharesItem(it.userId, it.shareBps) }
        }
        val me = app.session.user?.id
        val defaultPayer = if (me != null && people.any { it.id == me }) me else ""
        val offeredBook = acceptBook(cost.bookId)
        return FinanceSuggestionsAcceptRequest(
            title = title.takeIf { it != cost.title },
            bookId = form.bookId.takeIf { it.isNotEmpty() && it != offeredBook?.id },
            category = form.category.takeIf { it != cost.category },
            notes = form.notes.trim().ifEmpty { null },
            assetId = form.assetId.takeIf { it != (cost.assetId ?: "") }?.ifEmpty { null },
            roomId = form.roomId.ifEmpty { null },
            paidByUserId = form.paidByUserId.takeIf { it != defaultPayer }?.ifEmpty { null },
            splitMode = mode,
            shares = shares,
            participantIds = participantIds,
            countsAsExpense = form.countsAsExpense.takeIf { form.countsTouched || form.category != cost.category },
            deductible = form.deductible.takeIf { (book?.taxRelevant ?: true) && it != "unknown" },
            tagIds = form.tagIds.takeIf { it.isNotEmpty() },
        )
    }

    private fun acceptBook(offered: String?): CostBook? = openBooks(books).firstOrNull { it.id == offered } ?: defaultBook(books)

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val loaded =
                coroutineScope {
                    val suggestions =
                        async {
                            fetchAll { cursor ->
                                val page = app.api.finance.financeSuggestionsList(status = "pending", limit = 200, cursor = cursor)
                                page.items to page.nextCursor
                            }
                        }
                    val bookList =
                        async {
                            fetchAll { cursor ->
                                val page = app.api.costs.costBooksList(cursor = cursor, limit = 200, includeArchived = true)
                                page.items to page.nextCursor
                            }
                        }
                    val directory = async { app.api.users.usersDirectory() }
                    val tagList = async { app.api.costs.costTagsList() }
                    val assetList =
                        async {
                            fetchAll { cursor ->
                                val page = app.api.assets.assetsList(cursor = cursor, limit = 200)
                                page.items to page.nextCursor
                            }
                        }
                    val roomList =
                        async {
                            fetchAll { cursor ->
                                val page = app.api.rooms.roomsList(cursor = cursor, limit = 200)
                                page.items to page.nextCursor
                            }
                        }
                    Loaded(
                        suggestions.await().firstOrNull { idOf(it) == id },
                        bookList.await(),
                        directory.await().items.map { PersonOption(it.id, it.displayName, it.ownershipBps) },
                        tagList.await().items.map { TagOption(it.id, it.name, it.color) },
                        assetList.await().map { a -> CostOption(a.id, if (a.roomName != null) "${a.name} (${a.roomName})" else a.name) },
                        roomList.await().map { r -> CostOption(r.id, r.name) },
                    )
                }
            val found = loaded.suggestion
            if (found == null || found is FinanceSuggestion.Link || found is FinanceSuggestion.Unknown) {
                update { it.copy(loading = false, loadError = UiError(tr("m_error_not_found"), "not_found")) }
                return@launch
            }
            suggestion = found
            books = loaded.books
            people = loaded.people
            val userIds = people.map { it.id }
            val me = app.session.user?.id
            val offeredBook = (found as? FinanceSuggestion.Cost)?.payload?.bookId
            val book = acceptBook(offeredBook)
            val cost = (found as? FinanceSuggestion.Cost)?.payload
            val form =
                AcceptForm(
                    title = titleOf(found),
                    bookId = book?.id ?: "",
                    category = cost?.category ?: "other",
                    paidByUserId = if (me != null && me in userIds) me else "",
                    assetId = cost?.assetId ?: "",
                    splitMode = book?.defaultSplitMode ?: "ownership",
                    participants = userIds,
                    shares = equalShareInputs(userIds),
                    countsAsExpense = countsAsExpenseByDefault(cost?.category ?: "other"),
                )
            val facts =
                when (found) {
                    is FinanceSuggestion.Cost ->
                        listOfNotNull(
                            Dates.format(found.payload.date),
                            Money.format(found.payload.amountMinor, found.payload.currency),
                            found.payload.payee,
                        )
                    is FinanceSuggestion.Asset ->
                        listOf(Dates.format(found.payload.purchaseDate), Money.format(found.payload.priceMinor, found.payload.currency))
                    is FinanceSuggestion.BillTask ->
                        listOfNotNull(
                            Dates.format(found.payload.dueDate),
                            found.payload.amountMinor?.let { Money.format(it, found.payload.currency) },
                        )
                    else -> emptyList()
                }
            val kind = kindOf(found)
            update {
                it.copy(
                    loading = false,
                    kind = kind,
                    dialogTitle =
                        tr(
                            when (kind) {
                                "cost" -> "finance_accept_cost_title"
                                "asset" -> "finance_accept_asset_title"
                                else -> "finance_accept_bill_task_title"
                            },
                        ),
                    submitLabel =
                        tr(
                            when (kind) {
                                "cost" -> "finance_accept_cost"
                                "asset" -> "finance_accept_asset"
                                else -> "finance_accept_bill_task"
                            },
                        ),
                    facts = facts.joinToString(" · "),
                    titleLabel = tr(if (kind == "asset") "asset_name" else "cost_title"),
                    initial = form,
                    books = openBooks(books).map(::bookOptionOf),
                    people = people,
                    assets = loaded.assets,
                    rooms = loaded.rooms,
                    tags = loaded.tags,
                    categories = costCategoryOptions(),
                    splitModes = COST_SPLIT_MODES.map { m -> CostOption(m, costSplitLabel(m)) },
                    deductibles = COST_DEDUCTIBLES.map { d -> CostOption(d, costDeductibleLabel(d)) },
                    assetKinds = ASSET_KINDS_OFFERED.map { k -> CostOption(k, assetKindLabel(k)) },
                )
            }
        }
    }

    private class Loaded(
        val suggestion: FinanceSuggestion?,
        val books: List<CostBook>,
        val people: List<PersonOption>,
        val tags: List<TagOption>,
        val assets: List<CostOption>,
        val rooms: List<CostOption>,
    )
}
