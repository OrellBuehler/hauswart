package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.Patch
import ch.orellbuehler.hauswart.api.generated.Asset
import ch.orellbuehler.hauswart.api.generated.CostBook
import ch.orellbuehler.hauswart.api.generated.CostEntry
import ch.orellbuehler.hauswart.api.generated.CostTag
import ch.orellbuehler.hauswart.api.generated.CostsCreateRequest
import ch.orellbuehler.hauswart.api.generated.CostsCreateRequestSharesItem
import ch.orellbuehler.hauswart.api.generated.CostsUpdateRequest
import ch.orellbuehler.hauswart.api.generated.CostsUpdateRequestSharesItem
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay

/** What the full entry form holds: every field as the person typed it. */
data class CostForm(
    val bookId: String = "",
    val title: String = "",
    /** The amount as typed; the sign comes from [refund]. */
    val amount: String = "",
    val refund: Boolean = false,
    val currency: String = "",
    val date: String = "",
    val category: String = "other",
    val assetId: String = "",
    val payee: String = "",
    val notes: String = "",
    val paidByUserId: String = "",
    val splitMode: String = "ownership",
    /** The person chose the split by hand, so picking another book no longer changes it. */
    val splitTouched: Boolean = false,
    /** Who shares an equal split (user ids). */
    val participants: List<String> = emptyList(),
    /** Percent as typed per user id for a custom split; blank or 0 means the person bears nothing. */
    val shares: Map<String, String> = emptyMap(),
    val countsAsExpense: Boolean = true,
    /** The switch was set by hand, so a category change no longer moves it. */
    val countsTouched: Boolean = false,
    val deductible: String = "unknown",
    val tagIds: List<String> = emptyList(),
)

/** What the form shows next to the fields, worked out from the form as it stands. */
data class CostFormView(
    /** The tax class means something in the chosen book. */
    val taxClassApplies: Boolean,
    val showParticipants: Boolean,
    val showShares: Boolean,
    val splitHint: String,
    /** Each person's part of the amount as the server will book it; empty while the amount cannot be read. */
    val preview: List<ShareLine>,
    /** For a custom split: whether the percentages add up ("Summe: 100 %", "Es fehlen noch 20 %"). */
    val sharesStatus: String?,
    val sharesOk: Boolean,
    val countsHint: String,
)

data class CostEditState(
    val isNew: Boolean,
    /** Loading what the form needs. The form is shown once [initial] is there. */
    val loading: Boolean,
    val loadError: UiError? = null,
    /** The values the form starts with; the screen keeps its own copy while the person types. */
    val initial: CostForm? = null,
    val books: List<BookOption> = emptyList(),
    val people: List<PersonOption> = emptyList(),
    val assets: List<CostOption> = emptyList(),
    val tags: List<TagOption> = emptyList(),
    val categories: List<CostOption> = emptyList(),
    val splitModes: List<CostOption> = emptyList(),
    val deductibles: List<CostOption> = emptyList(),
    /** A fuel log entry booked this entry: amount, currency, date and device stay with it. */
    val fuelOwned: Boolean = false,
    val fuelNote: String? = null,
    val saving: Boolean = false,
    val error: UiError? = null,
    /** Messages per field (`title`, `amountMinor`, `date`, `shares`, `participantIds`, ...). */
    val fieldErrors: Map<String, String> = emptyMap(),
    /** The id of the saved entry; the screen closes when it is set. */
    val savedId: String? = null,
    /** The bank transactions that fit the entry as typed, while a finance app is connected. */
    val matches: MatchesView = MatchesView(),
)

/** Books an entry in the full form ([id] null) or edits one. */
class CostEditStore(
    private val app: HauswartApp,
    private val id: String?,
    private val requestedBook: String?,
    private val requestedAsset: String?,
) : Store<CostEditState>(CostEditState(isNew = id == null, loading = true)) {
    private var books: List<CostBook> = emptyList()
    private var people: List<PersonOption> = emptyList()
    private var entry: CostEntry? = null
    private val bank = BankMatching(app)
    private var matchJob: Job? = null
    internal var matchDelayMs: Long = MATCH_DEBOUNCE_MS

    init {
        load()
    }

    /** Looks up the bank transactions that fit the form, a moment after the last change of amount, currency or date. */
    fun matchesFor(form: CostForm) {
        val ask = bank.ask(matchQueryOf(parseAmountText(form.amount, form.currency, form.refund).minor, form.currency, form.date))
        update { it.copy(matches = bank.view()) }
        if (!ask) return
        matchJob?.cancel()
        matchJob =
            launch({ _ ->
                bank.fail()
                update { it.copy(matches = bank.view()) }
            }) {
                delay(matchDelayMs)
                bank.fetch()
                update { it.copy(matches = bank.view()) }
            }
    }

    /** Ties the entry to the transaction, or lets go of it when it is chosen already. */
    fun chooseMatch(id: String) {
        bank.choose(id)
        update { it.copy(matches = bank.view()) }
    }

    private fun matchOf(form: CostForm): MatchQuery? =
        matchQueryOf(parseAmountText(form.amount, form.currency, form.refund).minor, form.currency, form.date)

    fun retry() {
        load()
    }

    /** The form after another book was picked: a new entry takes the book's default split unless the person chose one. */
    fun withBook(
        form: CostForm,
        bookId: String,
    ): CostForm {
        val book = books.firstOrNull { it.id == bookId } ?: return form
        val mode = if (id == null && !form.splitTouched) book.defaultSplitMode else form.splitMode
        return form.copy(bookId = book.id, splitMode = mode)
    }

    fun withCategory(
        form: CostForm,
        category: String,
    ): CostForm =
        form.copy(
            category = category,
            countsAsExpense = if (form.countsTouched) form.countsAsExpense else countsAsExpenseByDefault(category),
        )

    fun withCounts(
        form: CostForm,
        counts: Boolean,
    ): CostForm = form.copy(countsAsExpense = counts, countsTouched = true)

    fun withSplitMode(
        form: CostForm,
        mode: String,
    ): CostForm = form.copy(splitMode = mode, splitTouched = true)

    fun withCurrency(
        form: CostForm,
        text: String,
    ): CostForm = form.copy(currency = cleanCurrency(text))

    fun toggleParticipant(
        form: CostForm,
        userId: String,
    ): CostForm = form.copy(participants = if (userId in form.participants) form.participants - userId else form.participants + userId)

    fun withShare(
        form: CostForm,
        userId: String,
        percent: String,
    ): CostForm = form.copy(shares = form.shares + (userId to percent))

    /** The custom shares divided evenly among everybody. */
    fun equalizeShares(form: CostForm): CostForm = form.copy(shares = equalShareInputs(people.map { it.id }))

    fun toggleTag(
        form: CostForm,
        tagId: String,
    ): CostForm {
        if (tagId in form.tagIds) return form.copy(tagIds = form.tagIds - tagId)
        return if (form.tagIds.size >= MAX_TAGS) form else form.copy(tagIds = form.tagIds + tagId)
    }

    fun view(form: CostForm): CostFormView {
        val book = books.firstOrNull { it.id == form.bookId }
        val amount = parseAmountText(form.amount, form.currency, form.refund)
        val checked = if (form.splitMode == "custom") checkShares(form) else null
        val shares =
            when (form.splitMode) {
                "ownership" -> sharesFor("ownership", people)
                "equal" -> sharesFor("equal", people.filter { it.id in form.participants })
                "custom" -> checked?.items.orEmpty()
                else -> emptyList()
            }
        val preview =
            amount.minor?.let { minor ->
                amountsFor(minor, shares).map { (userId, part) ->
                    val bps = shares.first { it.userId == userId }.shareBps
                    ShareLine(
                        userId = userId,
                        name = people.firstOrNull { it.id == userId }?.name ?: tr("cost_person_unknown"),
                        percent = tr("cost_percent", "value" to shareToInput(bps)),
                        amount = Money.format(part, form.currency),
                    )
                }
            } ?: emptyList()
        return CostFormView(
            taxClassApplies = book?.taxRelevant ?: true,
            showParticipants = form.splitMode == "equal",
            showShares = form.splitMode == "custom",
            splitHint =
                if (form.splitMode == "equal" &&
                    form.participants.size == people.size
                ) {
                    tr("cost_split_equal_everyone_hint")
                } else {
                    costSplitHint(form.splitMode)
                },
            preview = preview,
            sharesStatus = checked?.let(::sharesStatus),
            sharesOk = checked != null && checked.error == null,
            countsHint = tr("cost_counts_as_expense_hint"),
        )
    }

    fun save(form: CostForm) {
        if (current.saving) return
        val errors = check(form).toMutableMap()
        if (errors.isNotEmpty()) {
            update { it.copy(fieldErrors = errors, error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        val tie = bank.chosenFor(matchOf(form))
        launch({ e -> failed(e, tie.isNotEmpty(), form) }) {
            val saved = entry
            val savedId =
                if (id == null || saved == null) {
                    app.api.costs
                        .costsCreate(createRequest(form, tie))
                        .id
                } else {
                    val request = updateRequest(form, saved, tie)
                    if (request == null) {
                        saved.id
                    } else {
                        app.api.costs
                            .costsUpdate(saved.id, request)
                            .id
                    }
                }
            app.changed("costs")
            update { it.copy(saving = false, savedId = savedId) }
        }
    }

    private fun failed(
        e: UiError,
        sentTie: Boolean,
        form: CostForm,
    ) {
        val refused = tieFailure(e, sentTie)
        if (refused == null) {
            update { it.copy(saving = false, error = if (e.fields.isEmpty()) e else null, fieldErrors = e.fields) }
            return
        }
        bank.refuse(refused)
        update {
            it.copy(
                saving = false,
                error = UiError(tr("form_check_fields"), "invalid_request"),
                fieldErrors = e.fields + ("financeSuggestionId" to refused),
                matches = bank.view(),
            )
        }
        matchesFor(form)
    }

    private fun check(form: CostForm): Map<String, String> {
        val errors = mutableMapOf<String, String>()
        if (form.title.isBlank()) {
            errors["title"] = tr("m_field_required")
        } else if (form.title.trim().length > COST_TITLE_MAX) {
            errors["title"] = tr("field_too_long", "max" to COST_TITLE_MAX)
        }
        if (!isCurrencyCode(form.currency)) {
            errors["currency"] = tr("cost_currency_invalid")
        } else {
            parseAmountText(form.amount, form.currency, form.refund).error?.let { errors["amountMinor"] = it }
        }
        if (form.date.isEmpty()) {
            errors["date"] = tr("m_field_required")
        } else if (!Dates.isValid(form.date)) {
            errors["date"] =
                tr("field_invalid_date")
        }
        if (form.payee.trim().length > COST_PAYEE_MAX) errors["payee"] = tr("field_too_long", "max" to COST_PAYEE_MAX)
        if (form.notes.trim().length > COST_NOTES_MAX) errors["notes"] = tr("field_too_long", "max" to COST_NOTES_MAX)
        if (form.splitMode == "custom") checkShares(form).error?.let { errors["shares"] = it }
        if (form.splitMode == "equal" && chosenParticipants(form).isEmpty()) errors["participantIds"] = tr("cost_for_whom_none")
        return errors
    }

    private fun chosenParticipants(form: CostForm): List<String> = people.map { it.id }.filter { it in form.participants }

    private fun checkShares(form: CostForm): CheckedShares {
        val items = mutableListOf<ShareBps>()
        var invalid = false
        for (person in people) {
            val text = form.shares[person.id].orEmpty().trim()
            if (text.isEmpty() || isZeroPercent(text)) continue
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

    private fun sharesStatus(checked: CheckedShares): String =
        when {
            checked.error != null && checked.items.isNotEmpty() && checked.totalBps < SHARE_BPS_TOTAL ->
                tr("cost_shares_missing", "percent" to shareToInput(SHARE_BPS_TOTAL - checked.totalBps))
            checked.error != null && checked.totalBps > SHARE_BPS_TOTAL ->
                tr("cost_shares_over", "percent" to shareToInput(checked.totalBps - SHARE_BPS_TOTAL))
            checked.error != null -> checked.error
            else -> tr("cost_shares_total_ok")
        }

    private fun narrowed(form: CostForm): List<String>? {
        val chosen = chosenParticipants(form)
        return if (chosen.isNotEmpty() && chosen.size < people.size) chosen else null
    }

    private fun taxClassApplies(form: CostForm): Boolean = books.firstOrNull { it.id == form.bookId }?.taxRelevant ?: true

    private fun createRequest(
        form: CostForm,
        tie: String,
    ): CostsCreateRequest {
        val amount = requireNotNull(parseAmountText(form.amount, form.currency, form.refund).minor)
        return CostsCreateRequest(
            bookId = form.bookId.ifEmpty { null },
            date = form.date,
            title = form.title.trim(),
            amountMinor = amount,
            currency = form.currency,
            category = form.category,
            assetId = form.assetId.ifEmpty { null },
            payee = form.payee.trim().ifEmpty { null },
            notes = form.notes.trim().ifEmpty { null },
            paidByUserId = form.paidByUserId.ifEmpty { null },
            splitMode = form.splitMode,
            shares =
                if (form.splitMode ==
                    "custom"
                ) {
                    checkShares(form).items.map { CostsCreateRequestSharesItem(it.userId, it.shareBps) }
                } else {
                    null
                },
            participantIds = if (form.splitMode == "equal") narrowed(form) else null,
            countsAsExpense = form.countsAsExpense,
            deductible = if (taxClassApplies(form)) form.deductible else "unknown",
            tagIds = form.tagIds.takeIf { it.isNotEmpty() },
            financeSuggestionId = tie.ifEmpty { null },
        )
    }

    /** The request that changes [saved] into the form, with only what differs; null when nothing changed. */
    private fun updateRequest(
        form: CostForm,
        saved: CostEntry,
        tie: String,
    ): CostsUpdateRequest? {
        val amount = requireNotNull(parseAmountText(form.amount, form.currency, form.refund).minor)
        val owned = saved.fuelLogId != null
        val userIds = people.map { it.id }
        val title = form.title.trim()
        val payee = form.payee.trim().ifEmpty { null }
        val notes = form.notes.trim().ifEmpty { null }
        val split = splitChange(form, saved, userIds)
        val tagsChanged = form.tagIds.toSet() != saved.tags.map { it.id }.toSet()
        val request =
            CostsUpdateRequest(
                bookId = form.bookId.takeIf { it.isNotEmpty() && it != saved.bookId },
                date = form.date.takeIf { !owned && it != saved.date },
                title = title.takeIf { it != saved.title },
                amountMinor = amount.takeIf { !owned && it != saved.amountMinor },
                currency = form.currency.takeIf { !owned && it != saved.currency },
                category = form.category.takeIf { it != saved.category },
                assetId =
                    if (!owned &&
                        (form.assetId.ifEmpty { null }) != saved.assetId
                    ) {
                        Patch.of(form.assetId.ifEmpty { null })
                    } else {
                        Patch.Keep
                    },
                payee = if (payee != saved.payee) Patch.of(payee) else Patch.Keep,
                notes = if (notes != saved.notes) Patch.of(notes) else Patch.Keep,
                paidByUserId =
                    if (form.paidByUserId.ifEmpty { null } !=
                        saved.paidByUserId
                    ) {
                        Patch.of(form.paidByUserId.ifEmpty { null })
                    } else {
                        Patch.Keep
                    },
                splitMode = split.mode,
                shares = split.shares?.map { CostsUpdateRequestSharesItem(it.userId, it.shareBps) },
                participantIds = split.participantIds,
                countsAsExpense = form.countsAsExpense.takeIf { it != saved.countsAsExpense || form.category != saved.category },
                deductible = form.deductible.takeIf { it != saved.deductible && taxClassApplies(form) },
                tagIds = form.tagIds.takeIf { tagsChanged },
                financeSuggestionId = tie.ifEmpty { null },
            )
        return request.takeIf { it != CostsUpdateRequest() }
    }

    private class SplitChange(
        val mode: String? = null,
        val shares: List<ShareBps>? = null,
        val participantIds: List<String>? = null,
    )

    /**
     * The part of an update that changes the split. Sending the split again would divide the amount by today's
     * ownership shares, so it goes only when the person changed the mode, the custom shares or the people of an equal split.
     */
    private fun splitChange(
        form: CostForm,
        saved: CostEntry,
        userIds: List<String>,
    ): SplitChange {
        val narrowed = if (form.splitMode == "equal") narrowed(form) else null
        if (form.splitMode != saved.splitMode) {
            return SplitChange(
                mode = form.splitMode,
                shares = if (form.splitMode == "custom") checkShares(form).items else null,
                participantIds = narrowed,
            )
        }
        val storedShares = saved.shares.map { ShareBps(it.userId, it.shareBps) }
        if (form.splitMode == "custom") {
            val items = checkShares(form).items
            return if (items.associate { it.userId to it.shareBps } !=
                storedShares.associate { it.userId to it.shareBps }
            ) {
                SplitChange(shares = items)
            } else {
                SplitChange()
            }
        }
        if (form.splitMode == "equal" && chosenParticipants(form).toSet() != participantsOf(saved, userIds).toSet()) {
            return SplitChange(mode = "equal", participantIds = narrowed)
        }
        return SplitChange()
    }

    private fun participantsOf(
        saved: CostEntry,
        userIds: List<String>,
    ): List<String> {
        if (saved.splitMode != "equal" || saved.shares.isEmpty()) return userIds
        val sharing = saved.shares.map { it.userId }.toSet()
        return userIds.filter { it in sharing }
    }

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val household = app.household.get()
            val loaded =
                coroutineScope {
                    val bookList =
                        async {
                            fetchAll { cursor ->
                                val page = app.api.costs.costBooksList(cursor = cursor, limit = 200, includeArchived = true)
                                page.items to page.nextCursor
                            }
                        }
                    val tagList = async { app.api.costs.costTagsList() }
                    val assetList =
                        async {
                            fetchAll { cursor ->
                                val page = app.api.assets.assetsList(cursor = cursor, limit = 200)
                                page.items to page.nextCursor
                            }
                        }
                    val existing = id?.let { wanted -> async { app.api.costs.costsGet(wanted) } }
                    val connected = async { bank.connected() }
                    Loaded(bookList.await(), tagList.await().items, assetList.await(), existing?.await(), connected.await())
                }
            books = loaded.books
            people = household.members.map { PersonOption(it.id, it.name, it.ownershipBps) }
            entry = loaded.entry
            bank.eligible = loaded.financeConnected && loaded.entry?.fuelLogId == null && loaded.entry?.financeLinked != true
            val userIds = people.map { it.id }
            val saved = loaded.entry
            val form =
                if (saved == null) {
                    newForm(household.currency, Dates.today(household.timezone), userIds)
                } else {
                    formOf(saved, userIds)
                }
            val currentBook = saved?.bookId
            val choices = books.filter { it.archivedAt == null || it.id == currentBook }
            update {
                it.copy(
                    loading = false,
                    initial = form,
                    books = choices.map(::bookOptionOf),
                    people = people,
                    assets = loaded.assets.map { a -> CostOption(a.id, if (a.roomName != null) "${a.name} (${a.roomName})" else a.name) },
                    tags = loaded.tags.map { t -> TagOption(t.id, t.name, t.color) },
                    categories = costCategoryOptions(),
                    splitModes = COST_SPLIT_MODES.map { m -> CostOption(m, costSplitLabel(m)) },
                    deductibles = COST_DEDUCTIBLES.map { d -> CostOption(d, costDeductibleLabel(d)) },
                    fuelOwned = saved?.fuelLogId != null,
                    fuelNote = if (saved?.fuelLogId != null) tr("cost_fuel_owned_note") else null,
                )
            }
        }
    }

    private class Loaded(
        val books: List<CostBook>,
        val tags: List<CostTag>,
        val assets: List<Asset>,
        val entry: CostEntry?,
        val financeConnected: Boolean,
    )

    private fun newForm(
        currency: String,
        today: String,
        userIds: List<String>,
    ): CostForm {
        val wanted = openBooks(books).firstOrNull { it.id == requestedBook }
        val book = wanted ?: defaultBook(books)
        val me = app.session.user?.id
        return CostForm(
            bookId = book?.id ?: "",
            currency = currency,
            date = today,
            assetId = requestedAsset ?: "",
            paidByUserId = if (me != null && me in userIds) me else "",
            splitMode = book?.defaultSplitMode ?: "ownership",
            participants = userIds,
            shares = equalShareInputs(userIds),
            countsAsExpense = countsAsExpenseByDefault("other"),
        )
    }

    private fun formOf(
        saved: CostEntry,
        userIds: List<String>,
    ): CostForm =
        CostForm(
            bookId = saved.bookId,
            title = saved.title,
            amount = amountInput(saved.amountMinor, saved.currency),
            refund = saved.amountMinor < 0,
            currency = saved.currency,
            date = saved.date,
            category = saved.category,
            assetId = saved.assetId ?: "",
            payee = saved.payee ?: "",
            notes = saved.notes ?: "",
            paidByUserId = saved.paidByUserId ?: "",
            splitMode = saved.splitMode,
            splitTouched = true,
            participants = participantsOf(saved, userIds),
            shares =
                if (saved.shares.isNotEmpty()) {
                    shareInputsOf(saved.shares.map { ShareBps(it.userId, it.shareBps) }, userIds)
                } else {
                    equalShareInputs(userIds)
                },
            countsAsExpense = saved.countsAsExpense,
            countsTouched = saved.countsAsExpense != countsAsExpenseByDefault(saved.category),
            deductible = saved.deductible,
            tagIds = saved.tags.map { it.id },
        )

    companion object {
        const val MAX_TAGS = 10
    }
}

private val zeroPercent = Regex("^(?:0+(?:[.,]0*)?|[.,]0+)\\s*%?$")

private fun isZeroPercent(text: String): Boolean = zeroPercent.matches(text)
