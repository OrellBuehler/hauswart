package ch.orellbuehler.hauswart.feature.inbox

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

const val MENU_BUDGETS = "budgets"
const val MENU_RECURRING = "recurring"
const val MENU_INBOX = "inbox"
const val MENU_RECEIPTS = "receipts"
const val MENU_BOOKS = "books"
const val MENU_TAGS = "tags"

/** One entry of the menu of the costs tab; [key] is one of the `MENU_*` constants, [badge] a count or null. */
data class CostsMenuEntry(
    val key: String,
    val label: String,
    val badge: String?,
)

data class CostsMenuState(
    val entries: List<CostsMenuEntry> = emptyList(),
)

/**
 * What the menu of the costs tab offers: budgets, recurring costs, receipts, books and tags always, the finance inbox only
 * while a finance app is connected. The receipts entry carries the number of receipts that wait.
 */
class CostsMenuStore(
    private val app: HauswartApp,
) : Store<CostsMenuState>(CostsMenuState(entries = build(false, 0))) {
    init {
        onChange(app, "costs") { load() }
        load()
    }

    private fun load() {
        // The menu is a convenience: when the connections or the count cannot be read it keeps the entries that need neither.
        launch({ _ -> update { it.copy(entries = build(false, 0)) } }) {
            val (connected, pending) =
                coroutineScope {
                    val integrations =
                        async {
                            hasFinanceConnection(
                                app.api.integrations
                                    .integrationsList()
                                    .items,
                            )
                        }
                    val count =
                        async {
                            app.api.aiTasks
                                .aiTasksCount(status = "pending")
                                .count
                        }
                    integrations.await() to count.await()
                }
            update { it.copy(entries = build(connected, pending)) }
        }
    }

    private companion object {
        fun build(
            financeConnected: Boolean,
            pendingReceipts: Long,
        ): List<CostsMenuEntry> =
            listOfNotNull(
                CostsMenuEntry(MENU_BUDGETS, tr("budgets_title"), null),
                CostsMenuEntry(MENU_RECURRING, tr("recurrence_title"), null),
                if (financeConnected) CostsMenuEntry(MENU_INBOX, tr("finance_inbox_title"), null) else null,
                CostsMenuEntry(MENU_RECEIPTS, tr("receipts_title"), if (pendingReceipts > 0) pendingReceipts.toString() else null),
                CostsMenuEntry(MENU_BOOKS, tr("costbook_settings_title"), null),
                CostsMenuEntry(MENU_TAGS, tr("costtag_settings_title"), null),
            )
    }
}
