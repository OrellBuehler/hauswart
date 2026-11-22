package ch.orellbuehler.hauswart.feature.applink

/**
 * Where a link of the server points, as both apps understand it: a [kind] (one of the `LINK_*`
 * constants) and, for a single entry, its [id] (the slug for a documentation page). The apps turn
 * it into their own route; a list or section has no id.
 */
data class AppLink(
    val kind: String,
    val id: String?,
)

const val LINK_HOME = "home"
const val LINK_TASKS = "tasks"
const val LINK_TASK = "task"
const val LINK_APPOINTMENTS = "appointments"
const val LINK_APPOINTMENT = "appointment"
const val LINK_INVENTORY = "inventory"
const val LINK_ASSET = "asset"
const val LINK_ROOMS = "rooms"
const val LINK_ROOM = "room"
const val LINK_PLANTS = "plants"
const val LINK_DOCS = "docs"
const val LINK_DOC = "doc"
const val LINK_DOCUMENTS = "documents"
const val LINK_DEFECTS = "defects"
const val LINK_DEFECT = "defect"
const val LINK_PARTS = "parts"
const val LINK_PART = "part"
const val LINK_CONTACTS = "contacts"
const val LINK_CONTACT = "contact"
const val LINK_EMERGENCY = "emergency"
const val LINK_WARRANTIES = "warranties"
const val LINK_INSURANCE = "insurance"
const val LINK_POLICY = "policy"
const val LINK_COSTS = "costs"
const val LINK_COST = "cost"
const val LINK_NOTIFICATIONS = "notifications"
const val LINK_SEARCH = "search"
const val LINK_SETTINGS = "settings"

/** The sections of `/costs/<x>` that are pages of their own, not an entry with that id. */
private val costSections = setOf("balances", "budgets", "inbox", "new", "quick", "receipts", "recurring")

private val sections =
    mapOf(
        "tasks" to LINK_TASKS,
        "appointments" to LINK_APPOINTMENTS,
        "inventory" to LINK_INVENTORY,
        "rooms" to LINK_ROOMS,
        "plants" to LINK_PLANTS,
        "docs" to LINK_DOCS,
        "documents" to LINK_DOCUMENTS,
        "defects" to LINK_DEFECTS,
        "parts" to LINK_PARTS,
        "contacts" to LINK_CONTACTS,
        "emergency" to LINK_EMERGENCY,
        "warranties" to LINK_WARRANTIES,
        "insurance" to LINK_INSURANCE,
        "costs" to LINK_COSTS,
        "notifications" to LINK_NOTIFICATIONS,
        "search" to LINK_SEARCH,
        "settings" to LINK_SETTINGS,
    )

private val entries =
    mapOf(
        "tasks" to LINK_TASK,
        "appointments" to LINK_APPOINTMENT,
        "assets" to LINK_ASSET,
        "rooms" to LINK_ROOM,
        "docs" to LINK_DOC,
        "defects" to LINK_DEFECT,
        "parts" to LINK_PART,
        "contacts" to LINK_CONTACT,
        "insurance" to LINK_POLICY,
        "costs" to LINK_COST,
    )

/**
 * The [AppLink] a path of the web app (`/tasks/<id>`, `/defects/<id>`, `/assets/<id>`, `/parts/<id>`,
 * `/appointments/<id>`, `/costs/<id>`, `/docs/<slug>`, ...) stands for: the `url` of a notification or
 * a search hit. A query string or fragment is ignored, a path the app does not know, another origin
 * and anything that is not a path give null.
 */
fun routeForUrl(url: String?): AppLink? {
    val text = url?.trim().orEmpty()
    if (!text.startsWith("/") || text.startsWith("//") || text.contains('\\')) return null
    val path = text.substringBefore('#').substringBefore('?')
    val parts = path.split('/').filter { it.isNotEmpty() }.map { decodePathSegment(it) ?: return null }
    if (parts.isEmpty()) return AppLink(LINK_HOME, null)
    val first = parts[0]
    val second = parts.getOrNull(1)
    if (second == null || second == "new") return sections[first]?.let { AppLink(it, null) }
    if (first == "costs" && second in costSections) return AppLink(LINK_COSTS, null)
    if (first == "inventory") return AppLink(LINK_INVENTORY, null)
    val kind = entries[first] ?: return null
    return AppLink(kind, second)
}

private fun decodePathSegment(segment: String): String? {
    if ('%' !in segment) return segment
    val bytes = ArrayList<Byte>()
    var i = 0
    while (i < segment.length) {
        val c = segment[i]
        if (c == '%') {
            val code = segment.substring(i + 1, minOf(i + 3, segment.length)).takeIf { it.length == 2 }?.toIntOrNull(16) ?: return null
            bytes += code.toByte()
            i += 3
        } else {
            bytes += c.toString().encodeToByteArray().toList()
            i++
        }
    }
    return bytes.toByteArray().decodeToString()
}
