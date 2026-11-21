package ch.orellbuehler.hauswart.feature.defects

import ch.orellbuehler.hauswart.feature.inventory.assetJson
import ch.orellbuehler.hauswart.feature.inventory.roomJson
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DefectsStoresTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun String?.json() = if (this == null) "null" else "\"$this\""

    private fun defectFields(
        id: String,
        number: Int,
        title: String,
        status: String = "open",
        severity: String = "medium",
        deadline: String? = null,
        source: String = "manual",
        room: String? = null,
        asset: String? = null,
        reportedOn: String? = null,
        resolution: String = "",
    ) = """"id":"$id","number":$number,"title":"$title","descriptionMd":"Kratzer","status":"$status","severity":"$severity",
        "roomId":${room?.let { "r1" }.json()},"roomName":${room.json()},"assetId":${asset?.let { "a1" }.json()},"assetName":${asset.json()},
        "locationDetail":null,"discoveredOn":"2026-11-01","reportedOn":${reportedOn.json()},"responsibleContactId":null,
        "responsibleContactName":null,"deadlineDate":${deadline.json()},"deadlineSource":"$source","fixedOn":null,
        "resolutionMd":"$resolution","costEntryId":null,"costs":{"totalMinor":0,"count":0},"reminderTaskId":null,"commentCount":2,
        "createdBy":null,"createdAt":"2026-11-01T08:00:00.000Z","updatedAt":"2026-11-01T08:00:00.000Z""""

    private fun defect(
        id: String,
        number: Int,
        title: String,
        status: String = "open",
        severity: String = "medium",
        deadline: String? = null,
        room: String? = null,
        asset: String? = null,
    ) = "{" + defectFields(id, number, title, status, severity, deadline, room = room, asset = asset) + "}"

    private fun detail(
        id: String = "d1",
        status: String = "open",
        resolution: String = "",
        reportedOn: String? = null,
        deadline: String? = "2026-12-01",
        source: String = "manual",
    ) = "{" +
        defectFields(
            id,
            7,
            "Kratzer im Parkett",
            status,
            deadline = deadline,
            source = source,
            reportedOn = reportedOn,
            resolution = resolution,
        ) +
        ""","events":[{"id":"e2","defectId":"$id","at":"2026-11-02T09:00:00.000Z","userId":null,"userName":null,"type":"status",
        "fromStatus":"open","toStatus":"reported","bodyMd":"Brief https://example.org/x","externalRef":null},
        {"id":"e1","defectId":"$id","at":"2026-11-01T08:00:00.000Z","userId":"u1","userName":"Anna","type":"created",
        "fromStatus":null,"toStatus":null,"bodyMd":"","externalRef":null}]}"""

    private fun page(vararg items: String) = """{"items":[${items.joinToString(",")}],"nextCursor":null}"""

    private fun listing() {
        server.household()
        server.on(
            "GET",
            "/api/v1/defects",
            page(
                defect("d1", 1, "Kratzer im Parkett", deadline = "2026-12-01", room = "Wohnzimmer"),
                defect("d2", 2, "Tropfender Hahn", status = "fixed", severity = "high", asset = "Spüle"),
                defect("d3", 3, "Riss in der Wand", status = "reported", deadline = "2026-10-01"),
            ),
        )
    }

    @Test
    fun theListShowsOnlyActiveDefectsAtFirst() =
        runTest {
            listing()
            val store = DefectsListStore(app)
            val state = store.await { !it.loading && it.total > 0 }
            assertEquals(listOf("d1", "d3"), state.rows.map { it.id })
            assertEquals(3, state.total)
            assertEquals(0, state.filterCount)
            assertTrue(state.isDefault)
            assertEquals(tr("defects_count", "count" to 2), state.countText)
            store.close()
        }

    @Test
    fun filtersNarrowTheRowsAndReset() =
        runTest {
            listing()
            val store = DefectsListStore(app)
            store.await { it.total > 0 }
            store.toggleStatus("fixed")
            assertEquals(3, store.await { it.statuses.contains("fixed") }.rows.size)
            store.setSeverity("high")
            assertEquals(listOf("d2"), store.await { it.severity == "high" }.rows.map { it.id })
            store.setSeverity("")
            store.setRoom("r1")
            val room = store.await { it.roomId == "r1" }
            assertEquals(listOf("d1"), room.rows.map { it.id })
            assertEquals(tr("defects_pdf_all_statuses") + ", Wohnzimmer", room.pdfScope)
            store.search("zzz")
            assertEquals("filtered", store.await { it.query == "zzz" }.emptyReason)
            store.reset()
            val reset = store.await { it.query.isEmpty() && it.roomId.isEmpty() }
            assertEquals(listOf("d1", "d3"), reset.rows.map { it.id })
            store.close()
        }

    @Test
    fun numberSortShowsTheNewestFirstAndTheLastStatusCannotBeSwitchedOff() =
        runTest {
            listing()
            val store = DefectsListStore(app)
            store.await { it.total > 0 }
            store.setSort(DEFECT_SORT_NUMBER)
            assertEquals(listOf("d3", "d1"), store.await { it.sort == DEFECT_SORT_NUMBER }.rows.map { it.id })
            store.toggleStatus("open")
            store.toggleStatus("reported")
            store.toggleStatus("in_progress")
            assertEquals(DEFECT_STATUSES, store.await { it.statuses.size == DEFECT_STATUSES.size }.statuses)
            store.close()
        }

    @Test
    fun nothingActiveOffersToShowAll() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/defects", page(defect("d2", 2, "Hahn", status = "fixed")))
            val store = DefectsListStore(app)
            assertEquals("none_active", store.await { it.total == 1 }.emptyReason)
            store.close()
        }

    @Test
    fun anEmptyListSaysSo() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/defects", page())
            val store = DefectsListStore(app)
            assertEquals("empty", store.await { !it.loading }.emptyReason)
            store.close()
        }

    @Test
    fun aFailedLoadSetsTheError() =
        runTest {
            server.household()
            server.onError("GET", "/api/v1/defects", HttpStatusCode.InternalServerError, "internal_error")
            val store = DefectsListStore(app)
            assertEquals(tr("m_error_server"), store.await { !it.loading }.error?.message)
            store.close()
        }

    @Test
    fun exportingAsksForOneStatusAndTheRoom() =
        runTest {
            listing()
            server.on("GET", "/api/v1/defects/export.pdf", "%PDF")
            val store = DefectsListStore(app)
            store.await { it.total > 0 }
            store.toggleStatus("in_progress")
            store.toggleStatus("reported")
            store.setRoom("r1")
            store.await { it.roomId == "r1" }
            store.exportPdf()
            val state = store.await { it.exported != null }
            assertEquals("defects.pdf", state.exported?.file?.name)
            assertEquals("status=open&roomId=r1", server.requestsTo("GET", "/api/v1/defects/export.pdf").single().query)
            store.close()
        }

    @Test
    fun detailBuildsTheView() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/defects/d1", detail(reportedOn = "2026-11-02"))
            val store = DefectDetailStore(app, "d1")
            val view = assertNotNull(store.await { it.view != null }.view)
            assertEquals(listOf("created", "status"), view.timeline.map { it.type })
            assertTrue(
                view.timeline
                    .first()
                    .title
                    .startsWith("Anna"),
            )
            assertEquals(
                "https://example.org/x",
                view.timeline
                    .last()
                    .body
                    .last()
                    .href,
            )
            assertEquals(listOf("current", "todo", "todo", "todo"), view.steps.map { it.state })
            assertEquals(listOf("reported", "in_progress", "fixed", "rejected"), view.actions.map { it.status })
            assertEquals(listOf("reported", "fixed"), view.actions.filter { it.primary }.map { it.status })
            store.close()
        }

    @Test
    fun aReportedDefectOffersTheNextStepsAndAClosedOneOnlyReopens() {
        assertEquals(listOf("in_progress", "fixed"), defectActions("reported").filter { it.primary }.map { it.status })
        assertEquals(listOf("open"), defectActions("fixed").map { it.status })
        assertEquals(tr("defect_action_reopen"), defectActions("rejected").single().label)
        assertEquals(tr("defect_action_back_to_open"), defectActions("reported").first().label)
    }

    @Test
    fun deadlinesAreOverdueSoonOrFarAndNeverForClosedDefects() {
        val today = "2026-11-21"
        assertTrue(defectDeadline("2026-11-01", "open", today).overdue)
        assertEquals("due", defectDeadline("2026-12-10", "reported", today).tone)
        assertEquals("muted", defectDeadline("2027-06-01", "open", today).tone)
        assertEquals("muted", defectDeadline("2026-11-01", "fixed", today).tone)
        assertEquals(tr("defect_deadline_none"), defectDeadline(null, "open", today).text)
    }

    @Test
    fun deletingClosesTheScreen() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/defects/d1", detail())
            server.on("DELETE", "/api/v1/defects/d1", "", HttpStatusCode.NoContent)
            val store = DefectDetailStore(app, "d1")
            store.await { it.view != null }
            store.delete()
            assertTrue(store.await { it.deleted }.deleted)
            store.close()
        }

    @Test
    fun fixingSavesTheResolutionFirstAndSendsTheDate() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/defects/d1", detail())
            server.on("PATCH", "/api/v1/defects/d1", defect("d1", 7, "x"))
            server.on("POST", "/api/v1/defects/d1/status", detail(status = "fixed"))
            val store = DefectStatusStore(app, "d1", "fixed")
            val loaded = store.await { it.initial != null }
            assertTrue(loaded.needsDate)
            assertEquals("2026-11-01", loaded.minDate)
            store.save(DefectStatusForm(date = "2026-11-20", text = " Dichtung ersetzt "))
            store.await { it.done }
            assertEquals(
                "Dichtung ersetzt",
                server
                    .requestsTo("PATCH", "/api/v1/defects/d1")
                    .single()
                    .json
                    .getValue("resolutionMd")
                    .jsonPrimitive.content,
            )
            val body = server.requestsTo("POST", "/api/v1/defects/d1/status").single().json
            assertEquals("fixed", body.getValue("status").jsonPrimitive.content)
            assertEquals("2026-11-20", body.getValue("fixedOn").jsonPrimitive.content)
            assertEquals("Dichtung ersetzt", body.getValue("note").jsonPrimitive.content)
            assertNull(body["reportedOn"])
            store.close()
        }

    @Test
    fun aFutureDateIsRefusedWithoutAskingTheServer() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/defects/d1", detail())
            val store = DefectStatusStore(app, "d1", "reported")
            store.await { it.initial != null }
            store.save(DefectStatusForm(date = "2999-01-01", text = ""))
            assertEquals(tr("defect_dialog_future"), store.await { it.fieldErrors.isNotEmpty() }.fieldErrors["date"])
            assertTrue(server.requestsTo("POST", "/api/v1/defects/d1/status").isEmpty())
            store.close()
        }

    @Test
    fun reopeningNeedsNoDateAndRejectingIsDestructive() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/defects/d1", detail(status = "fixed"))
            val reopen = DefectStatusStore(app, "d1", "open")
            val state = reopen.await { it.initial != null }
            assertEquals(tr("defect_dialog_reopen_title"), state.title)
            assertEquals(tr("defect_action_reopen"), state.submitLabel)
            assertEquals(false, state.needsDate)
            reopen.close()
            val reject = DefectStatusStore(app, "d1", "rejected")
            assertTrue(reject.await { it.initial != null }.destructive)
            reject.close()
        }

    @Test
    fun correspondenceNeedsABody() =
        runTest {
            server.on(
                "POST",
                "/api/v1/defects/d1/events",
                """{"id":"e9","defectId":"d1","at":"2026-11-02T09:00:00.000Z","userId":null,"userName":null,"type":"correspondence",
                    "fromStatus":null,"toStatus":null,"bodyMd":"x","externalRef":null}""",
                HttpStatusCode.Created,
            )
            val store = DefectCorrespondenceStore(app, "d1")
            store.save(DefectCorrespondenceForm(body = "  "))
            assertEquals(tr("m_field_required"), store.await { it.fieldErrors.isNotEmpty() }.fieldErrors["bodyMd"])
            assertTrue(server.requests.isEmpty())
            store.save(DefectCorrespondenceForm(body = " Brief gesendet ", reference = "  "))
            store.await { it.done }
            val body = server.requestsTo("POST", "/api/v1/defects/d1/events").single().json
            assertEquals("Brief gesendet", body.getValue("bodyMd").jsonPrimitive.content)
            assertNull(body["externalRef"])
            store.close()
        }

    private fun formData(handover: String? = "2026-01-01") {
        server.on("GET", "/api/v1/rooms", page(roomJson("r1", "Wohnzimmer")))
        server.on("GET", "/api/v1/assets", page())
        server.on("GET", "/api/v1/contacts", page())
        server.on(
            "GET",
            "/api/v1/household",
            """{"name":"H","timezone":"Europe/Zurich","currency":"CHF","handoverDate":${handover.json()},
                "settings":{"dueSoonDays":7,"digestTime":"07:00","defectDeadlineMonths":24},"updatedAt":"2026-01-01T00:00:00.000Z"}""",
        )
        server.on("GET", "/api/v1/users/directory", """{"items":[],"nextCursor":null}""")
    }

    @Test
    fun aNewDefectStartsWithTheAutomaticDeadlineWhenThereIsAHandoverDate() =
        runTest {
            formData()
            val store = DefectEditStore(app, null, null, "r1")
            val state = store.await { it.initial != null }
            val form = assertNotNull(state.initial)
            assertEquals(DEADLINE_MODE_AUTO, form.deadlineMode)
            assertEquals("r1", form.roomId)
            assertEquals(app.household.today(), form.discoveredOn)
            assertEquals(listOf("auto", "manual", "none"), state.deadlineModes.map { it.value })
            assertTrue(state.noContacts)
            assertTrue(store.deadlineHints(form).first().contains("01.01.2028"))
            store.close()
        }

    @Test
    fun withoutAHandoverDateThereIsNoAutomaticDeadline() =
        runTest {
            formData(handover = null)
            val store = DefectEditStore(app, null, null, null)
            val state = store.await { it.initial != null }
            assertEquals(DEADLINE_MODE_NONE, state.initial?.deadlineMode)
            assertEquals(listOf("manual", "none"), state.deadlineModes.map { it.value })
            assertTrue(store.deadlineHints(DefectForm()).contains(tr("defect_deadline_no_handover")))
            store.close()
        }

    @Test
    fun validationAsksNoServer() =
        runTest {
            formData()
            val store = DefectEditStore(app, null, null, null)
            val form = assertNotNull(store.await { it.initial != null }.initial)
            store.save(form.copy(title = " ", deadlineMode = DEADLINE_MODE_MANUAL, deadlineDate = "", discoveredOn = "2999-01-01"))
            val errors = store.await { it.fieldErrors.isNotEmpty() }.fieldErrors
            assertEquals(setOf("title", "discoveredOn", "deadlineDate"), errors.keys)
            assertTrue(server.requestsTo("POST", "/api/v1/defects").isEmpty())
            store.close()
        }

    @Test
    fun creatingWithNoDeadlineSendsAnExplicitNull() =
        runTest {
            formData()
            server.on("POST", "/api/v1/defects", defect("d9", 9, "Neu"), HttpStatusCode.Created)
            val store = DefectEditStore(app, null, null, null)
            val form = assertNotNull(store.await { it.initial != null }.initial)
            store.save(form.copy(title = " Neu ", deadlineMode = DEADLINE_MODE_NONE, locationDetail = " "))
            assertEquals("d9", store.await { it.savedId != null }.savedId)
            val body = server.requestsTo("POST", "/api/v1/defects").single().json
            assertEquals("Neu", body.getValue("title").jsonPrimitive.content)
            assertEquals(JsonNull, body["deadlineDate"])
            assertEquals(JsonNull, body["roomId"])
            assertEquals(JsonNull, body["locationDetail"])
            assertNull(body["deadlineSource"])
            store.close()
        }

    @Test
    fun creatingWithTheAutomaticDeadlineLeavesItOut() =
        runTest {
            formData()
            server.on("POST", "/api/v1/defects", defect("d9", 9, "Neu"), HttpStatusCode.Created)
            val store = DefectEditStore(app, null, null, null)
            val form = assertNotNull(store.await { it.initial != null }.initial)
            store.save(form.copy(title = "Neu"))
            store.await { it.savedId != null }
            val body = server.requestsTo("POST", "/api/v1/defects").single().json
            assertNull(body["deadlineDate"])
            assertNull(body["deadlineSource"])
            store.close()
        }

    @Test
    fun editingKeepsTheDeadlineSourceOutUnlessAutomatic() =
        runTest {
            formData()
            server.on("GET", "/api/v1/defects/d1", detail(source = "handover", deadline = "2028-01-01"))
            server.on("PATCH", "/api/v1/defects/d1", defect("d1", 7, "x"))
            val store = DefectEditStore(app, "d1", null, null)
            val form = assertNotNull(store.await { it.initial != null }.initial)
            assertEquals(DEADLINE_MODE_AUTO, form.deadlineMode)
            assertEquals(7L, store.value.number)
            store.save(form)
            store.await { it.savedId != null }
            val auto = server.requestsTo("PATCH", "/api/v1/defects/d1").single().json
            assertEquals("handover", auto.getValue("deadlineSource").jsonPrimitive.content)
            assertNull(auto["deadlineDate"])
            store.close()

            val manual = DefectEditStore(app, "d1", null, null)
            manual.await { it.initial != null }
            manual.save(form.copy(deadlineMode = DEADLINE_MODE_MANUAL, deadlineDate = "2027-03-01"))
            manual.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/defects/d1").last().json
            assertEquals(JsonPrimitive("2027-03-01"), body["deadlineDate"])
            assertNull(body["deadlineSource"])
            manual.close()
        }

    @Test
    fun choosingADeviceFillsAnEmptyRoom() =
        runTest {
            formData()
            server.on(
                "GET",
                "/api/v1/assets",
                page(assetJson("a1", "Boiler", roomId = "r1", roomName = "Keller")),
            )
            val store = DefectEditStore(app, null, null, null)
            val state = store.await { it.initial != null }
            val form = DefectForm()
            assertEquals("r1", store.withAsset(form, "a1").roomId)
            assertEquals("r2", store.withAsset(form.copy(roomId = "r2"), "a1").roomId)
            assertEquals("Boiler (Keller)", state.assets.last().label)
            store.close()
        }
}
