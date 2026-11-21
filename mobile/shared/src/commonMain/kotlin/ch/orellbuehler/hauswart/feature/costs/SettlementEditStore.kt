package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.Patch
import ch.orellbuehler.hauswart.api.generated.Settlement
import ch.orellbuehler.hauswart.api.generated.SettlementsCreateRequest
import ch.orellbuehler.hauswart.api.generated.SettlementsUpdateRequest
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

const val SETTLEMENT_NOTE_MAX = 500

/** What the settlement form holds: every field as the person typed it. */
data class SettlementForm(
    val fromUserId: String = "",
    val toUserId: String = "",
    val amount: String = "",
    val currency: String = "",
    val date: String = "",
    /** Empty settles across all books. */
    val bookId: String = "",
    val note: String = "",
)

data class SettlementEditState(
    val isNew: Boolean,
    val loading: Boolean,
    val loadError: UiError? = null,
    val initial: SettlementForm? = null,
    val people: List<CostOption> = emptyList(),
    /** "All books" first, then every book (archived ones too: paying back a closed trip is the normal order). */
    val books: List<CostOption> = emptyList(),
    val saving: Boolean = false,
    val error: UiError? = null,
    /** Messages per field: `fromUserId`, `toUserId`, `amountMinor`, `currency`, `date`, `bookId`, `note`. */
    val fieldErrors: Map<String, String> = emptyMap(),
    val savedId: String? = null,
)

/**
 * Records a payment between two people ([id] null) or edits one. A suggested payment starts the form with
 * [fromUserId], [toUserId] and [amount]; [requestedBook] is a book argument (`all` for every book).
 */
class SettlementEditStore(
    private val app: HauswartApp,
    private val id: String?,
    private val fromUserId: String?,
    private val toUserId: String?,
    private val amount: String?,
    private val requestedBook: String?,
) : Store<SettlementEditState>(SettlementEditState(isNew = id == null, loading = true)) {
    private var settlement: Settlement? = null
    private val key = newIdempotencyKey()

    init {
        load()
    }

    fun retry() {
        load()
    }

    /** The other direction: who paid and who received change places. */
    fun swap(form: SettlementForm): SettlementForm = form.copy(fromUserId = form.toUserId, toUserId = form.fromUserId)

    fun withCurrency(
        form: SettlementForm,
        text: String,
    ): SettlementForm = form.copy(currency = cleanCurrency(text))

    fun save(form: SettlementForm) {
        if (current.saving) return
        val errors = mutableMapOf<String, String>()
        if (!isCurrencyCode(form.currency)) {
            errors["currency"] = tr("cost_currency_invalid")
        }
        val parsed = parseAmountText(form.amount, form.currency, positiveOnly = true)
        if (errors["currency"] == null) parsed.error?.let { errors["amountMinor"] = it }
        if (form.date.isEmpty()) {
            errors["date"] = tr("m_field_required")
        } else if (!Dates.isValid(form.date)) {
            errors["date"] =
                tr("field_invalid_date")
        }
        if (form.fromUserId.isEmpty()) errors["fromUserId"] = tr("m_field_required")
        if (form.toUserId.isEmpty()) {
            errors["toUserId"] = tr("m_field_required")
        } else if (form.toUserId == form.fromUserId) {
            errors["toUserId"] = tr("settlement_same_person")
        }
        if (form.note.trim().length > SETTLEMENT_NOTE_MAX) errors["note"] = tr("field_too_long", "max" to SETTLEMENT_NOTE_MAX)
        if (errors.isNotEmpty()) {
            update { it.copy(fieldErrors = errors, error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e -> update { it.copy(saving = false, error = if (e.fields.isEmpty()) e else null, fieldErrors = e.fields) } }) {
            val minor = requireNotNull(parsed.minor)
            val note = form.note.trim().ifEmpty { null }
            val existing = settlement
            val savedId =
                if (id == null || existing == null) {
                    app.api.costs
                        .settlementsCreate(
                            SettlementsCreateRequest(
                                bookId = form.bookId.ifEmpty { null },
                                fromUserId = form.fromUserId,
                                toUserId = form.toUserId,
                                amountMinor = minor,
                                currency = form.currency,
                                date = form.date,
                                note = note,
                                idempotencyKey = key,
                            ),
                        ).id
                } else {
                    val request =
                        SettlementsUpdateRequest(
                            bookId =
                                if (form.bookId.ifEmpty { null } !=
                                    existing.bookId
                                ) {
                                    Patch.of(form.bookId.ifEmpty { null })
                                } else {
                                    Patch.Keep
                                },
                            fromUserId = form.fromUserId.takeIf { it != existing.fromUserId },
                            toUserId = form.toUserId.takeIf { it != existing.toUserId },
                            amountMinor = minor.takeIf { it != existing.amountMinor },
                            currency = form.currency.takeIf { it != existing.currency },
                            date = form.date.takeIf { it != existing.date },
                            note = if (note != existing.note) Patch.of(note) else Patch.Keep,
                        )
                    if (request == SettlementsUpdateRequest()) {
                        existing.id
                    } else {
                        app.api.costs
                            .settlementsUpdate(existing.id, request)
                            .id
                    }
                }
            app.changed("costs")
            update { it.copy(saving = false, savedId = savedId) }
        }
    }

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val household = app.household.get()
            val (books, existing) =
                coroutineScope {
                    val books =
                        async {
                            fetchAll { cursor ->
                                val page = app.api.costs.costBooksList(cursor = cursor, limit = 200, includeArchived = true)
                                page.items to page.nextCursor
                            }
                        }
                    val existing = id?.let { wanted -> async { app.api.costs.settlementsGet(wanted) } }
                    books.await() to existing?.await()
                }
            settlement = existing
            val me = app.session.user?.id
            val form =
                if (existing != null) {
                    SettlementForm(
                        fromUserId = existing.fromUserId,
                        toUserId = existing.toUserId,
                        amount = Money.toInput(existing.amountMinor, existing.currency),
                        currency = existing.currency,
                        date = existing.date,
                        bookId = existing.bookId ?: "",
                        note = existing.note ?: "",
                    )
                } else {
                    SettlementForm(
                        fromUserId = fromUserId ?: me ?: "",
                        toUserId = toUserId ?: "",
                        amount = amount ?: "",
                        currency = household.currency,
                        date = Dates.today(household.timezone),
                        bookId = chooseBook(bookOfArg(requestedBook), app.rememberedBook(), books),
                    )
                }
            update {
                it.copy(
                    loading = false,
                    initial = form,
                    people = app.household.members.map { m -> CostOption(m.id, m.name) },
                    books = listOf(CostOption("", tr("costbook_all"))) + books.map { b -> CostOption(b.id, bookOptionOf(b).name) },
                )
            }
        }
    }
}
