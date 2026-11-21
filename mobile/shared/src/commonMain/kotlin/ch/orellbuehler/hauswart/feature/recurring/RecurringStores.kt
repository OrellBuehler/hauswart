package ch.orellbuehler.hauswart.feature.recurring

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.CostRecurrence
import ch.orellbuehler.hauswart.api.generated.CostRecurrencesUpdateRequest
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.feature.costs.CostFact
import ch.orellbuehler.hauswart.feature.costs.TagView
import ch.orellbuehler.hauswart.feature.costs.costCategoryLabel
import ch.orellbuehler.hauswart.feature.costs.costDeductibleLabel
import ch.orellbuehler.hauswart.feature.costs.costSplitLabel
import ch.orellbuehler.hauswart.feature.dashboard.TONE_DUE
import ch.orellbuehler.hauswart.feature.dashboard.TONE_MUTED
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OK
import ch.orellbuehler.hauswart.i18n.tr

private fun stateTone(state: String): String =
    when (state) {
        "active" -> TONE_OK
        "paused" -> TONE_DUE
        else -> TONE_MUTED
    }

/** Why the last booking failed, in words; null while the recurring cost works. */
fun recurrenceErrorMessage(
    lastError: String?,
    bookName: String,
): String? =
    when (lastError) {
        "book_archived" -> tr("recurrence_error_book_archived", "book" to bookName)
        null -> null
        else -> tr("recurrence_error_failed")
    }

/** What a pause, resume or "book now" answered: a sentence, and the booked entry when there is one. */
data class RecurringNotice(
    val message: String,
    val entryId: String?,
)

/** One recurring cost on the list. */
data class RecurringRowView(
    val id: String,
    val title: String,
    /** Rhythm, book and category in one line. */
    val subtitle: String,
    val amount: String,
    val refund: Boolean,
    /** `active`, `paused` or `finished`. */
    val state: String,
    val stateLabel: String,
    val stateTone: String,
    /** "Nächste Buchung: 1.12.2026", "Fällig, wird gleich gebucht" or "Keine weitere Buchung". */
    val nextText: String,
    val lastText: String,
    val clampNote: String?,
    val tags: List<TagView>,
    /** Why the last booking failed. */
    val error: String?,
    val due: Boolean,
)

data class RecurringSection(
    val state: String,
    val title: String,
    val rows: List<RecurringRowView>,
)

internal fun ruleOf(r: CostRecurrence): RecurrenceRule =
    RecurrenceRule(r.frequency, r.interval.toInt(), r.dayOfMonth.toInt(), r.startDate, r.endDate)

internal fun nextText(
    state: String,
    due: Boolean,
    nextDate: String?,
): String =
    when {
        state == "finished" -> tr("recurrence_over")
        due -> tr("recurrence_due_now")
        else -> tr("recurrence_next_on", "date" to Dates.format(nextDate ?: ""))
    }

internal fun rowOf(
    r: CostRecurrence,
    today: String,
): RecurringRowView {
    val rule = ruleOf(r)
    val state = recurrenceStateOf(r.active, r.nextDate)
    val due = isDue(r.active, r.nextDate, today)
    return RecurringRowView(
        id = r.id,
        title = r.title,
        subtitle = listOf(ruleWording(rule), r.bookName, costCategoryLabel(r.category)).joinToString(" · "),
        amount = Money.format(r.amountMinor, r.currency),
        refund = r.amountMinor < 0,
        state = state,
        stateLabel = recurrenceStateLabel(state),
        stateTone = stateTone(state),
        nextText = nextText(state, due, r.nextDate),
        lastText =
            r.lastOccurrenceDate?.let { tr("recurrence_last_on", "date" to Dates.format(it)) } ?: tr("recurrence_never_booked"),
        clampNote = clampNote(rule),
        tags = r.tags.map { TagView(it.id, it.name, it.color) },
        error = recurrenceErrorMessage(r.lastError, r.bookName),
        due = due,
    )
}

/** The words after a tap on "book now". */
internal fun runNotice(
    recurrence: CostRecurrence,
    entryTitle: String?,
    entryDate: String?,
    entryId: String?,
): RecurringNotice {
    if (entryTitle != null && entryDate != null) {
        return RecurringNotice(tr("recurrence_run_booked", "title" to entryTitle, "date" to Dates.format(entryDate)), entryId)
    }
    val text =
        when (recurrenceStateOf(recurrence.active, recurrence.nextDate)) {
            "finished" -> tr("recurrence_run_finished")
            "paused" -> tr("recurrence_run_paused")
            else -> tr("recurrence_run_not_due", "date" to Dates.format(recurrence.nextDate ?: ""))
        }
    return RecurringNotice(text, null)
}

internal fun resumeNotice(recurrence: CostRecurrence): String =
    if (recurrence.nextDate != null) {
        tr("recurrence_resumed_toast", "title" to recurrence.title, "date" to Dates.format(recurrence.nextDate))
    } else {
        tr("recurrence_resumed_finished_toast", "title" to recurrence.title)
    }

/** Which of pause, resume and "book now" is running. */
const val RECURRING_ACTION_PAUSE = "pause"
const val RECURRING_ACTION_RESUME = "resume"
const val RECURRING_ACTION_RUN = "run"

/** Pause, resume, "book now" and delete: shared by the list and the detail store. Returns the notice to show. */
private suspend fun perform(
    app: HauswartApp,
    recurrence: CostRecurrence,
    action: String,
): RecurringNotice =
    when (action) {
        RECURRING_ACTION_PAUSE -> {
            app.api.costs.costRecurrencesUpdate(recurrence.id, CostRecurrencesUpdateRequest(active = false))
            RecurringNotice(tr("recurrence_paused_toast", "title" to recurrence.title), null)
        }
        RECURRING_ACTION_RESUME -> {
            val resumed = app.api.costs.costRecurrencesUpdate(recurrence.id, CostRecurrencesUpdateRequest(active = true))
            RecurringNotice(resumeNotice(resumed), null)
        }
        else -> {
            val result = app.api.costs.costRecurrencesRun(recurrence.id)
            runNotice(result.recurrence, result.entry?.title, result.entry?.date, result.entry?.id)
        }
    }

/** The wording of a failed action; "book now" against a closed book (a 400 on `bookId`) says so. */
private fun failure(
    e: UiError,
    recurrence: CostRecurrence,
    action: String,
): UiError =
    if (action == RECURRING_ACTION_RUN && e.code == "invalid_request" && "bookId" in e.fields) {
        e.copy(message = tr("recurrence_error_book_archived", "book" to recurrence.bookName))
    } else {
        e
    }

data class RecurringListState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val sections: List<RecurringSection> = emptyList(),
    val total: Int = 0,
    val countText: String = "",
    /** The recurring cost an action is running for, and which one. */
    val busyId: String? = null,
    val busyAction: String? = null,
    val actionError: UiError? = null,
    val notice: RecurringNotice? = null,
)

/** Recurring costs: the ones that book, the paused ones and the finished ones. */
class RecurringListStore(
    private val app: HauswartApp,
) : Store<RecurringListState>(RecurringListState()) {
    private var all: List<CostRecurrence> = emptyList()

    init {
        onChange(app, "costs") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun pause(id: String) = act(id, RECURRING_ACTION_PAUSE)

    fun resume(id: String) = act(id, RECURRING_ACTION_RESUME)

    fun runNow(id: String) = act(id, RECURRING_ACTION_RUN)

    private fun act(
        id: String,
        action: String,
    ) {
        val recurrence = all.firstOrNull { it.id == id } ?: return
        if (current.busyId != null) return
        update { it.copy(busyId = id, busyAction = action, actionError = null) }
        launch({ e ->
            update { it.copy(busyId = null, busyAction = null, actionError = failure(e, recurrence, action)) }
            app.changed("costs")
        }) {
            val notice = perform(app, recurrence, action)
            update { it.copy(busyId = null, busyAction = null, notice = notice) }
            app.changed("costs")
        }
    }

    fun delete(id: String) {
        val recurrence = all.firstOrNull { it.id == id } ?: return
        if (current.busyId != null) return
        update { it.copy(busyId = id, busyAction = "delete", actionError = null) }
        launch({ e -> update { it.copy(busyId = null, busyAction = null, actionError = e) } }) {
            app.api.costs.costRecurrencesDelete(id)
            update {
                it.copy(
                    busyId = null,
                    busyAction = null,
                    notice = RecurringNotice(tr("recurrence_deleted_toast", "title" to recurrence.title), null),
                )
            }
            app.changed("costs")
        }
    }

    fun deleteText(id: String): String = tr("recurrence_delete_description", "title" to (all.firstOrNull { it.id == id }?.title ?: ""))

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    private fun load() {
        update { it.copy(loading = all.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            app.household.get()
            val today = app.household.today()
            all =
                app.api.costs
                    .costRecurrencesList()
                    .items
            val rows = all.map { rowOf(it, today) }
            val sections =
                listOf("active", "paused", "finished").mapNotNull { state ->
                    val items = rows.filter { it.state == state }
                    if (items.isEmpty()) null else RecurringSection(state, tr("recurrence_section_$state"), items)
                }
            update {
                it.copy(
                    loading = false,
                    sections = sections,
                    total = all.size,
                    countText = tr("recurrence_count", "count" to all.size),
                )
            }
        }
    }
}

data class RecurringDetailView(
    val id: String,
    val title: String,
    val categoryLine: String,
    val amount: String,
    val refund: Boolean,
    val state: String,
    val stateLabel: String,
    val stateTone: String,
    val tags: List<TagView>,
    val error: String?,
    val ruleText: String,
    val clampNote: String?,
    val facts: List<CostFact>,
    val notes: String?,
    /** The next dates, or one sentence when there are none (paused or finished). */
    val upcoming: List<String>,
    val upcomingNote: String?,
    val canPause: Boolean,
    val canResume: Boolean,
    val canRun: Boolean,
    /** "Book now" only books what is due; it is on while something is. */
    val runEnabled: Boolean,
    val bookId: String,
)

data class RecurringDetailState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val recurrence: RecurringDetailView? = null,
    val busyAction: String? = null,
    val actionError: UiError? = null,
    val notice: RecurringNotice? = null,
    val deleted: Boolean = false,
)

class RecurringDetailStore(
    private val app: HauswartApp,
    private val id: String,
) : Store<RecurringDetailState>(RecurringDetailState()) {
    private var loaded: CostRecurrence? = null

    init {
        onChange(app, "costs") { if (!current.deleted) load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun pause() = act(RECURRING_ACTION_PAUSE)

    fun resume() = act(RECURRING_ACTION_RESUME)

    fun runNow() = act(RECURRING_ACTION_RUN)

    private fun act(action: String) {
        val recurrence = loaded ?: return
        if (current.busyAction != null) return
        update { it.copy(busyAction = action, actionError = null) }
        launch({ e ->
            update { it.copy(busyAction = null, actionError = failure(e, recurrence, action)) }
            app.changed("costs")
        }) {
            val notice = perform(app, recurrence, action)
            update { it.copy(busyAction = null, notice = notice) }
            app.changed("costs")
        }
    }

    fun delete() {
        val recurrence = loaded ?: return
        if (current.busyAction != null) return
        update { it.copy(busyAction = "delete", actionError = null) }
        launch({ e -> update { it.copy(busyAction = null, actionError = e) } }) {
            app.api.costs.costRecurrencesDelete(recurrence.id)
            update { it.copy(busyAction = null, deleted = true) }
            app.changed("costs")
        }
    }

    fun deleteText(): String = tr("recurrence_delete_description", "title" to (loaded?.title ?: ""))

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    private fun load() {
        update { it.copy(loading = it.recurrence == null, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            app.household.get()
            val today = app.household.today()
            val r = app.api.costs.costRecurrencesGet(id)
            loaded = r
            update { it.copy(loading = false, recurrence = view(r, today)) }
        }
    }

    private fun view(
        r: CostRecurrence,
        today: String,
    ): RecurringDetailView {
        val rule = ruleOf(r)
        val state = recurrenceStateOf(r.active, r.nextDate)
        val due = isDue(r.active, r.nextDate, today)
        val facts = mutableListOf<CostFact>()
        facts += CostFact(tr("recurrence_start_label"), Dates.format(r.startDate))
        facts += CostFact(tr("recurrence_end_label"), r.endDate?.let(Dates::format) ?: tr("recurrence_end_none"))
        facts +=
            CostFact(
                tr("recurrence_next"),
                if (r.nextDate !=
                    null
                ) {
                    Dates.format(r.nextDate) + if (due) " · " + tr("recurrence_due_now") else ""
                } else {
                    tr("recurrence_over")
                },
            )
        facts +=
            CostFact(
                tr("recurrence_last_label"),
                r.lastOccurrenceDate?.let(Dates::format) ?: tr("recurrence_never_booked"),
            )
        facts += CostFact(tr("cost_book"), r.bookName)
        facts += CostFact(tr("cost_paid_by"), r.paidByName ?: tr("cost_payer_open"))
        r.payee?.let { facts += CostFact(tr("cost_payee"), it) }
        facts += CostFact(tr("cost_split"), costSplitLabel(r.splitMode))
        r.assetName?.let { facts += CostFact(tr("cost_asset"), it, "asset", r.assetId) }
        r.roomName?.let { facts += CostFact(tr("cost_room"), it, "room", r.roomId) }
        facts += CostFact(tr("cost_counts_as_expense"), tr(if (r.countsAsExpense) "common_yes" else "common_no"))
        if (r.deductible != "unknown") facts += CostFact(tr("cost_deductible"), costDeductibleLabel(r.deductible))
        val upcoming = if (state == "active") upcomingDates(rule, today).map(Dates::format) else emptyList()
        return RecurringDetailView(
            id = r.id,
            title = r.title,
            categoryLine = costCategoryLabel(r.category) + " · " + r.bookName,
            amount = Money.format(r.amountMinor, r.currency),
            refund = r.amountMinor < 0,
            state = state,
            stateLabel = recurrenceStateLabel(state),
            stateTone = stateTone(state),
            tags = r.tags.map { TagView(it.id, it.name, it.color) },
            error = recurrenceErrorMessage(r.lastError, r.bookName),
            ruleText = ruleWording(rule),
            clampNote = clampNote(rule),
            facts = facts,
            notes = r.notes?.takeIf { it.isNotBlank() },
            upcoming = upcoming,
            upcomingNote =
                when {
                    state == "paused" -> tr("recurrence_upcoming_paused")
                    upcoming.isEmpty() -> tr("recurrence_upcoming_none")
                    else -> null
                },
            canPause = state == "active",
            canResume = state == "paused",
            canRun = state == "active",
            bookId = r.bookId,
            runEnabled = due,
        )
    }
}
