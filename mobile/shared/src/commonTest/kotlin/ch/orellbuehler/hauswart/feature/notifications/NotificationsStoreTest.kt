package ch.orellbuehler.hauswart.feature.notifications

import ch.orellbuehler.hauswart.feature.applink.AppLink
import ch.orellbuehler.hauswart.feature.applink.LINK_APPOINTMENT
import ch.orellbuehler.hauswart.feature.applink.LINK_HOME
import ch.orellbuehler.hauswart.feature.applink.LINK_TASK
import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.seconds

class NotificationsStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun notification(
        id: String,
        titleKey: String = "notification_due",
        params: String = """{"title":"Change filter","date":"2026-03-05"}""",
        url: String? = "/tasks/t1",
        read: Boolean = false,
        taskId: String? = "t1",
        kind: String = "due",
    ): String =
        """{"id":"$id","kind":"$kind","taskId":${if (taskId == null) "null" else "\"$taskId\""},"titleKey":"$titleKey","params":$params,
            "url":${if (url == null) "null" else "\"$url\""},"createdAt":"2026-01-01T10:00:00.000Z","readAt":${if (read) "\"2026-01-01T11:00:00.000Z\"" else "null"}}"""

    private fun page(
        vararg items: String,
        next: String? = null,
    ) = """{"items":[${items.joinToString(",")}],"nextCursor":${if (next == null) "null" else "\"$next\""}}"""

    private fun unread(count: Int) = server.on("GET", "/api/v1/notifications/unread-count", """{"count":$count}""")

    private fun store(): NotificationsStore {
        server.household()
        return NotificationsStore(app)
    }

    @Test
    fun rendersTitlesFromKeyAndParams() {
        I18n.locale = "de"
        val cases =
            listOf(
                Triple(
                    "notification_due",
                    mapOf("title" to JsonPrimitive("Change filter"), "date" to JsonPrimitive("2026-03-05")),
                    "«Change filter» ist fällig (05.03.2026)",
                ),
                Triple(
                    "notification_due",
                    mapOf("title" to JsonPrimitive("Change filter"), "date" to JsonPrimitive("soon")),
                    "«Change filter» ist fällig (–)",
                ),
                Triple(
                    "notification_overdue",
                    mapOf("title" to JsonPrimitive("X"), "days" to JsonPrimitive(3), "date" to JsonPrimitive("2026-03-01")),
                    "«X» ist seit 3 Tagen überfällig (fällig am 01.03.2026)",
                ),
                Triple(
                    "notification_digest",
                    mapOf("overdue" to JsonPrimitive(1), "due" to JsonPrimitive(2), "soon" to JsonPrimitive(3.0)),
                    "Heute: 1 überfällig, 2 fällig, 3 bald fällig",
                ),
                Triple(
                    "notification_due_notes",
                    mapOf("title" to JsonPrimitive("X"), "date" to JsonPrimitive("2026-03-05"), "notes" to JsonPrimitive(1)),
                    "«X» ist fällig (05.03.2026) · 1 offenes Anliegen",
                ),
                Triple("notification_info", mapOf("message" to JsonPrimitive("Hello")), "Hello"),
            )
        cases.forEach { (key, params, text) -> assertEquals(text, notificationText(key, params), key) }
    }

    @Test
    fun loadsUnreadFirstWithLinksAndTexts() =
        runTest {
            server.on(
                "GET",
                "/api/v1/notifications",
                page(
                    notification("n1"),
                    notification("n2", url = null, read = true),
                    notification(
                        "n3",
                        url = "/appointments/ap1",
                        taskId = null,
                        kind = "info",
                        titleKey = "notification_info",
                        params = """{"message":"Hi"}""",
                    ),
                    notification("n4", url = "/", taskId = null),
                    notification("n5", url = "//evil.example.org", taskId = null),
                ),
            )
            unread(3)
            val store = store()
            val state = store.await { !it.loading }
            assertNull(state.error)
            assertEquals(3, state.unreadCount)
            assertEquals(listOf(true, false, true, true, true), state.rows.map { it.unread })
            assertEquals(
                listOf(
                    AppLink(LINK_TASK, "t1"),
                    AppLink(LINK_TASK, "t1"),
                    AppLink(LINK_APPOINTMENT, "ap1"),
                    AppLink(LINK_HOME, null),
                    null,
                ),
                state.rows.map { it.link },
            )
            assertEquals("Hi", state.rows[2].text)
            assertTrue(state.rows[0].text.contains("Change filter"))
            assertTrue("limit=30" in server.requests.first { it.path == "/api/v1/notifications" }.query)
            store.close()
        }

    @Test
    fun aFailedLoadSetsTheError() =
        runTest {
            server.onError("GET", "/api/v1/notifications", HttpStatusCode.InternalServerError, "internal_error")
            unread(0)
            val store = store()
            val state = store.await { !it.loading }
            assertEquals(tr("m_error_server"), state.error?.message)
            store.close()
        }

    @Test
    fun theUnreadFilterAsksTheServer() =
        runTest {
            server.on("GET", "/api/v1/notifications", page(notification("n1"), notification("n2", read = true)))
            unread(1)
            val store = store()
            store.await { !it.loading }
            server.on("GET", "/api/v1/notifications", page(notification("n1")))
            store.setOnlyUnread(true)
            val state = store.await { it.onlyUnread && !it.loading && it.rows.size == 1 }
            assertTrue("unread=true" in server.requests.last { it.path == "/api/v1/notifications" }.query)
            assertEquals(listOf("n1"), state.rows.map { it.id })
            store.close()
        }

    @Test
    fun loadMoreAppendsTheNextPage() =
        runTest {
            server.on("GET", "/api/v1/notifications", page(notification("n1"), next = "c2"))
            unread(1)
            val store = store()
            assertTrue(store.await { !it.loading }.hasMore)
            server.on("GET", "/api/v1/notifications", page(notification("n2")))
            store.loadMore()
            val state = store.await { it.rows.size == 2 && !it.loadingMore }
            assertEquals(listOf("n1", "n2"), state.rows.map { it.id })
            assertTrue(!state.hasMore)
            assertTrue("cursor=c2" in server.requests.last { it.path == "/api/v1/notifications" }.query)
            store.close()
        }

    @Test
    fun markingOneReadUpdatesTheRowAndTheBell() =
        runTest {
            server.on("GET", "/api/v1/notifications", page(notification("n1"), notification("n2")))
            unread(2)
            val store = store()
            store.await { !it.loading }
            server.on("POST", "/api/v1/notifications/n1/read", notification("n1", read = true))
            val change = async(Dispatchers.Unconfined) { app.changes.first() }

            store.markRead("n1")
            val state =
                store.await {
                    it.rows
                        .first()
                        .unread
                        .not()
                }
            assertEquals(1, state.unreadCount)
            assertEquals("notifications", withContext(Dispatchers.Default) { withTimeout(10.seconds) { change.await() } })

            store.markRead("n1")
            assertEquals(1, server.requestsTo("POST", "/api/v1/notifications/n1/read").size)
            store.close()
        }

    @Test
    fun aFailedMarkReadReports() =
        runTest {
            server.on("GET", "/api/v1/notifications", page(notification("n1")))
            unread(1)
            server.onError("POST", "/api/v1/notifications/n1/read", HttpStatusCode.NotFound, "not_found")
            val store = store()
            store.await { !it.loading }
            store.markRead("n1")
            val state = store.await { it.actionError != null }
            assertTrue(state.rows.first().unread)
            store.dismissActionError()
            assertNull(store.value.actionError)
            store.close()
        }

    @Test
    fun markingAllReadClearsTheUnreadMarks() =
        runTest {
            server.on("GET", "/api/v1/notifications", page(notification("n1"), notification("n2")))
            unread(2)
            val store = store()
            store.await { !it.loading }
            server.on("POST", "/api/v1/notifications/read-all", """{"updated":2}""")
            store.markAllRead()
            val state = store.await { !it.markingAll && it.unreadCount == 0 }
            assertTrue(state.rows.none { it.unread })
            assertEquals(1, server.requestsTo("POST", "/api/v1/notifications/read-all").size)

            store.markAllRead()
            assertEquals(1, server.requestsTo("POST", "/api/v1/notifications/read-all").size)
            store.close()
        }
}
