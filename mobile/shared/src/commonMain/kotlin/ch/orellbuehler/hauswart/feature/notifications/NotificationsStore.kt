package ch.orellbuehler.hauswart.feature.notifications

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.Notification
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.feature.applink.AppLink
import ch.orellbuehler.hauswart.feature.applink.LINK_TASK
import ch.orellbuehler.hauswart.feature.applink.routeForUrl
import ch.orellbuehler.hauswart.feature.files.nowMillis
import ch.orellbuehler.hauswart.feature.files.relativeInstant
import ch.orellbuehler.hauswart.i18n.I18n
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

private val calendarDate = Regex("^\\d{4}-\\d{2}-\\d{2}$")

/**
 * A notification's title in the reader's language: [titleKey] is a message key, [params] its values.
 * Numbers stay numbers (the messages use them for plurals); a `date` is written as a date.
 */
fun notificationText(
    titleKey: String,
    params: Map<String, JsonElement>,
): String {
    val args: Map<String, Any?> =
        params.mapValues { (name, value) ->
            val primitive = value as? JsonPrimitive
            when {
                primitive == null -> value.toString()
                primitive.isString && name == "date" ->
                    if (calendarDate.matches(
                            primitive.content,
                        )
                    ) {
                        Dates.format(primitive.content)
                    } else {
                        "–"
                    }
                primitive.isString -> primitive.content
                else -> primitive.longOrNull ?: primitive.doubleOrNull ?: primitive.content
            }
        }
    return I18n.t(titleKey, args)
}

/** One notification as the screen shows it. [kind] is `prep`, `due_soon`, `due`, `overdue`, `digest`, `info`, `comment` or `hint`. */
data class NotificationRow(
    val id: String,
    val kind: String,
    val text: String,
    /** "5 minutes ago". */
    val whenText: String,
    val whenFull: String,
    val unread: Boolean,
    /** What it leads to; null when it leads nowhere (tapping only marks it read). */
    val link: AppLink?,
)

data class NotificationsState(
    val loading: Boolean = true,
    val error: UiError? = null,
    /** Show only the unread ones. */
    val onlyUnread: Boolean = false,
    val rows: List<NotificationRow> = emptyList(),
    /** Unread notifications of the caller, whatever the filter. */
    val unreadCount: Int = 0,
    val hasMore: Boolean = false,
    val loadingMore: Boolean = false,
    val markingAll: Boolean = false,
    /** A failed "load more", mark read or mark all read; the list is still shown. */
    val actionError: UiError? = null,
)

/**
 * The caller's notifications, unread first. Tapping one: call [markRead], then follow its `link`.
 * After a change `notifications` is reported, which updates the bell on the home screen.
 */
class NotificationsStore(
    private val app: HauswartApp,
) : Store<NotificationsState>(NotificationsState()) {
    private var items: List<Notification> = emptyList()
    private var cursor: String? = null
    private var unread = 0L

    init {
        load()
    }

    fun refresh() {
        load()
    }

    fun setOnlyUnread(value: Boolean) {
        if (value == current.onlyUnread) return
        update { it.copy(onlyUnread = value, rows = emptyList(), loading = true) }
        items = emptyList()
        cursor = null
        load()
    }

    fun loadMore() {
        val next = cursor ?: return
        if (current.loadingMore) return
        update { it.copy(loadingMore = true, actionError = null) }
        launch({ e -> update { it.copy(loadingMore = false, actionError = e) } }) {
            val page = app.api.notifications.notificationsList(cursor = next, limit = PAGE_SIZE, unread = unreadFilter())
            items = items + page.items
            cursor = page.nextCursor
            show()
            update { it.copy(loadingMore = false) }
        }
    }

    /** Marks notification [id] read (nothing happens when it is). */
    fun markRead(id: String) {
        val notification = items.firstOrNull { it.id == id } ?: return
        if (notification.readAt != null) return
        launch({ e -> update { it.copy(actionError = e) } }) {
            val read = app.api.notifications.notificationsRead(id)
            items = items.map { if (it.id == id) read else it }
            unread = maxOf(0, unread - 1)
            show()
            app.changed("notifications")
        }
    }

    fun markAllRead() {
        if (current.markingAll || unread == 0L) return
        update { it.copy(markingAll = true, actionError = null) }
        launch({ e -> update { it.copy(markingAll = false, actionError = e) } }) {
            app.api.notifications.notificationsReadAll()
            val now = nowMillis()
            val stamp =
                kotlin.time.Instant
                    .fromEpochMilliseconds(now)
                    .toString()
            items = items.map { if (it.readAt == null) it.copy(readAt = stamp) else it }
            unread = 0
            show()
            update { it.copy(markingAll = false) }
            app.changed("notifications")
        }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun unreadFilter(): Boolean? = if (current.onlyUnread) true else null

    private fun load() {
        update { it.copy(loading = it.rows.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val page = app.api.notifications.notificationsList(limit = PAGE_SIZE, unread = unreadFilter())
            unread =
                app.api.notifications
                    .notificationsUnreadCount()
                    .count
            app.household.get()
            items = page.items
            cursor = page.nextCursor
            show()
            update { it.copy(loading = false) }
        }
    }

    private fun show() {
        val zone = app.household.timezone
        val now = nowMillis()
        val rows =
            items.map { n ->
                NotificationRow(
                    id = n.id,
                    kind = n.kind,
                    text = notificationText(n.titleKey, n.params),
                    whenText = relativeInstant(n.createdAt, zone, now),
                    whenFull = Dates.dateTime(n.createdAt, zone),
                    unread = n.readAt == null,
                    link = routeForUrl(n.url) ?: n.taskId?.let { AppLink(LINK_TASK, it) },
                )
            }
        update { it.copy(rows = rows, unreadCount = unread.toInt(), hasMore = cursor != null) }
    }

    private companion object {
        const val PAGE_SIZE = 30L
    }
}
