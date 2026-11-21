package ch.orellbuehler.hauswart.android.ui.nav

import android.net.Uri

/**
 * Every destination another feature may link to. A feature registers its routes in its own
 * `<Feature>Nav.kt` (`fun NavGraphBuilder.<feature>Graph(nav: NavController)`) and may add private
 * routes there; whatever other features link to is named here. Ids go through [arg]. The `*_ROUTE`
 * constants are the patterns the destinations are registered with.
 */
object Routes {
    const val HOME = "home"
    const val TASKS = "tasks"
    const val COSTS = "costs"
    const val MORE = "more"

    const val APPOINTMENTS = "appointments"
    const val INVENTORY = "inventory"
    const val ROOMS = "rooms"
    const val PLANTS = "plants"
    const val DOCS = "docs"
    const val DOCUMENTS = "documents"
    const val DEFECTS = "defects"
    const val PARTS = "parts"
    const val CONTACTS = "contacts"
    const val EMERGENCY = "emergency"
    const val WARRANTIES = "warranties"
    const val INSURANCE = "insurance"
    const val NOTIFICATIONS = "notifications"
    const val SEARCH = "search"
    const val SETTINGS = "settings"

    const val TASK_ROUTE = "tasks/{id}"
    const val TASK_NEW_ROUTE = "tasks/new?assetId={assetId}"
    const val APPOINTMENT_ROUTE = "appointments/{id}"
    const val ASSET_ROUTE = "assets/{id}"
    const val ASSET_NEW_ROUTE = "assets/new?kind={kind}&roomId={roomId}"
    const val ROOM_ROUTE = "rooms/{id}"
    const val DOC_ROUTE = "docs/{slug}"
    const val DEFECT_ROUTE = "defects/{id}"
    const val PART_ROUTE = "parts/{id}"
    const val CONTACT_ROUTE = "contacts/{id}"
    const val COST_ROUTE = "costs/entry/{id}"
    const val COST_NEW_ROUTE = "costs/new?book={book}&asset={asset}"
    const val COSTS_QUICK_ROUTE = "costs/quick?book={book}"
    const val COSTS_BALANCES_ROUTE = "costs/balances?book={book}"
    const val INSURANCE_ROUTE = "insurance/{id}"

    // Defects: the form is a screen of its own so that devices and rooms can record a defect.
    const val DEFECT_NEW_ROUTE = "defects/new?assetId={assetId}&roomId={roomId}"

    // Settings sub-screens
    const val SETTINGS_NOTIFICATIONS = "settings/notifications"
    const val SETTINGS_REMINDERS = "settings/reminders"
    const val SETTINGS_HOUSEHOLD = "settings/household"
    const val SETTINGS_INTEGRATIONS = "settings/integrations"
    const val SETTINGS_INTEGRATION_ROUTE = "settings/integrations/{kind}"
    const val SETTINGS_CALENDAR = "settings/calendar"

    // Costs: budgets, recurring costs, the finance inbox, receipts, books and tags
    const val COSTS_BUDGETS = "costs/budgets"
    const val COSTS_RECURRING = "costs/recurring"
    const val RECURRING_ROUTE = "costs/recurring/{id}"
    const val COSTS_INBOX = "costs/inbox"
    const val COSTS_RECEIPTS_ROUTE = "costs/receipts?status={status}"
    const val COST_BOOKS = "costs/books"
    const val COST_TAGS = "costs/tags"

    // Appointments: the form is a screen of its own so that the cards on tasks, devices and contacts can link to it.
    const val APPOINTMENT_NEW_ROUTE =
        "appointments/new?taskId={taskId}&assetId={assetId}&contactId={contactId}&occurrenceKey={occurrenceKey}"
    const val APPOINTMENT_EDIT_ROUTE = "appointments/{id}/edit"

    fun appointmentNew(
        taskId: String = "",
        assetId: String = "",
        contactId: String = "",
        occurrenceKey: String = "",
    ): String {
        val query =
            listOf("taskId" to taskId, "assetId" to assetId, "contactId" to contactId, "occurrenceKey" to occurrenceKey)
                .filter { it.second.isNotEmpty() }
                .joinToString("&") { "${it.first}=${arg(it.second)}" }
        return "appointments/new" + if (query.isEmpty()) "" else "?$query"
    }

    fun appointmentEdit(id: String) = "appointments/${arg(id)}/edit"

    fun task(id: String) = "tasks/${arg(id)}"

    fun taskNew(assetId: String? = null) = "tasks/new" + (assetId?.let { "?assetId=${arg(it)}" } ?: "")

    fun appointment(id: String) = "appointments/${arg(id)}"

    fun asset(id: String) = "assets/${arg(id)}"

    /** The form for a new asset; [kind] is device, plant, vehicle, fixture or other. */
    fun assetNew(
        kind: String? = null,
        roomId: String? = null,
    ): String {
        val query = listOfNotNull(kind?.let { "kind=${arg(it)}" }, roomId?.let { "roomId=${arg(it)}" }).joinToString("&")
        return "assets/new" + if (query.isEmpty()) "" else "?$query"
    }

    fun room(id: String) = "rooms/${arg(id)}"

    fun doc(slug: String) = "docs/${arg(slug)}"

    fun defect(id: String) = "defects/${arg(id)}"

    fun part(id: String) = "parts/${arg(id)}"

    fun contact(id: String) = "contacts/${arg(id)}"

    fun cost(id: String) = "costs/entry/${arg(id)}"

    /** The full entry form; [bookArg] is a book id or `all`, [assetId] ties the new entry to a device. */
    fun costNew(
        bookArg: String? = null,
        assetId: String? = null,
    ) = "costs/new?" + listOfNotNull(bookArg?.let { "book=${arg(it)}" }, assetId?.let { "asset=${arg(it)}" }).joinToString("&")

    /** The quick entry form; [bookArg] is a book id or `all`. */
    fun costsQuick(bookArg: String? = null) = "costs/quick" + (bookArg?.let { "?book=${arg(it)}" } ?: "")

    /** Balances and settlements; [bookArg] is a book id or `all`. */
    fun costsBalances(bookArg: String? = null) = "costs/balances" + (bookArg?.let { "?book=${arg(it)}" } ?: "")

    /** The form for a new defect, optionally for a device or a room. */
    fun defectNew(
        assetId: String? = null,
        roomId: String? = null,
    ): String {
        val query = listOfNotNull(assetId?.let { "assetId=${arg(it)}" }, roomId?.let { "roomId=${arg(it)}" }).joinToString("&")
        return "defects/new" + if (query.isEmpty()) "" else "?$query"
    }

    fun insurance(id: String) = "insurance/${arg(id)}"

    fun settingsIntegration(kind: String) = "settings/integrations/${arg(kind)}"

    fun recurring(id: String) = "costs/recurring/${arg(id)}"

    /** The receipt queue; [status] is `pending`, `done` or `dismissed` (none lists everything). */
    fun costsReceipts(status: String? = null) = "costs/receipts" + (status?.let { "?status=${arg(it)}" } ?: "")

    fun arg(value: String): String = Uri.encode(value)
}
