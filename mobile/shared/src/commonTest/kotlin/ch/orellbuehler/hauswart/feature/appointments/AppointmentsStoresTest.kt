package ch.orellbuehler.hauswart.feature.appointments

import ch.orellbuehler.hauswart.api.ApiHttp
import ch.orellbuehler.hauswart.api.generated.Appointment
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AppointmentsStoresTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @BeforeTest
    fun german() {
        I18n.locale = "de"
    }

    @AfterTest
    fun tearDown() {
        server.close()
        I18n.locale = "de"
    }

    private val today = Dates.today(ZONE)

    private fun day(offset: Int) = Dates.addDays(today, offset)

    private fun json(a: Appointment) = ApiHttp.JSON.encodeToString(Appointment.serializer(), a)

    private fun page(vararg items: Appointment) = """{"items":[${items.joinToString(",") { json(it) }}],"nextCursor":null}"""

    private fun planned(
        id: String,
        offset: Int,
        title: String = "Visit $id",
        length: Int = 0,
    ) = allDay(id, day(offset), day(offset + length), title)

    private fun taskJson(
        id: String,
        title: String,
        archived: Boolean = false,
    ) =
        """{"id":"$id","title":"$title","descriptionMd":"","category":"maintenance","priority":"normal","effortMinutes":null,"assetId":null,"assetName":null,
            "roomId":null,"roomName":null,"trigger":{"type":"interval","v":1,"every":2,"unit":"week","anchor":"completion","startDate":"2026-01-05"},
            "assignMode":"none","assigneeUserId":null,"rotationOrder":[],"rotationStrategy":"alternate","notifyMode":"assignee","graceDays":0,"dueSoonDays":null,
            "snoozedUntil":null,"archivedAt":${if (archived) "\"2026-01-01T00:00:00.000Z\"" else "null"},"source":"manual","externalSource":null,
            "externalRef":null,"externalUrl":null,"createdBy":null,"commentCount":0,"openNoteCount":0,"nextAppointment":null,
            "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","state":null}"""

    private fun completionJson() =
        """{"id":"k1","taskId":"t1","taskTitle":"Change filter","kind":"done","source":"manual","completedAt":"2026-01-01T00:00:00.000Z",
            "completedDate":"2026-01-01","userId":null,"userName":null,"counterValue":null,"occurrenceKey":null,"dueDateAtCompletion":null,
            "note":null,"revokedAt":null,"createdAt":"2026-01-01T00:00:00.000Z"}"""

    // ---- list ----------------------------------------------------------------------------------

    @Test
    fun theUpcomingListSplitsOpenFromDays() =
        runTest {
            server.household()
            server.on(
                "GET",
                "/api/v1/appointments",
                page(planned("o", -3), planned("t", 0), planned("l", 4), planned("d", -2).copy(status = "done")),
            )
            val store = AppointmentsListStore(app)
            val state = store.await { !it.loading }
            assertNull(state.error)
            assertEquals(listOf("o"), state.stillOpen.map { it.id })
            assertTrue(state.stillOpen.single().needsClosing)
            assertEquals(listOf(day(0), day(4)), state.days.map { it.date })
            assertEquals(3, state.total)
            assertEquals(
                "ganztägig",
                state.days[0]
                    .items
                    .single()
                    .timePrimary,
            )
            assertTrue(state.days[0].heading.startsWith("Heute"))
            assertTrue(!state.filtered)
            val request = server.requests.first { it.path == "/api/v1/appointments" }
            assertTrue("from=${day(-30)}" in request.query && "to=" !in request.query)
            store.close()
        }

    @Test
    fun statusChipsFilterWithoutAskingAgain() =
        runTest {
            server.household()
            server.on(
                "GET",
                "/api/v1/appointments",
                page(planned("p", 2), planned("d", 3).copy(status = "done"), planned("c", 4).copy(status = "cancelled")),
            )
            val store = AppointmentsListStore(app)
            store.await { !it.loading }
            store.toggleStatus("done")
            val both = store.await { it.statuses == listOf("planned", "done") }
            assertEquals(2, both.total)
            assertTrue(both.filtered)
            store.toggleStatus("planned")
            store.toggleStatus("done")
            assertEquals(listOf("done"), store.value.statuses)
            assertEquals(
                listOf("d"),
                store.value.days
                    .flatMap { it.items }
                    .map { it.id },
            )
            store.resetFilters()
            assertEquals(listOf("planned"), store.value.statuses)
            assertEquals(1, server.requestsTo("GET", "/api/v1/appointments").size)
            store.close()
        }

    @Test
    fun thePastViewAsksForItsWindowAndLoadsOlderOnRequest() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/appointments", page(planned("u", 3)))
            val store = AppointmentsListStore(app)
            store.await { !it.loading }
            server.on(
                "GET",
                "/api/v1/appointments",
                page(planned("p1", -10).copy(status = "done"), planned("p2", -20).copy(status = "cancelled")),
            )
            store.setView("past")
            val past = store.await { it.view == "past" && !it.loading && it.total == 2 }
            assertEquals(APPOINTMENT_STATUSES, past.statuses)
            assertEquals(listOf(day(-10), day(-20)), past.days.map { it.date })
            val request = server.requests.last { it.path == "/api/v1/appointments" }
            assertTrue("from=${day(-365)}" in request.query && "to=${day(-1)}" in request.query)

            server.on("GET", "/api/v1/appointments", page(planned("old", -400).copy(status = "done")))
            store.loadOlder()
            val withOlder = store.await { it.olderLoaded && !it.loadingOlder }
            assertEquals(3, withOlder.total)
            assertTrue("to=${day(-366)}" in server.requests.last { it.path == "/api/v1/appointments" }.query)
            store.close()
        }

    @Test
    fun aFailedLoadSetsTheError() =
        runTest {
            server.household()
            server.onError("GET", "/api/v1/appointments", HttpStatusCode.InternalServerError, "internal_error")
            val store = AppointmentsListStore(app)
            val state = store.await { !it.loading }
            assertEquals(tr("m_error_server"), state.error?.message)
            store.close()
        }

    // ---- section -------------------------------------------------------------------------------

    @Test
    fun theCardListsThePlannedOnesOfTheTask() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/appointments", page(planned("b", 5, "Later"), planned("a", 1, "Sooner")))
            val store = AppointmentsSectionStore(app, "t1", "", "")
            val state = store.await { !it.loading }
            assertEquals(listOf("a", "b"), state.rows.map { it.id })
            assertEquals(tr("appointments_card_empty_task"), state.emptyBody)
            val query = server.requests.first { it.path == "/api/v1/appointments" }.query
            assertTrue("taskId=t1" in query && "status=planned" in query && "assetId" !in query && "contactId" !in query)
            store.close()
        }

    @Test
    fun theCardOfADeviceAndAContactFilterByThem() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/appointments", page())
            val asset = AppointmentsSectionStore(app, "", "a1", "")
            val contact = AppointmentsSectionStore(app, "", "", "c1")
            asset.await { !it.loading }
            contact.await { !it.loading }
            assertEquals(tr("appointments_card_empty_asset"), asset.value.emptyBody)
            assertEquals(tr("appointments_card_empty_contact"), contact.value.emptyBody)
            val queries = server.requestsTo("GET", "/api/v1/appointments").map { it.query }
            assertTrue(queries.any { "assetId=a1" in it } && queries.any { "contactId=c1" in it })
            asset.close()
            contact.close()
        }

    // ---- detail --------------------------------------------------------------------------------

    private fun withTask(a: Appointment) = a.copy(taskId = "t1", taskTitle = "Change filter", occurrenceKey = "2026-12-01")

    @Test
    fun theDetailShowsWhenLinksAndTheCompletionHint() =
        runTest {
            server.household()
            server.on(
                "GET",
                "/api/v1/appointments/a1",
                json(withTask(planned("a1", 2, "Boiler service")).copy(location = "Cellar", notes = "Bring keys")),
            )
            val store = AppointmentDetailStore(app, "a1")
            val state = store.await { it.detail != null }
            val detail = assertNotNull(state.detail)
            assertEquals("Boiler service", detail.title)
            assertEquals("in 2 Tagen", detail.relativeText)
            assertEquals(tr("appointment_status_planned"), detail.statusLabel)
            assertEquals("Cellar", detail.location)
            assertEquals(listOf("task"), detail.links.map { it.kind })
            assertEquals("Change filter", detail.links.single().name)
            assertEquals(tr("appointment_complete_task_hint", "task" to "Change filter"), detail.completeHint)
            assertTrue(detail.planned)
            assertEquals("", detail.updatedText)
            store.close()
        }

    @Test
    fun anOverPlannedAppointmentIsStillOpen() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/appointments/a1", json(planned("a1", -3)))
            val store = AppointmentDetailStore(app, "a1")
            val detail = assertNotNull(store.await { it.detail != null }.detail)
            assertTrue(detail.needsClosing)
            assertEquals(tr("appointment_open_badge"), detail.statusLabel)
            assertEquals("due", detail.statusTone)
            assertEquals("vor 3 Tagen", detail.relativeText)
            store.close()
        }

    @Test
    fun completingAlsoCompletesTheTaskAndSaysSo() =
        runTest {
            server.household()
            val a = withTask(planned("a1", 0, "Boiler service"))
            server.on("GET", "/api/v1/appointments/a1", json(a))
            val store = AppointmentDetailStore(app, "a1")
            store.await { it.detail != null }
            server.on(
                "POST",
                "/api/v1/appointments/a1/complete",
                """{"appointment":${json(
                    a.copy(status = "done"),
                )},"completion":${completionJson()},"task":${taskJson("t1", "Change filter")},"replayed":false}""",
            )
            store.complete()
            val state = store.await { it.completion != null }
            val completion = assertNotNull(state.completion)
            assertEquals("t1", completion.taskId)
            assertTrue(completion.taskDone)
            assertEquals(tr("appointment_result_task_done", "title" to "Change filter"), completion.title)
            assertEquals(tr("appointment_done_toast", "title" to "Boiler service"), state.notice)
            assertEquals("done", state.detail?.status)
            assertEquals("{}", server.requestsTo("POST", "/api/v1/appointments/a1/complete").single().body)
            store.dismissNotice()
            assertEquals("", store.value.notice)
            store.close()
        }

    @Test
    fun anArchivedTaskStaysAsItIs() =
        runTest {
            server.household()
            val a = withTask(planned("a1", 0))
            server.on("GET", "/api/v1/appointments/a1", json(a))
            val store = AppointmentDetailStore(app, "a1")
            store.await { it.detail != null }
            server.on(
                "POST",
                "/api/v1/appointments/a1/complete",
                """{"appointment":${json(
                    a.copy(status = "done"),
                )},"completion":null,"task":${taskJson("t1", "Change filter", archived = true)},"replayed":false}""",
            )
            store.complete()
            val completion = assertNotNull(store.await { it.completion != null }.completion)
            assertTrue(!completion.taskDone)
            assertEquals(tr("appointment_result_task_archived"), completion.hint)
            store.close()
        }

    @Test
    fun completingACancelledAppointmentExplainsTheConflict() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/appointments/a1", json(planned("a1", 0)))
            server.onError("POST", "/api/v1/appointments/a1/complete", HttpStatusCode.Conflict, "conflict", "Conflict")
            val store = AppointmentDetailStore(app, "a1")
            store.await { it.detail != null }
            store.complete()
            val state = store.await { it.actionError != null }
            assertEquals(tr("appointment_complete_cancelled"), state.actionError?.message)
            assertEquals("", state.busy)
            store.close()
        }

    @Test
    fun cancellingAndReopeningSetTheStatus() =
        runTest {
            server.household()
            val a = planned("a1", 3, "Visit")
            server.on("GET", "/api/v1/appointments/a1", json(a))
            val store = AppointmentDetailStore(app, "a1")
            store.await { it.detail != null }

            server.on("PATCH", "/api/v1/appointments/a1", json(a.copy(status = "cancelled")))
            store.cancel()
            val cancelled = store.await { it.detail?.status == "cancelled" && it.busy.isEmpty() }
            assertEquals(tr("appointment_cancelled_toast", "title" to "Visit"), cancelled.notice)
            assertTrue(!cancelled.detail!!.planned)
            assertEquals(
                "cancelled",
                server
                    .requestsTo("PATCH", "/api/v1/appointments/a1")
                    .single()
                    .json
                    .getValue("status")
                    .jsonPrimitive.content,
            )

            server.on("PATCH", "/api/v1/appointments/a1", json(a))
            store.reopen()
            val reopened = store.await { it.detail?.status == "planned" && it.busy.isEmpty() }
            assertEquals(tr("appointment_reopened_toast", "title" to "Visit"), reopened.notice)
            store.close()
        }

    @Test
    fun deletingClosesTheScreen() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/appointments/a1", json(planned("a1", 3)))
            server.on("DELETE", "/api/v1/appointments/a1", "", HttpStatusCode.NoContent)
            val store = AppointmentDetailStore(app, "a1")
            store.await { it.detail != null }
            store.delete()
            val state = store.await { it.deleted }
            assertEquals(1, server.requestsTo("DELETE", "/api/v1/appointments/a1").size)
            assertTrue(state.notice.isNotEmpty())
            store.close()
        }

    @Test
    fun aMissingAppointmentSetsTheError() =
        runTest {
            server.household()
            val store = AppointmentDetailStore(app, "gone")
            val state = store.await { !it.loading }
            assertEquals(tr("m_error_not_found"), state.error?.message)
            assertNull(state.detail)
            store.close()
        }

    // ---- edit ----------------------------------------------------------------------------------

    private fun choicesAnswered() {
        server.on(
            "GET",
            "/api/v1/tasks",
            """{"items":[${taskJson("t2", "Water plants")},${taskJson("t1", "Change filter")}],"nextCursor":null}""",
        )
        server.on("GET", "/api/v1/assets", """{"items":[],"nextCursor":null}""")
        server.on("GET", "/api/v1/contacts", """{"items":[],"nextCursor":null}""")
    }

    @Test
    fun aNewAppointmentStartsTodayForTheGivenTask() =
        runTest {
            server.household()
            choicesAnswered()
            val store = AppointmentEditStore(app, "", "t1", "", "", "2026-12-01")
            val state = store.await { it.initial != null && !it.choicesLoading }
            val form = assertNotNull(state.initial)
            assertEquals(today, form.startDate)
            assertEquals("t1", form.taskId)
            assertEquals("2026-12-01", form.occurrenceKey)
            assertTrue(state.isNew)
            assertEquals(listOf("Change filter", "Water plants"), state.tasks.map { it.label })
            store.close()
        }

    @Test
    fun choosingATaskFillsTitleAndKeepsOrDropsTheOccurrence() =
        runTest {
            server.household()
            choicesAnswered()
            val store = AppointmentEditStore(app, "", "t1", "", "", "2026-12-01")
            val form = assertNotNull(store.await { it.initial != null && !it.choicesLoading }.initial)
            val same = store.taskChosen(form, "t1")
            assertEquals("Change filter", same.title)
            assertEquals("2026-12-01", same.occurrenceKey)
            val other = store.taskChosen(form.copy(title = "Own title"), "t2")
            assertEquals("Own title", other.title)
            assertEquals("", other.occurrenceKey)
            assertEquals("", store.taskChosen(form, "").taskId)
            store.close()
        }

    @Test
    fun savingANewAppointmentSendsInstantsOfTheHouseholdZone() =
        runTest {
            server.household()
            choicesAnswered()
            server.on("POST", "/api/v1/appointments", json(planned("n1", 0)), HttpStatusCode.Created)
            val store = AppointmentEditStore(app, "", "", "", "", "")
            val form = assertNotNull(store.await { it.initial != null }.initial)
            store.save(form.copy(title = " Boiler ", startDate = "2026-06-15", startTime = "09:00"))
            val state = store.await { it.savedId != null }
            assertEquals("n1", state.savedId)
            val body = server.requestsTo("POST", "/api/v1/appointments").single().json
            assertEquals("Boiler", body.getValue("title").jsonPrimitive.content)
            assertEquals("2026-06-15T07:00:00.000Z", body.getValue("startsAt").jsonPrimitive.content)
            assertNull(body["endsAt"])
            store.close()
        }

    @Test
    fun anAppointmentForATaskWithoutADeviceSaysSo() =
        runTest {
            server.household()
            choicesAnswered()
            server.on("POST", "/api/v1/appointments", json(planned("n1", 0)), HttpStatusCode.Created)
            val store = AppointmentEditStore(app, "", "t1", "", "", "")
            val form = assertNotNull(store.await { it.initial != null }.initial)
            store.save(form.copy(title = "Filter", assetId = "", startTime = "09:00"))
            store.await { it.savedId != null }
            val body = server.requestsTo("POST", "/api/v1/appointments").single().json
            assertEquals("t1", body.getValue("taskId").jsonPrimitive.content)
            assertTrue("assetId" in body)
            assertEquals(JsonNull, body["assetId"])
            store.close()
        }

    @Test
    fun anAppointmentWithoutATaskSendsNoDeviceAtAll() =
        runTest {
            server.household()
            choicesAnswered()
            server.on("POST", "/api/v1/appointments", json(planned("n1", 0)), HttpStatusCode.Created)
            val store = AppointmentEditStore(app, "", "", "", "", "")
            val form = assertNotNull(store.await { it.initial != null }.initial)
            store.save(form.copy(title = "Boiler", startTime = "09:00"))
            store.await { it.savedId != null }
            assertNull(server.requestsTo("POST", "/api/v1/appointments").single().json["assetId"])
            store.close()
        }

    @Test
    fun aFormWithErrorsAsksNoServer() =
        runTest {
            server.household()
            choicesAnswered()
            val store = AppointmentEditStore(app, "", "", "", "", "")
            val form = assertNotNull(store.await { it.initial != null }.initial)
            store.save(form.copy(title = "", startTime = ""))
            val state = store.await { it.fieldErrors.isNotEmpty() }
            assertEquals(setOf("title", "startTime"), state.fieldErrors.keys)
            assertTrue(server.requestsTo("POST", "/api/v1/appointments").isEmpty())
            store.close()
        }

    @Test
    fun serverFieldErrorsLandOnTheFormFields() =
        runTest {
            server.household()
            choicesAnswered()
            server.onError(
                "POST",
                "/api/v1/appointments",
                HttpStatusCode.BadRequest,
                "invalid_request",
                details = """{"body":{"formErrors":[],"fieldErrors":{"taskId":["Not found"],"startsAt":["Required"]}}}""",
            )
            val store = AppointmentEditStore(app, "", "", "", "", "")
            val form = assertNotNull(store.await { it.initial != null }.initial)
            store.save(form.copy(title = "x", startTime = "09:00", taskId = "nope"))
            val state = store.await { !it.saving && it.fieldErrors.isNotEmpty() }
            assertEquals(mapOf("taskId" to "Not found", "startTime" to "Required"), state.fieldErrors)
            assertNull(state.error)
            store.close()
        }

    @Test
    fun editingSendsOnlyTheChangesAndNothingWhenUnchanged() =
        runTest {
            server.household()
            choicesAnswered()
            val stored = planned("a1", 3, "Visit")
            server.on("GET", "/api/v1/appointments/a1", json(stored))
            server.on("PATCH", "/api/v1/appointments/a1", json(stored.copy(title = "Renamed")))
            val store = AppointmentEditStore(app, "a1", "", "", "", "")
            val form = assertNotNull(store.await { it.initial != null }.initial)
            assertTrue(!store.value.isNew)

            store.save(form)
            assertEquals("a1", store.await { it.savedId != null }.savedId)
            assertTrue(server.requestsTo("PATCH", "/api/v1/appointments/a1").isEmpty())

            store.save(form.copy(title = "Renamed", location = ""))
            store.await { !it.saving && server.requestsTo("PATCH", "/api/v1/appointments/a1").isNotEmpty() }
            val body = server.requestsTo("PATCH", "/api/v1/appointments/a1").single().json
            assertEquals("Renamed", body.getValue("title").jsonPrimitive.content)
            assertEquals(setOf("title"), body.keys)
            store.close()
        }

    @Test
    fun theEditorShowsALoadError() =
        runTest {
            server.household()
            choicesAnswered()
            val store = AppointmentEditStore(app, "gone", "", "", "", "")
            val state = store.await { !it.loading }
            assertEquals(tr("m_error_not_found"), state.loadError?.message)
            assertNull(state.initial)
            store.close()
        }

    @Test
    fun thePreviewUsesTheHouseholdZone() =
        runTest {
            server.household()
            choicesAnswered()
            val store = AppointmentEditStore(app, "", "", "", "", "")
            val form = assertNotNull(store.await { it.initial != null }.initial)
            val preview = store.preview(form.copy(startDate = "2026-06-15", startTime = "09:00"))
            assertTrue(preview.text.endsWith("· 09:00–10:00"))
            assertTrue(preview.hint.isEmpty())
            store.close()
        }
}
