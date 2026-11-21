package ch.orellbuehler.hauswart.feature.inbox

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.FinanceSuggestion
import ch.orellbuehler.hauswart.api.generated.FinanceSuggestionsAcceptRequest
import ch.orellbuehler.hauswart.api.generated.Integration
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.feature.costs.costCategoryLabel
import ch.orellbuehler.hauswart.i18n.tr

/** The kinds of suggestion in the order the inbox shows them. */
val SUGGESTION_KINDS: List<String> = listOf("cost", "bill_task", "asset", "link")

/** Whether the person has a connected finance app: its adapter can list categories and accounts. */
fun hasFinanceConnection(integrations: List<Integration>): Boolean =
    integrations.any { it.available && it.configured && it.enabled && "categories" in it.capabilities }

fun suggestionKindLabel(kind: String): String = if (kind in SUGGESTION_KINDS) tr("finance_kind_$kind") else kind

/** The entry a `link` suggestion would be tied to. */
data class LinkedEntryView(
    val id: String,
    val title: String,
    val meta: String,
)

/** One suggestion of the finance app, ready to show. */
data class SuggestionView(
    val id: String,
    val kind: String,
    val title: String,
    val meta: String,
    /** The amount, or null for a bill without one. */
    val amount: String?,
    val refund: Boolean,
    val acceptLabel: String,
    /** "Mit einem Gerät verknüpft." for a cost that names a device. */
    val note: String?,
    /** Where the finance app shows it; only an http(s) address. */
    val url: String?,
    /** For a `link`: the entry made by hand that it matches. */
    val linkedEntry: LinkedEntryView?,
    /** The entry of a `link` was deleted since: only "do not link" is left. */
    val linkGone: Boolean,
    /** What tying it to the entry does. */
    val linkExplain: String?,
    val canAdjust: Boolean,
)

data class SuggestionGroup(
    val kind: String,
    val title: String,
    val hint: String?,
    val items: List<SuggestionView>,
)

/** What was done and where to see it: [targetKind] is `cost`, `asset` or `task`. */
data class InboxNotice(
    val message: String,
    val targetKind: String?,
    val targetId: String?,
)

private fun httpOnly(url: String?): String? = url?.takeIf { Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(it) }

internal fun titleOf(s: FinanceSuggestion): String =
    when (s) {
        is FinanceSuggestion.Cost -> s.payload.title
        is FinanceSuggestion.Asset -> s.payload.name
        is FinanceSuggestion.BillTask -> s.payload.title
        is FinanceSuggestion.Link -> s.payload.transaction.title
        FinanceSuggestion.Unknown -> ""
    }

internal fun idOf(s: FinanceSuggestion): String? =
    when (s) {
        is FinanceSuggestion.Cost -> s.id
        is FinanceSuggestion.Asset -> s.id
        is FinanceSuggestion.BillTask -> s.id
        is FinanceSuggestion.Link -> s.id
        FinanceSuggestion.Unknown -> null
    }

internal fun kindOf(s: FinanceSuggestion): String =
    when (s) {
        is FinanceSuggestion.Cost -> "cost"
        is FinanceSuggestion.Asset -> "asset"
        is FinanceSuggestion.BillTask -> "bill_task"
        is FinanceSuggestion.Link -> "link"
        FinanceSuggestion.Unknown -> "unknown"
    }

internal fun suggestionView(s: FinanceSuggestion): SuggestionView? =
    when (s) {
        is FinanceSuggestion.Cost ->
            SuggestionView(
                id = s.id,
                kind = "cost",
                title = s.payload.title,
                meta =
                    listOfNotNull(Dates.format(s.payload.date), costCategoryLabel(s.payload.category), s.payload.payee)
                        .joinToString(" · "),
                amount = Money.format(s.payload.amountMinor, s.payload.currency),
                refund = s.payload.amountMinor < 0,
                acceptLabel = tr("finance_accept_cost"),
                note = if (s.payload.assetId != null) tr("finance_asset_linked") else null,
                url = httpOnly(s.payload.url),
                linkedEntry = null,
                linkGone = false,
                linkExplain = null,
                canAdjust = true,
            )
        is FinanceSuggestion.Asset ->
            SuggestionView(
                id = s.id,
                kind = "asset",
                title = s.payload.name,
                meta = tr("finance_asset_meta", "date" to Dates.format(s.payload.purchaseDate)),
                amount = Money.format(s.payload.priceMinor, s.payload.currency),
                refund = false,
                acceptLabel = tr("finance_accept_asset"),
                note = null,
                url = httpOnly(s.payload.url),
                linkedEntry = null,
                linkGone = false,
                linkExplain = null,
                canAdjust = true,
            )
        is FinanceSuggestion.BillTask ->
            SuggestionView(
                id = s.id,
                kind = "bill_task",
                title = s.payload.title,
                meta = tr("finance_bill_meta", "date" to Dates.format(s.payload.dueDate)),
                amount = s.payload.amountMinor?.let { Money.format(it, s.payload.currency) },
                refund = false,
                acceptLabel = tr("finance_accept_bill_task"),
                note = null,
                url = httpOnly(s.payload.url),
                linkedEntry = null,
                linkGone = false,
                linkExplain = null,
                canAdjust = true,
            )
        is FinanceSuggestion.Link -> {
            val t = s.payload.transaction
            val entry = s.payload.entry
            SuggestionView(
                id = s.id,
                kind = "link",
                title = t.title,
                meta =
                    listOfNotNull(tr("finance_link_transaction", "date" to Dates.format(t.date)), t.payee)
                        .joinToString(" · "),
                amount = Money.format(t.amountMinor, t.currency),
                refund = t.amountMinor < 0,
                acceptLabel = tr("finance_accept_link"),
                note = null,
                url = httpOnly(t.url),
                linkedEntry =
                    entry?.let {
                        LinkedEntryView(
                            id = it.id,
                            title = it.title,
                            meta = listOfNotNull(Dates.format(it.date), it.bookName, it.payee).joinToString(" · "),
                        )
                    },
                linkGone = entry == null,
                linkExplain = if (entry != null) tr("finance_link_explain") else tr("finance_link_entry_gone"),
                canAdjust = false,
            )
        }
        FinanceSuggestion.Unknown -> null
    }

data class InboxState(
    val loading: Boolean = true,
    val error: UiError? = null,
    /** The person has a finance app connected; without one the inbox shows how to connect it. */
    val financeConnected: Boolean = false,
    val groups: List<SuggestionGroup> = emptyList(),
    val total: Int = 0,
    val countText: String = "",
    val busyId: String? = null,
    /** `accept` or `dismiss`. */
    val busyAction: String? = null,
    /** Words for a failed accept or dismiss; the list is reloaded after a conflict. */
    val actionError: String? = null,
    val syncing: Boolean = false,
    val syncError: String? = null,
    val notice: InboxNotice? = null,
)

/** The suggestions of the connected finance app that wait for a decision. */
class InboxStore(
    private val app: HauswartApp,
) : Store<InboxState>(InboxState()) {
    private var raw: List<FinanceSuggestion> = emptyList()

    init {
        onChange(app, "costs") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    /** Takes a suggestion as it is offered. */
    fun accept(id: String) {
        val suggestion = raw.firstOrNull { idOf(it) == id } ?: return
        if (current.busyId != null) return
        update { it.copy(busyId = id, busyAction = "accept", actionError = null) }
        launch({ e -> failed(e, suggestion) }) {
            val result = app.api.finance.financeSuggestionsAccept(id, FinanceSuggestionsAcceptRequest())
            update {
                it.copy(
                    busyId = null,
                    busyAction = null,
                    notice = InboxNotice(acceptedMessage(suggestion, result.entity.type), result.entity.type, result.entity.id),
                )
            }
            app.changed("costs", "assets", "tasks")
        }
    }

    fun dismiss(id: String) {
        val suggestion = raw.firstOrNull { idOf(it) == id } ?: return
        if (current.busyId != null) return
        update { it.copy(busyId = id, busyAction = "dismiss", actionError = null) }
        launch({ e -> failed(e, suggestion) }) {
            app.api.finance.financeSuggestionsDismiss(id)
            val key = if (suggestion is FinanceSuggestion.Link) "finance_dismissed_link_toast" else "finance_dismissed_toast"
            update { it.copy(busyId = null, busyAction = null, notice = InboxNotice(tr(key, "title" to titleOf(suggestion)), null, null)) }
            app.changed("costs")
        }
    }

    /** The title and the text of the dismiss dialog for suggestion [id]. */
    fun dismissTitle(id: String): String =
        tr(if (raw.firstOrNull { idOf(it) == id } is FinanceSuggestion.Link) "finance_dismiss_link_title" else "finance_dismiss_title")

    fun dismissText(id: String): String {
        val suggestion = raw.firstOrNull { idOf(it) == id } ?: return ""
        val key = if (suggestion is FinanceSuggestion.Link) "finance_dismiss_link_description" else "finance_dismiss_description"
        return tr(key, "title" to titleOf(suggestion))
    }

    fun dismissLabel(id: String): String =
        tr(if (raw.firstOrNull { idOf(it) == id } is FinanceSuggestion.Link) "finance_link_dismiss" else "finance_dismiss")

    fun sync() {
        if (current.syncing) return
        update { it.copy(syncing = true, syncError = null) }
        launch({ e ->
            val text = if (e.isNotFound) tr("finance_sync_not_connected") else e.message
            update { it.copy(syncing = false, syncError = text) }
        }) {
            val result = app.api.finance.financeSync()
            if (result.ok) {
                update { it.copy(syncing = false, notice = InboxNotice(tr("finance_sync_done"), null, null)) }
            } else {
                update { it.copy(syncing = false, syncError = tr("finance_sync_failed", "code" to (result.error?.code ?: "unknown"))) }
            }
            app.changed("costs")
        }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    fun dismissSyncError() {
        update { it.copy(syncError = null) }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    private fun acceptedMessage(
        suggestion: FinanceSuggestion,
        entityType: String,
    ): String {
        val title = titleOf(suggestion)
        val key =
            when {
                suggestion is FinanceSuggestion.Link -> "finance_accepted_link_toast"
                entityType == "cost" -> "finance_accepted_cost_toast"
                entityType == "asset" -> "finance_accepted_asset_toast"
                else -> "finance_accepted_bill_task_toast"
            }
        return tr(key, "title" to title)
    }

    private fun failed(
        e: UiError,
        suggestion: FinanceSuggestion,
    ) {
        val conflict = e.code == "conflict"
        val text =
            if (conflict) {
                tr(if (suggestion is FinanceSuggestion.Link) "finance_link_conflict" else "finance_conflict")
            } else {
                e.message
            }
        update { it.copy(busyId = null, busyAction = null, actionError = text) }
        if (conflict) load()
    }

    private fun load() {
        update { it.copy(loading = it.total == 0 && it.groups.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val connected =
                hasFinanceConnection(
                    app.api.integrations
                        .integrationsList()
                        .items,
                )
            raw =
                fetchAll { cursor ->
                    val page = app.api.finance.financeSuggestionsList(status = "pending", limit = 200, cursor = cursor)
                    page.items to page.nextCursor
                }
            val views = raw.mapNotNull(::suggestionView)
            val groups =
                SUGGESTION_KINDS.mapNotNull { kind ->
                    val items = views.filter { it.kind == kind }
                    if (items.isEmpty()) {
                        null
                    } else {
                        SuggestionGroup(
                            kind,
                            suggestionKindLabel(kind),
                            if (kind == "link") tr("finance_link_group_hint") else null,
                            items,
                        )
                    }
                }
            update {
                it.copy(
                    loading = false,
                    financeConnected = connected,
                    groups = groups,
                    total = views.size,
                    countText = tr("finance_count", "count" to views.size),
                )
            }
        }
    }
}
