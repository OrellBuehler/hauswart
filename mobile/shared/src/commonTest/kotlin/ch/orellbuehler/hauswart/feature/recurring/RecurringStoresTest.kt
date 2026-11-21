package ch.orellbuehler.hauswart.feature.recurring

import ch.orellbuehler.hauswart.feature.costs.costBook
import ch.orellbuehler.hauswart.feature.costs.costEntry
import ch.orellbuehler.hauswart.feature.costs.page
import ch.orellbuehler.hauswart.feature.costsplit.settle
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RecurringStoresTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun String?.q() = if (this == null) "null" else "\"$this\""

    private fun recurrence(
        id: String,
        title: String = "Miete",
        active: Boolean = true,
        next: String? = "2099-12-01",
        last: String? = null,
        lastError: String? = null,
        end: String? = null,
        amount: Long = 150000,
    ) = """{"id":"$id","bookId":"b1","bookName":"Haushalt","title":"$title","amountMinor":$amount,"currency":"CHF","category":"other",
        "assetId":null,"assetName":null,"roomId":null,"roomName":null,"payee":null,"notes":null,"paidByUserId":"u1","paidByName":"Anna",
        "splitMode":"ownership","shares":null,"participantIds":null,"tags":[],"countsAsExpense":true,"deductible":"unknown",
        "frequency":"monthly","interval":1,"dayOfMonth":1,"startDate":"2026-01-01","endDate":${end.q()},"nextDate":${next.q()},
        "lastOccurrenceDate":${last.q()},"active":$active,"lastError":${lastError.q()},"createdBy":"u1",
        "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

    private fun users() = server.household()

    @Test
    fun theListGroupsByStateAndExplainsAFailedBooking() =
        runTest {
            users()
            server.on(
                "GET",
                "/api/v1/cost-recurrences",
                """{"items":[${recurrence(
                    "r1",
                )},${recurrence("r2", title = "Abo", active = false)},${recurrence("r3", title = "Alt", next = null)},
                    ${recurrence("r4", title = "Kaputt", lastError = "book_archived")}]}""",
            )
            val store = RecurringListStore(app)
            val state = store.await { !it.loading }
            assertEquals(listOf("active", "paused", "finished"), state.sections.map { it.state })
            val active = state.sections.first().rows
            assertEquals(listOf("r1", "r4"), active.map { it.id })
            assertEquals(tr("recurrence_error_book_archived", "book" to "Haushalt"), active.last().error)
            assertEquals(
                tr("recurrence_over"),
                state.sections
                    .last()
                    .rows
                    .single()
                    .nextText,
            )
            settle()
            store.close()
        }

    @Test
    fun runningNowReportsTheBookedEntry() =
        runTest {
            users()
            val r = recurrence("r1", next = "2020-01-01")
            server.on("GET", "/api/v1/cost-recurrences", """{"items":[$r]}""")
            server.on("POST", "/api/v1/cost-recurrences/r1/run-now", """{"recurrence":$r,"entry":${costEntry("e1", title = "Miete")}}""")
            val store = RecurringListStore(app)
            val loaded = store.await { !it.loading }
            assertTrue(
                loaded.sections
                    .single()
                    .rows
                    .single()
                    .due,
            )
            store.runNow("r1")
            val state = store.await { it.notice != null }
            assertEquals("e1", state.notice?.entryId)
            settle()
            store.close()
        }

    @Test
    fun runningNowWithNothingDueSaysWhenTheNextOneIs() =
        runTest {
            users()
            val r = recurrence("r1", next = "2099-12-01")
            server.on("GET", "/api/v1/cost-recurrences", """{"items":[$r]}""")
            server.on("POST", "/api/v1/cost-recurrences/r1/run-now", """{"recurrence":$r,"entry":null}""")
            val store = RecurringListStore(app)
            store.await { !it.loading }
            store.runNow("r1")
            val state = store.await { it.notice != null }
            assertNull(state.notice?.entryId)
            assertTrue(
                state.notice
                    ?.message
                    .orEmpty()
                    .contains("2099"),
            )
            settle()
            store.close()
        }

    @Test
    fun aClosedBookOnRunNowIsWordedAsSuch() =
        runTest {
            users()
            server.on("GET", "/api/v1/cost-recurrences", """{"items":[${recurrence("r1", next = "2020-01-01")}]}""")
            server.onError(
                "POST",
                "/api/v1/cost-recurrences/r1/run-now",
                HttpStatusCode.BadRequest,
                "invalid_request",
                details = """{"body":{"formErrors":[],"fieldErrors":{"bookId":["closed"]}}}""",
            )
            val store = RecurringListStore(app)
            store.await { !it.loading }
            store.runNow("r1")
            val state = store.await { it.actionError != null }
            assertEquals(tr("recurrence_error_book_archived", "book" to "Haushalt"), state.actionError?.message)
            settle()
            store.close()
        }

    @Test
    fun pausingAndResumingSendTheActiveFlag() =
        runTest {
            users()
            server.on("GET", "/api/v1/cost-recurrences/r1", recurrence("r1"))
            server.on("PATCH", "/api/v1/cost-recurrences/r1", recurrence("r1", active = false))
            val store = RecurringDetailStore(app, "r1")
            val loaded = store.await { it.recurrence != null }
            assertTrue(assertNotNull(loaded.recurrence).canPause)
            store.pause()
            store.await { it.notice != null }
            assertEquals(
                false,
                server
                    .requestsTo("PATCH", "/api/v1/cost-recurrences/r1")
                    .single()
                    .json
                    .getValue("active")
                    .jsonPrimitive.booleanOrNull,
            )
            settle()
            store.close()
        }

    @Test
    fun deletingClosesTheDetail() =
        runTest {
            users()
            server.on("GET", "/api/v1/cost-recurrences/r1", recurrence("r1"))
            server.on("DELETE", "/api/v1/cost-recurrences/r1", "", HttpStatusCode.NoContent)
            val store = RecurringDetailStore(app, "r1")
            store.await { it.recurrence != null }
            store.delete()
            assertTrue(store.await { it.deleted }.deleted)
            settle()
            store.close()
        }

    private fun formContext() {
        users()
        server.on("GET", "/api/v1/cost-books", page(costBook("b1", "Haushalt", isDefault = true, split = "ownership")))
        server.on("GET", "/api/v1/cost-tags", """{"items":[]}""")
        server.on("GET", "/api/v1/assets", page())
        server.on("GET", "/api/v1/rooms", page())
    }

    @Test
    fun theNewFormStartsToday() =
        runTest {
            formContext()
            val store = RecurringEditStore(app, null)
            val state = store.await { it.initial != null }
            val form = assertNotNull(state.initial)
            assertEquals("b1", form.bookId)
            assertEquals("CHF", form.currency)
            assertEquals("u1", form.paidByUserId)
            assertEquals(app.household.today(), form.startDate)
            assertEquals(
                app.household
                    .today()
                    .drop(8)
                    .take(2)
                    .toInt()
                    .toString(),
                form.dayOfMonth,
            )
            settle()
            store.close()
        }

    @Test
    fun theDayFollowsTheStartDateUntilTyped() =
        runTest {
            formContext()
            val store = RecurringEditStore(app, null)
            val form = assertNotNull(store.await { it.initial != null }.initial)
            val moved = store.withStartDate(form, "2030-05-17")
            assertEquals("17", moved.dayOfMonth)
            val typed = store.withDay(moved, "31")
            assertEquals("31", store.withStartDate(typed, "2030-06-03").dayOfMonth)
            settle()
            store.close()
        }

    @Test
    fun invalidRhythmFieldsAreRefusedWithoutAskingTheServer() =
        runTest {
            formContext()
            val store = RecurringEditStore(app, null)
            val form = assertNotNull(store.await { it.initial != null }.initial)
            store.save(form.copy(title = "", amount = "10", interval = "13", dayOfMonth = "0"))
            val state = store.await { it.fieldErrors.isNotEmpty() }
            assertEquals(tr("m_field_required"), state.fieldErrors["title"])
            assertEquals(tr("recurrence_error_interval"), state.fieldErrors["interval"])
            assertEquals(tr("recurrence_error_day"), state.fieldErrors["dayOfMonth"])
            assertTrue(server.requestsTo("POST", "/api/v1/cost-recurrences").isEmpty())
            settle()
            store.close()
        }

    @Test
    fun creatingSendsTemplateAndRule() =
        runTest {
            formContext()
            server.on("POST", "/api/v1/cost-recurrences", recurrence("n1"), HttpStatusCode.Created)
            val store = RecurringEditStore(app, null)
            val form = assertNotNull(store.await { it.initial != null }.initial)
            store.save(
                store
                    .withStartDate(
                        form,
                        "2099-02-01",
                    ).copy(title = " Miete ", amount = "1'500.00", category = "other", frequency = "quarterly"),
            )
            assertEquals("n1", store.await { it.savedId != null }.savedId)
            val body = server.requestsTo("POST", "/api/v1/cost-recurrences").single().json
            assertEquals("Miete", body.getValue("title").jsonPrimitive.content)
            assertEquals("150000", body.getValue("amountMinor").jsonPrimitive.content)
            assertEquals("quarterly", body.getValue("frequency").jsonPrimitive.content)
            assertEquals("1", body.getValue("dayOfMonth").jsonPrimitive.content)
            assertEquals("2099-02-01", body.getValue("startDate").jsonPrimitive.content)
            assertNull(body["endDate"])
            settle()
            store.close()
        }

    @Test
    fun updatingSendsOnlyTheChangesAndNullToRemoveTheEnd() =
        runTest {
            formContext()
            server.on("GET", "/api/v1/cost-recurrences/r1", recurrence("r1", end = "2099-01-01"))
            server.on("PATCH", "/api/v1/cost-recurrences/r1", recurrence("r1"))
            val store = RecurringEditStore(app, "r1")
            val form = assertNotNull(store.await { it.initial != null && !it.loading }.initial)
            assertEquals("1500.00", form.amount)
            store.save(form.copy(endDate = "", title = "Wohnung"))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/cost-recurrences/r1").single().json
            assertEquals(JsonNull, body["endDate"])
            assertEquals("Wohnung", body.getValue("title").jsonPrimitive.content)
            assertNull(body["amountMinor"])
            assertNull(body["frequency"])
            settle()
            store.close()
        }

    @Test
    fun theViewWarnsAboutImmediateBookingsAndPreviewsDates() =
        runTest {
            formContext()
            val store = RecurringEditStore(app, null)
            val form = assertNotNull(store.await { it.initial != null }.initial)
            val past = store.view(store.withStartDate(form, "2020-01-01"))
            assertNotNull(past.immediateWarning)
            assertNotNull(past.ruleText)
            val future = store.view(store.withStartDate(form, "2099-01-01"))
            assertNull(future.immediateWarning)
            assertEquals(3, future.upcoming.size)
            assertNull(store.view(form.copy(interval = "0")).ruleText)
            settle()
            store.close()
        }
}
