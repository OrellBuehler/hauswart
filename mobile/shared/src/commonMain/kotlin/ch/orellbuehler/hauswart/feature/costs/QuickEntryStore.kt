package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.ApiException
import ch.orellbuehler.hauswart.api.generated.CostBook
import ch.orellbuehler.hauswart.api.generated.CostsCreateRequest
import ch.orellbuehler.hauswart.api.generated.RecentCategoriesItemsItem
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/** Everyday spending first, for a book that has no history of its own yet. */
private val EVERYDAY_ORDER: List<String> =
    listOf(
        "groceries",
        "household",
        "dining",
        "transport",
        "leisure",
        "health",
        "gifts",
        "travel",
        "subscriptions",
        "fuel",
        "repair",
        "maintenance",
        "utilities",
        "insurance",
        "purchase",
        "renovation",
        "taxes_fees",
        "renewal_fund",
        "mortgage_interest",
        "mortgage_principal",
        "other",
    )

/** The same for a tax relevant book (the apartment): the costs of owning it first. */
private val APARTMENT_ORDER: List<String> =
    listOf(
        "repair",
        "maintenance",
        "utilities",
        "insurance",
        "renovation",
        "purchase",
        "taxes_fees",
        "renewal_fund",
        "mortgage_interest",
        "mortgage_principal",
        "household",
        "groceries",
        "dining",
        "transport",
        "leisure",
        "health",
        "gifts",
        "travel",
        "subscriptions",
        "fuel",
        "other",
    )

internal val CATEGORY_ORDERS: List<List<String>> = listOf(EVERYDAY_ORDER, APARTMENT_ORDER)

/** How many category chips show before "more". */
const val VISIBLE_CATEGORIES = 8

/**
 * Every category, the most used first: by how often the recent entries of the book used it, then how often all recent
 * entries did, then the fixed order for the kind of book.
 */
fun rankCategories(
    history: List<RecentCategoriesItemsItem>,
    bookId: String?,
    taxRelevant: Boolean,
): List<String> {
    val inBook = mutableMapOf<String, Long>()
    val overall = mutableMapOf<String, Long>()
    for (row in history) {
        overall[row.category] = (overall[row.category] ?: 0L) + row.count
        if (bookId != null && row.bookId == bookId) inBook[row.category] = (inBook[row.category] ?: 0L) + row.count
    }
    val order = if (taxRelevant) APARTMENT_ORDER else EVERYDAY_ORDER
    return order.sortedWith(
        compareByDescending<String> { inBook[it] ?: 0L }
            .thenByDescending { overall[it] ?: 0L }
            .thenBy { order.indexOf(it) },
    )
}

/**
 * The chips on screen: the first few of the ranking (all of it once expanded), and the chosen category even when it is
 * not among them, so a pick made from the long list does not disappear when it is folded away again.
 */
fun chipCategories(
    ranked: List<String>,
    selected: String,
    expanded: Boolean,
): List<String> {
    if (expanded) return ranked
    val top = ranked.take(VISIBLE_CATEGORIES)
    return if (selected.isNotEmpty() && selected !in top) top + selected else top
}

/** Who the entry is for when nobody changed the chips: everybody, or nobody in a book that does not share. */
internal fun defaultParticipants(
    book: CostBook?,
    userIds: List<String>,
): List<String> = if (book?.defaultSplitMode == "none") emptyList() else userIds

internal class QuickSplit(
    /** `book_default`, `equal`, `none` or `unchosen` (nobody ticked in a book that shares and "not shared" was not chosen). */
    val kind: String,
    val participantIds: List<String>? = null,
)

/**
 * The split for the chips. The chips as they stand when the book is picked mean "the book's own split" and send nothing,
 * so an ownership book keeps splitting by ownership. Any other choice is an equal split among the people chosen. Nobody
 * ticked in a book that shares is not guessed: it is `unchosen` until the person picks somebody or says "not shared".
 */
internal fun quickSplit(
    book: CostBook?,
    participants: List<String>,
    userIds: List<String>,
    notShared: Boolean,
): QuickSplit {
    val chosen = userIds.filter { it in participants }
    val standard = defaultParticipants(book, userIds)
    if (chosen.size == standard.size && chosen.all { it in standard }) return QuickSplit("book_default")
    if (chosen.isEmpty()) return QuickSplit(if (notShared) "none" else "unchosen")
    return QuickSplit("equal", if (chosen.size < userIds.size) chosen else null)
}

/** What the quick form holds: every field as the person typed it. */
data class QuickForm(
    /** The amount as typed; always an expense (a refund goes through the full form). */
    val amount: String = "",
    val category: String = "",
    /** Left empty, the title is the payee, else the category. */
    val title: String = "",
    val payee: String = "",
    val date: String = "",
    val bookId: String = "",
    val paidByUserId: String = "",
    /** User ids ticked under "for whom". */
    val participants: List<String> = emptyList(),
    /** The person ticked or cleared a chip, so picking another book no longer resets them. */
    val participantsTouched: Boolean = false,
    /** The person chose "not shared": nobody ticked, on purpose. */
    val notShared: Boolean = false,
)

/** What the quick form shows around the fields, worked out from the form as it stands. */
data class QuickView(
    val categoryChips: List<CostOption>,
    val canExpand: Boolean,
    val expandLabel: String,
    val bookChips: List<CostOption>,
    val splitText: String,
    /** Nobody is ticked and that is a way of splitting (the book's, or the person's own), not an open question. */
    val notSharedOn: Boolean,
    val unchosen: Boolean,
    val saveLabel: String,
)

data class QuickEntryState(
    val loading: Boolean = true,
    val loadError: UiError? = null,
    val initial: QuickForm? = null,
    val currency: String = "",
    /** The books that take entries. */
    val books: List<BookOption> = emptyList(),
    val people: List<PersonOption> = emptyList(),
    /** The people as chips for "paid by": the person looking is marked "(du)". */
    val payers: List<CostOption> = emptyList(),
    val saving: Boolean = false,
    val error: UiError? = null,
    /** Messages per field: `amountMinor`, `category`, `date`, `participants`. */
    val fieldErrors: Map<String, String> = emptyMap(),
    /** The id of the booked entry; the screen closes when it is set. */
    val savedId: String? = null,
)

/** The fast entry form: amount, what for, who paid, who it is for. */
class QuickEntryStore(
    private val app: HauswartApp,
    private val requestedBook: String?,
) : Store<QuickEntryState>(QuickEntryState()) {
    private var books: List<CostBook> = emptyList()
    private var people: List<PersonOption> = emptyList()
    private var history: List<RecentCategoriesItemsItem> = emptyList()
    private var key: String = newIdempotencyKey()

    init {
        load()
    }

    fun retry() {
        load()
    }

    fun withBook(
        form: QuickForm,
        bookId: String,
    ): QuickForm {
        if (form.participantsTouched) return form.copy(bookId = bookId)
        val book = books.firstOrNull { it.id == bookId }
        return form.copy(bookId = bookId, participants = defaultParticipants(book, people.map { it.id }), notShared = false)
    }

    fun toggleParticipant(
        form: QuickForm,
        userId: String,
    ): QuickForm =
        form.copy(
            participants = if (userId in form.participants) form.participants - userId else form.participants + userId,
            participantsTouched = true,
            notShared = false,
        )

    fun chooseNotShared(form: QuickForm): QuickForm = form.copy(participants = emptyList(), participantsTouched = true, notShared = true)

    fun view(
        form: QuickForm,
        expanded: Boolean,
    ): QuickView {
        val book = books.firstOrNull { it.id == form.bookId }
        val ranked = rankCategories(history, form.bookId.ifEmpty { null }, book?.taxRelevant ?: false)
        val userIds = people.map { it.id }
        val split = quickSplit(book, form.participants, userIds, form.notShared)
        val amount = parseAmountText(form.amount, current.currency)
        return QuickView(
            categoryChips = chipCategories(ranked, form.category, expanded).map { CostOption(it, costCategoryLabel(it)) },
            canExpand = ranked.size > VISIBLE_CATEGORIES,
            expandLabel = tr(if (expanded) "quick_categories_fewer" else "quick_categories_more"),
            bookChips = if (books.size > 1) openBooks(books).map { CostOption(it.id, it.name) } else emptyList(),
            splitText = splitText(split, book, userIds.filter { it in form.participants }.map { id -> people.first { it.id == id }.name }),
            notSharedOn = split.kind != "unchosen" && userIds.none { it in form.participants },
            unchosen = split.kind == "unchosen",
            saveLabel =
                amount.minor?.takeIf { it > 0 }?.let { tr("quick_save_amount", "amount" to Money.format(it, current.currency)) }
                    ?: tr("quick_save"),
        )
    }

    private fun splitText(
        split: QuickSplit,
        book: CostBook?,
        names: List<String>,
    ): String =
        when (split.kind) {
            "none" -> tr("quick_split_none")
            "unchosen" -> tr("quick_split_unchosen")
            "equal" ->
                if (split.participantIds != null) {
                    tr("quick_split_equal_some", "names" to names.joinToString(", "))
                } else {
                    tr("quick_split_equal_all")
                }
            else ->
                when (book?.defaultSplitMode ?: "ownership") {
                    "none" -> tr("quick_split_none")
                    "equal" -> tr("quick_split_equal_all")
                    else -> tr("quick_split_ownership")
                }
        }

    fun save(form: QuickForm) {
        if (current.saving) return
        val errors = mutableMapOf<String, String>()
        val currency = current.currency
        val amount = parseAmountText(form.amount, currency)
        amount.error?.let { errors["amountMinor"] = it }
        if (amount.minor != null && amount.minor <= 0) errors["amountMinor"] = tr("settlement_amount_positive")
        if (form.category.isEmpty()) errors["category"] = tr("quick_category_required")
        if (form.date.isEmpty()) {
            errors["date"] = tr("m_field_required")
        } else if (!Dates.isValid(form.date)) {
            errors["date"] =
                tr("field_invalid_date")
        }
        val book = books.firstOrNull { it.id == form.bookId }
        val split = quickSplit(book, form.participants, people.map { it.id }, form.notShared)
        if (errors.isEmpty() && split.kind == "unchosen") errors["participants"] = tr("quick_split_unchosen")
        if (errors.isNotEmpty()) {
            update { it.copy(fieldErrors = errors, error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e -> failed(e) }) {
            val payee = form.payee.trim()
            val request =
                CostsCreateRequest(
                    bookId = form.bookId.ifEmpty { null },
                    date = form.date,
                    title = quickTitle(form),
                    amountMinor = requireNotNull(amount.minor),
                    currency = currency,
                    category = form.category,
                    payee = payee.ifEmpty { null },
                    paidByUserId = form.paidByUserId.ifEmpty { null },
                    splitMode =
                        if (split.kind == "none") {
                            "none"
                        } else if (split.kind == "equal") {
                            "equal"
                        } else {
                            null
                        },
                    participantIds = split.participantIds,
                    idempotencyKey = key,
                )
            val saved = app.api.costs.costsCreate(request)
            if (form.bookId.isNotEmpty()) app.settings.save(QUICK_BOOK_MEMORY, form.bookId)
            key = newIdempotencyKey()
            app.changed("costs")
            update { it.copy(saving = false, savedId = saved.id) }
        }
    }

    private fun failed(e: UiError) {
        if (e.code == "conflict" && e.detailCode == "idempotency_key_reused") key = newIdempotencyKey()
        val message =
            when {
                e.isNetwork -> UiError(tr("quick_error_network"), e.code)
                e.code == "conflict" && e.detailCode == "idempotency_key_reused" -> UiError(tr("quick_error_key_used"), e.code)
                else -> e
            }
        update { it.copy(saving = false, error = if (message.fields.isEmpty()) message else null, fieldErrors = message.fields) }
    }

    private fun quickTitle(form: QuickForm): String {
        val text =
            form.title
                .trim()
                .ifEmpty {
                    form.payee.trim()
                }.ifEmpty { if (form.category.isNotEmpty()) costCategoryLabel(form.category) else "" }
        return text.take(COST_TITLE_MAX)
    }

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val household = app.household.get()
            val (bookList, directory, recent) =
                coroutineScope {
                    val bookList =
                        async {
                            fetchAll { cursor ->
                                val page = app.api.costs.costBooksList(cursor = cursor, limit = 200, includeArchived = true)
                                page.items to page.nextCursor
                            }
                        }
                    val directory = async { app.api.users.usersDirectory() }
                    val recent =
                        async {
                            try {
                                app.api.costs
                                    .costsRecentCategories()
                                    .items
                            } catch (e: CancellationException) {
                                throw e
                            } catch (e: ApiException) {
                                emptyList()
                            }
                        }
                    Triple(bookList.await(), directory.await(), recent.await())
                }
            books = bookList
            people = directory.items.map { PersonOption(it.id, it.displayName, it.ownershipBps) }
            history = recent
            val userIds = people.map { it.id }
            val bookId =
                chooseQuickBook(requestedBook, app.settings.load(QUICK_BOOK_MEMORY), app.rememberedBook(), books)
            val me = app.session.user?.id
            val form =
                QuickForm(
                    date = Dates.today(household.timezone),
                    bookId = bookId,
                    paidByUserId = if (me != null && me in userIds) me else "",
                    participants = defaultParticipants(books.firstOrNull { it.id == bookId }, userIds),
                )
            update {
                it.copy(
                    loading = false,
                    initial = form,
                    currency = household.currency,
                    books = openBooks(books).map(::bookOptionOf),
                    people = people,
                    payers = people.map { p -> CostOption(p.id, if (p.id == me) tr("quick_you", "name" to p.name) else p.name) },
                )
            }
        }
    }
}
