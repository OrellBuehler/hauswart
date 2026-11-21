package ch.orellbuehler.hauswart.feature.recurring

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.Patch
import ch.orellbuehler.hauswart.api.generated.CostBook
import ch.orellbuehler.hauswart.api.generated.CostRecurrence
import ch.orellbuehler.hauswart.api.generated.CostRecurrencesCreateRequest
import ch.orellbuehler.hauswart.api.generated.CostRecurrencesCreateRequestSharesItem
import ch.orellbuehler.hauswart.api.generated.CostRecurrencesUpdateRequest
import ch.orellbuehler.hauswart.api.generated.CostRecurrencesUpdateRequestSharesItem
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.feature.costs.BookOption
import ch.orellbuehler.hauswart.feature.costs.COST_DEDUCTIBLES
import ch.orellbuehler.hauswart.feature.costs.COST_NOTES_MAX
import ch.orellbuehler.hauswart.feature.costs.COST_PAYEE_MAX
import ch.orellbuehler.hauswart.feature.costs.COST_SPLIT_MODES
import ch.orellbuehler.hauswart.feature.costs.COST_TITLE_MAX
import ch.orellbuehler.hauswart.feature.costs.CostOption
import ch.orellbuehler.hauswart.feature.costs.PersonOption
import ch.orellbuehler.hauswart.feature.costs.ShareBps
import ch.orellbuehler.hauswart.feature.costs.ShareLine
import ch.orellbuehler.hauswart.feature.costs.TagOption
import ch.orellbuehler.hauswart.feature.costs.bookOptionOf
import ch.orellbuehler.hauswart.feature.costs.cleanCurrency
import ch.orellbuehler.hauswart.feature.costs.costCategoryOptions
import ch.orellbuehler.hauswart.feature.costs.costDeductibleLabel
import ch.orellbuehler.hauswart.feature.costs.costSplitHint
import ch.orellbuehler.hauswart.feature.costs.costSplitLabel
import ch.orellbuehler.hauswart.feature.costs.countsAsExpenseByDefault
import ch.orellbuehler.hauswart.feature.costs.defaultBook
import ch.orellbuehler.hauswart.feature.costs.equalShareInputs
import ch.orellbuehler.hauswart.feature.costs.isCurrencyCode
import ch.orellbuehler.hauswart.feature.costs.openBooks
import ch.orellbuehler.hauswart.feature.costs.parseAmountText
import ch.orellbuehler.hauswart.feature.costs.shareInputsOf
import ch.orellbuehler.hauswart.feature.costsplit.checkCustomShares
import ch.orellbuehler.hauswart.feature.costsplit.chosenParticipants
import ch.orellbuehler.hauswart.feature.costsplit.narrowedParticipants
import ch.orellbuehler.hauswart.feature.costsplit.sharesStatusText
import ch.orellbuehler.hauswart.feature.costsplit.splitPreview
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

const val MAX_RECURRING_TAGS = 10

val RECURRENCE_FREQUENCIES: List<String> = CostRecurrencesCreateRequest.FREQUENCY_VALUES

/** What the form of a recurring cost holds: every field as typed. */
data class RecurringForm(
    val bookId: String = "",
    val title: String = "",
    val amount: String = "",
    val refund: Boolean = false,
    val currency: String = "",
    val category: String = "other",
    val assetId: String = "",
    val roomId: String = "",
    val payee: String = "",
    val notes: String = "",
    val paidByUserId: String = "",
    val splitMode: String = "ownership",
    val splitTouched: Boolean = false,
    val participants: List<String> = emptyList(),
    val shares: Map<String, String> = emptyMap(),
    val countsAsExpense: Boolean = true,
    val countsTouched: Boolean = false,
    val deductible: String = "unknown",
    val tagIds: List<String> = emptyList(),
    val frequency: String = "monthly",
    val interval: String = "1",
    /** The day of the month as typed; follows the start date until the person types one. */
    val dayOfMonth: String = "",
    val dayTouched: Boolean = false,
    val startDate: String = "",
    /** Empty: no end. */
    val endDate: String = "",
)

/** What the form shows next to the fields, worked out from the form as it stands. */
data class RecurringFormView(
    val taxClassApplies: Boolean,
    val showParticipants: Boolean,
    val showShares: Boolean,
    val splitHint: String,
    val preview: List<ShareLine>,
    val sharesStatus: String?,
    val sharesOk: Boolean,
    /** "Monat", "Monate": the unit behind the interval. */
    val intervalUnit: String,
    /** The rule in words; null while a field of it is not valid. */
    val ruleText: String?,
    val clampNote: String?,
    val upcoming: List<String>,
    /** What saving books at once; null when nothing. */
    val immediateWarning: String?,
    /** A sentence about what a changed rhythm does; null otherwise. */
    val ruleHint: String?,
    val previewInvalid: String,
)

data class RecurringEditState(
    val isNew: Boolean,
    val loading: Boolean,
    val loadError: UiError? = null,
    val initial: RecurringForm? = null,
    val books: List<BookOption> = emptyList(),
    val people: List<PersonOption> = emptyList(),
    val assets: List<CostOption> = emptyList(),
    val rooms: List<CostOption> = emptyList(),
    val tags: List<TagOption> = emptyList(),
    val categories: List<CostOption> = emptyList(),
    val splitModes: List<CostOption> = emptyList(),
    val deductibles: List<CostOption> = emptyList(),
    val frequencies: List<CostOption> = emptyList(),
    val saving: Boolean = false,
    val error: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val savedId: String? = null,
)

/** Sets up a recurring cost ([id] null) or changes one. */
class RecurringEditStore(
    private val app: HauswartApp,
    private val id: String?,
    private val requestedBook: String? = null,
) : Store<RecurringEditState>(RecurringEditState(isNew = id == null, loading = true)) {
    private var books: List<CostBook> = emptyList()
    private var people: List<PersonOption> = emptyList()
    private var recurrence: CostRecurrence? = null
    private var today = ""

    init {
        load()
    }

    fun retry() {
        load()
    }

    fun withBook(
        form: RecurringForm,
        bookId: String,
    ): RecurringForm {
        val book = books.firstOrNull { it.id == bookId } ?: return form
        val mode = if (id == null && !form.splitTouched) book.defaultSplitMode else form.splitMode
        return form.copy(bookId = book.id, splitMode = mode)
    }

    fun withCategory(
        form: RecurringForm,
        category: String,
    ): RecurringForm =
        form.copy(
            category = category,
            countsAsExpense = if (form.countsTouched) form.countsAsExpense else countsAsExpenseByDefault(category),
        )

    fun withCounts(
        form: RecurringForm,
        counts: Boolean,
    ): RecurringForm = form.copy(countsAsExpense = counts, countsTouched = true)

    fun withSplitMode(
        form: RecurringForm,
        mode: String,
    ): RecurringForm = form.copy(splitMode = mode, splitTouched = true)

    fun withCurrency(
        form: RecurringForm,
        text: String,
    ): RecurringForm = form.copy(currency = cleanCurrency(text))

    fun toggleParticipant(
        form: RecurringForm,
        userId: String,
    ): RecurringForm = form.copy(participants = if (userId in form.participants) form.participants - userId else form.participants + userId)

    fun withShare(
        form: RecurringForm,
        userId: String,
        percent: String,
    ): RecurringForm = form.copy(shares = form.shares + (userId to percent))

    fun equalizeShares(form: RecurringForm): RecurringForm = form.copy(shares = equalShareInputs(people.map { it.id }))

    fun toggleTag(
        form: RecurringForm,
        tagId: String,
    ): RecurringForm {
        if (tagId in form.tagIds) return form.copy(tagIds = form.tagIds - tagId)
        return if (form.tagIds.size >= MAX_RECURRING_TAGS) form else form.copy(tagIds = form.tagIds + tagId)
    }

    /** The start date changed: the day of the month follows it until the person typed a day. */
    fun withStartDate(
        form: RecurringForm,
        date: String,
    ): RecurringForm =
        form.copy(
            startDate = date,
            dayOfMonth =
                if (!form.dayTouched && Dates.isValid(date)) {
                    date
                        .drop(8)
                        .take(2)
                        .toInt()
                        .toString()
                } else {
                    form.dayOfMonth
                },
        )

    fun withDay(
        form: RecurringForm,
        text: String,
    ): RecurringForm = form.copy(dayOfMonth = text.filter { it.isDigit() }.take(2), dayTouched = true)

    fun withInterval(
        form: RecurringForm,
        text: String,
    ): RecurringForm = form.copy(interval = text.filter { it.isDigit() }.take(2))

    fun view(form: RecurringForm): RecurringFormView {
        val book = books.firstOrNull { it.id == form.bookId }
        val amount = parseAmountText(form.amount, form.currency, form.refund)
        val checked = if (form.splitMode == "custom") checkCustomShares(form.shares, people) else null
        val rule = ruleOfForm(form)
        val count = form.interval.toIntOrNull() ?: 1
        val before = recurrence
        val changed = before != null && rule != null && ruleOf(before) != rule
        val booking = before == null || (before.active && before.nextDate != null)
        return RecurringFormView(
            taxClassApplies = book?.taxRelevant ?: true,
            showParticipants = form.splitMode == "equal",
            showShares = form.splitMode == "custom",
            splitHint =
                if (form.splitMode == "equal" && form.participants.size == people.size) {
                    tr("cost_split_equal_everyone_hint")
                } else {
                    costSplitHint(form.splitMode)
                },
            preview = splitPreview(form.splitMode, amount.minor, form.currency, people, form.participants, checked),
            sharesStatus = checked?.let(::sharesStatusText),
            sharesOk = checked != null && checked.error == null,
            intervalUnit = tr("recurrence_unit_${form.frequency}", "count" to count),
            ruleText = rule?.let(::ruleWording),
            clampNote = rule?.let(::clampNote),
            upcoming = rule?.let { upcomingDates(it, today).map(Dates::format) }.orEmpty(),
            immediateWarning =
                if (rule != null && booking) immediateWarning(immediateBookings(rule, before?.lastOccurrenceDate, today), today) else null,
            ruleHint = if (changed) tr("recurrence_edit_rule_hint") else null,
            previewInvalid = tr("recurrence_preview_invalid"),
        )
    }

    private fun ruleOfForm(form: RecurringForm): RecurrenceRule? {
        val interval = form.interval.toIntOrNull()
        val day = form.dayOfMonth.toIntOrNull()
        if (interval == null || interval !in 1..12 || day == null || day !in 1..31 || !Dates.isValid(form.startDate)) return null
        if (form.endDate.isNotEmpty() && (!Dates.isValid(form.endDate) || form.endDate < form.startDate)) return null
        return RecurrenceRule(form.frequency, interval, day, form.startDate, form.endDate.ifEmpty { null })
    }

    fun save(form: RecurringForm) {
        if (current.saving) return
        val errors = check(form)
        if (errors.isNotEmpty()) {
            update { it.copy(fieldErrors = errors, error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e -> failed(e) }) {
            val before = recurrence
            val savedId =
                if (before == null) {
                    app.api.costs
                        .costRecurrencesCreate(createRequest(form))
                        .id
                } else {
                    val request = updateRequest(form, before)
                    if (request == CostRecurrencesUpdateRequest()) {
                        before.id
                    } else {
                        app.api.costs
                            .costRecurrencesUpdate(before.id, request)
                            .id
                    }
                }
            app.changed("costs")
            update { it.copy(saving = false, savedId = savedId) }
        }
    }

    private fun failed(e: UiError) {
        val fields =
            if (e.code == "invalid_request" && "bookId" in e.fields) {
                e.fields + ("bookId" to tr("recurrence_error_book_closed"))
            } else {
                e.fields
            }
        update { it.copy(saving = false, error = if (fields.isEmpty()) e else null, fieldErrors = fields) }
    }

    private fun check(form: RecurringForm): Map<String, String> {
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
        if (form.payee.trim().length > COST_PAYEE_MAX) errors["payee"] = tr("field_too_long", "max" to COST_PAYEE_MAX)
        if (form.notes.trim().length > COST_NOTES_MAX) errors["notes"] = tr("field_too_long", "max" to COST_NOTES_MAX)
        if (form.splitMode == "custom") checkCustomShares(form.shares, people).error?.let { errors["shares"] = it }
        if (form.splitMode == "equal" && chosenParticipants(form.participants, people).isEmpty()) {
            errors["participantIds"] = tr("cost_for_whom_none")
        }
        val interval = form.interval.toIntOrNull()
        if (interval == null || interval !in 1..12) errors["interval"] = tr("recurrence_error_interval")
        val day = form.dayOfMonth.toIntOrNull()
        if (day == null || day !in 1..31) errors["dayOfMonth"] = tr("recurrence_error_day")
        if (form.startDate.isEmpty()) {
            errors["startDate"] = tr("m_field_required")
        } else if (!Dates.isValid(form.startDate)) {
            errors["startDate"] = tr("field_invalid_date")
        }
        if (form.endDate.isNotEmpty()) {
            if (!Dates.isValid(form.endDate)) {
                errors["endDate"] = tr("field_invalid_date")
            } else if (Dates.isValid(form.startDate) && form.endDate < form.startDate) {
                errors["endDate"] = tr("recurrence_error_end_before_start")
            }
        }
        if (errors.keys.none { it in setOf("interval", "dayOfMonth", "startDate", "endDate") }) {
            val rule = ruleOfForm(form)
            if (rule != null && firstOccurrence(rule) == null) errors["endDate"] = tr("recurrence_error_no_occurrence")
        }
        return errors
    }

    private fun taxApplies(form: RecurringForm): Boolean = books.firstOrNull { it.id == form.bookId }?.taxRelevant ?: true

    private fun createRequest(form: RecurringForm): CostRecurrencesCreateRequest {
        val amount = requireNotNull(parseAmountText(form.amount, form.currency, form.refund).minor)
        return CostRecurrencesCreateRequest(
            bookId = form.bookId.ifEmpty { null },
            title = form.title.trim(),
            amountMinor = amount,
            currency = form.currency,
            category = form.category,
            assetId = form.assetId.ifEmpty { null },
            roomId = form.roomId.ifEmpty { null },
            payee = form.payee.trim().ifEmpty { null },
            notes = form.notes.trim().ifEmpty { null },
            paidByUserId = form.paidByUserId.ifEmpty { null },
            splitMode = form.splitMode,
            shares =
                if (form.splitMode == "custom") {
                    checkCustomShares(form.shares, people).items.map { CostRecurrencesCreateRequestSharesItem(it.userId, it.shareBps) }
                } else {
                    null
                },
            participantIds = if (form.splitMode == "equal") narrowedParticipants(form.participants, people) else null,
            countsAsExpense = form.countsAsExpense,
            deductible = if (taxApplies(form)) form.deductible else "unknown",
            tagIds = form.tagIds.takeIf { it.isNotEmpty() },
            frequency = form.frequency,
            interval = form.interval.toLong(),
            dayOfMonth = form.dayOfMonth.toLong(),
            startDate = form.startDate,
            endDate = form.endDate.ifEmpty { null },
        )
    }

    private class SplitChange(
        val mode: String? = null,
        val shares: List<ShareBps>? = null,
        val participantIds: List<String>? = null,
    )

    private fun participantsOf(r: CostRecurrence): List<String> {
        val ids = people.map { it.id }
        if (r.splitMode != "equal" || r.participantIds == null) return ids
        return ids.filter { it in r.participantIds }
    }

    private fun splitChange(
        form: RecurringForm,
        before: CostRecurrence,
    ): SplitChange {
        val narrowed = if (form.splitMode == "equal") narrowedParticipants(form.participants, people) else null
        if (form.splitMode != before.splitMode) {
            return SplitChange(
                mode = form.splitMode,
                shares = if (form.splitMode == "custom") checkCustomShares(form.shares, people).items else null,
                participantIds = narrowed,
            )
        }
        if (form.splitMode == "custom") {
            val items = checkCustomShares(form.shares, people).items
            val stored = before.shares.orEmpty().associate { it.userId to it.shareBps }
            return if (items.associate { it.userId to it.shareBps } != stored) SplitChange(shares = items) else SplitChange()
        }
        if (form.splitMode == "equal" && chosenParticipants(form.participants, people).toSet() != participantsOf(before).toSet()) {
            return SplitChange(mode = "equal", participantIds = narrowed)
        }
        return SplitChange()
    }

    private fun updateRequest(
        form: RecurringForm,
        before: CostRecurrence,
    ): CostRecurrencesUpdateRequest {
        val amount = requireNotNull(parseAmountText(form.amount, form.currency, form.refund).minor)
        val title = form.title.trim()
        val payee = form.payee.trim().ifEmpty { null }
        val notes = form.notes.trim().ifEmpty { null }
        val split = splitChange(form, before)
        val tagsChanged = form.tagIds.toSet() != before.tags.map { it.id }.toSet()
        val end = form.endDate.ifEmpty { null }
        return CostRecurrencesUpdateRequest(
            bookId = form.bookId.takeIf { it.isNotEmpty() && it != before.bookId },
            title = title.takeIf { it != before.title },
            amountMinor = amount.takeIf { it != before.amountMinor },
            currency = form.currency.takeIf { it != before.currency },
            category = form.category.takeIf { it != before.category },
            assetId = if (form.assetId.ifEmpty { null } != before.assetId) Patch.of(form.assetId.ifEmpty { null }) else Patch.Keep,
            roomId = if (form.roomId.ifEmpty { null } != before.roomId) Patch.of(form.roomId.ifEmpty { null }) else Patch.Keep,
            payee = if (payee != before.payee) Patch.of(payee) else Patch.Keep,
            notes = if (notes != before.notes) Patch.of(notes) else Patch.Keep,
            paidByUserId =
                if (form.paidByUserId.ifEmpty { null } != before.paidByUserId) Patch.of(form.paidByUserId.ifEmpty { null }) else Patch.Keep,
            splitMode = split.mode,
            shares = split.shares?.map { CostRecurrencesUpdateRequestSharesItem(it.userId, it.shareBps) },
            participantIds = split.participantIds,
            countsAsExpense = form.countsAsExpense.takeIf { it != before.countsAsExpense || form.category != before.category },
            deductible = form.deductible.takeIf { it != before.deductible && taxApplies(form) },
            tagIds = form.tagIds.takeIf { tagsChanged },
            frequency = form.frequency.takeIf { it != before.frequency },
            interval = form.interval.toLong().takeIf { it != before.interval },
            dayOfMonth = form.dayOfMonth.toLong().takeIf { it != before.dayOfMonth },
            startDate = form.startDate.takeIf { it != before.startDate },
            endDate = if (end != before.endDate) Patch.of(end) else Patch.Keep,
        )
    }

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val household = app.household.get()
            today = app.household.today()
            val loaded =
                coroutineScope {
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
                    val existing = id?.let { wanted -> async { app.api.costs.costRecurrencesGet(wanted) } }
                    Loaded(
                        bookList.await(),
                        directory.await().items.map { PersonOption(it.id, it.displayName, it.ownershipBps) },
                        tagList.await().items.map { TagOption(it.id, it.name, it.color) },
                        assetList.await().map { a -> CostOption(a.id, if (a.roomName != null) "${a.name} (${a.roomName})" else a.name) },
                        roomList.await().map { r -> CostOption(r.id, r.name) },
                        existing?.await(),
                    )
                }
            books = loaded.books
            people = loaded.people
            recurrence = loaded.recurrence
            val userIds = people.map { it.id }
            val saved = loaded.recurrence
            val form = if (saved == null) newForm(household.currency, userIds) else formOf(saved, userIds)
            val choices = books.filter { it.archivedAt == null || it.id == saved?.bookId }
            update {
                it.copy(
                    loading = false,
                    initial = form,
                    books = choices.map(::bookOptionOf),
                    people = people,
                    assets = loaded.assets,
                    rooms = loaded.rooms,
                    tags = loaded.tags,
                    categories = costCategoryOptions(),
                    splitModes = COST_SPLIT_MODES.map { m -> CostOption(m, costSplitLabel(m)) },
                    deductibles = COST_DEDUCTIBLES.map { d -> CostOption(d, costDeductibleLabel(d)) },
                    frequencies = RECURRENCE_FREQUENCIES.map { f -> CostOption(f, tr("recurrence_frequency_$f")) },
                )
            }
        }
    }

    private class Loaded(
        val books: List<CostBook>,
        val people: List<PersonOption>,
        val tags: List<TagOption>,
        val assets: List<CostOption>,
        val rooms: List<CostOption>,
        val recurrence: CostRecurrence?,
    )

    private fun newForm(
        currency: String,
        userIds: List<String>,
    ): RecurringForm {
        val book = openBooks(books).firstOrNull { it.id == requestedBook } ?: defaultBook(books)
        val me = app.session.user?.id
        return RecurringForm(
            bookId = book?.id ?: "",
            currency = currency,
            paidByUserId = if (me != null && me in userIds) me else "",
            splitMode = book?.defaultSplitMode ?: "ownership",
            participants = userIds,
            shares = equalShareInputs(userIds),
            countsAsExpense = countsAsExpenseByDefault("other"),
            dayOfMonth =
                today
                    .drop(8)
                    .take(2)
                    .toInt()
                    .toString(),
            startDate = today,
        )
    }

    private fun formOf(
        r: CostRecurrence,
        userIds: List<String>,
    ): RecurringForm =
        RecurringForm(
            bookId = r.bookId,
            title = r.title,
            amount = Money.toInput(kotlin.math.abs(r.amountMinor), r.currency),
            refund = r.amountMinor < 0,
            currency = r.currency,
            category = r.category,
            assetId = r.assetId ?: "",
            roomId = r.roomId ?: "",
            payee = r.payee ?: "",
            notes = r.notes ?: "",
            paidByUserId = r.paidByUserId ?: "",
            splitMode = r.splitMode,
            splitTouched = true,
            participants = participantsOf(r),
            shares =
                if (r.shares != null) {
                    shareInputsOf(r.shares.map { ShareBps(it.userId, it.shareBps) }, userIds)
                } else {
                    equalShareInputs(userIds)
                },
            countsAsExpense = r.countsAsExpense,
            countsTouched = r.countsAsExpense != countsAsExpenseByDefault(r.category),
            deductible = r.deductible,
            tagIds = r.tags.map { it.id },
            frequency = r.frequency,
            interval = r.interval.toString(),
            dayOfMonth = r.dayOfMonth.toString(),
            dayTouched = true,
            startDate = r.startDate,
            endDate = r.endDate ?: "",
        )
}
