package ch.orellbuehler.hauswart.feature.inventory

import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class InventoryStoresTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @BeforeTest
    fun german() {
        I18n.locale = "de"
        server.household()
    }

    @AfterTest
    fun tearDown() = server.close()

    private fun assetsAndRooms() {
        server.on(
            "GET",
            "/api/v1/assets",
            page(
                assetJson("a1", "Waschmaschine", roomId = "r1", roomName = "Bad", warrantyUntil = "2099-01-01"),
                assetJson("a2", "Alter Toaster", archived = true),
                assetJson("a3", "Ficus", kind = "plant"),
            ),
        )
        server.on("GET", "/api/v1/rooms", page(roomJson("r1", "Bad", 0), roomJson("r2", "Küche", 1)))
    }

    @Test
    fun inventoryLeavesOutPlantsAndHidesArchivedUntilAsked() =
        runTest {
            assetsAndRooms()
            val store = InventoryStore(app)
            val state = store.await { !it.loading && it.rows.isNotEmpty() }
            assertEquals(listOf("Waschmaschine"), state.rows.map { it.name })
            assertEquals(2, state.assetCount)
            assertEquals(1, state.total)
            assertTrue(state.hasArchived)
            assertEquals(tr("inventory_count", "count" to 1), state.countText)
            assertEquals(listOf("", "r1", "r2"), state.roomOptions.map { it.value })
            assertEquals("valid", state.rows.single().warranty?.status)

            store.setShowArchived(true)
            val all = store.await { it.filter.archived }
            assertEquals(listOf("Alter Toaster", "Waschmaschine"), all.rows.map { it.name })
            assertEquals(tr("inventory_result_count", "shown" to 2, "total" to 1), all.countText)
            store.resetFilter()
            assertEquals(1, store.await { !it.filtered }.rows.size)
            store.close()
        }

    @Test
    fun inventoryRequestsArchivedAssetsAndReportsAFailedLoad() =
        runTest {
            server.onError("GET", "/api/v1/assets", HttpStatusCode.InternalServerError, "internal_error")
            server.on("GET", "/api/v1/rooms", page())
            val store = InventoryStore(app)
            val state = store.await { !it.loading }
            assertEquals(tr("m_error_server"), state.error?.message)
            assertTrue(state.rows.isEmpty())
            store.close()
        }

    @Test
    fun wateringCompletesTheTaskAndCanBeUndone() =
        runTest {
            server.on("GET", "/api/v1/assets", page(assetJson("p1", "Ficus", kind = "plant", roomName = "Bad", species = "Ficus benjamina")))
            server.on("GET", "/api/v1/tasks", page(taskJson("t1", "overdue", "2026-10-01", assetId = "p1", category = "plant")))
            server.on("GET", "/api/v1/hints", page(hintJson("h1", "a", assetId = "p1"), hintJson("h2", "b", assetId = "p1"), hintJson("h3", "c", assetId = "p1")))
            server.on(
                "POST",
                "/api/v1/tasks/t1/complete",
                """{"completion":${completion()},"task":${taskJson("t1", "ok", "2026-11-01", assetId = "p1")},"serviceLog":null}""",
                HttpStatusCode.Created,
            )
            server.on("DELETE", "/api/v1/completions/c1", "", HttpStatusCode.NoContent)
            val store = PlantsStore(app)
            val loaded = store.await { !it.loading && it.plants.isNotEmpty() }
            val plant = loaded.plants.single()
            assertEquals("t1", plant.taskId)
            assertEquals(tr("due_overdue"), plant.statusLabel)
            assertEquals(2, plant.hints.size)
            assertEquals(tr("plants_hints_more", "count" to 1), plant.moreHints)

            store.water("p1")
            val done = store.await { it.notice != null }
            assertEquals(tr("plants_watered_toast", "name" to "Ficus"), done.notice?.message)
            assertTrue(done.notice?.undo == true)
            assertEquals("manual", server.requestsTo("POST", "/api/v1/tasks/t1/complete").single().json.getValue("source").jsonPrimitive.content)

            store.undo()
            store.await { it.notice?.message == tr("toast_undone") }
            assertEquals(1, server.requestsTo("DELETE", "/api/v1/completions/c1").size)
            store.close()
        }

    private fun completion() =
        """{"id":"c1","taskId":"t1","taskTitle":"Task","kind":"done","source":"manual","completedAt":"2026-10-06T08:00:00.000Z",
            "completedDate":"2026-10-06","userId":"u1","userName":"Anna","counterValue":null,"occurrenceKey":"k","dueDateAtCompletion":null,"note":null,"revokedAt":null,
            "createdAt":"2026-10-06T08:00:00.000Z"}"""

    @Test
    fun plantsWithoutAPlanOfferNoWatering() =
        runTest {
            server.on("GET", "/api/v1/assets", page(assetJson("p1", "Ficus", kind = "plant")))
            server.on("GET", "/api/v1/tasks", page())
            server.on("GET", "/api/v1/hints", page())
            val store = PlantsStore(app)
            val plant = store.await { it.plants.isNotEmpty() }.plants.single()
            assertNull(plant.taskId)
            assertEquals(tr("plants_no_room"), plant.place)
            store.water("p1")
            assertTrue(server.requestsTo("POST", "/api/v1/tasks/t1/complete").isEmpty())
            store.close()
        }

    @Test
    fun roomsShowCountsAndMoveByRenumbering() =
        runTest {
            assetsAndRooms()
            server.on("GET", "/api/v1/tasks", page(taskJson("t1", "overdue", assetId = "a1"), taskJson("t2", "due", roomId = "r1")))
            server.on("PATCH", "/api/v1/rooms/r1", roomJson("r1", "Bad", 1))
            server.on("PATCH", "/api/v1/rooms/r2", roomJson("r2", "Küche", 0))
            val store = RoomsStore(app)
            val state = store.await { !it.loading && it.rooms.isNotEmpty() }
            val bad = state.rooms.first()
            assertEquals(tr("rooms_count_assets", "count" to 1), bad.assetsText)
            assertEquals(tr("rooms_count_tasks", "count" to 2), bad.tasksText)
            assertTrue(bad.hasOverdue && !bad.canMoveUp && bad.canMoveDown)

            store.move("r2", -1)
            store.await { !it.busy && server.requestsTo("PATCH", "/api/v1/rooms/r2").isNotEmpty() }
            assertEquals(0L, server.requestsTo("PATCH", "/api/v1/rooms/r2").single().json.getValue("sortOrder").jsonPrimitive.content.toLong())
            assertEquals(1L, server.requestsTo("PATCH", "/api/v1/rooms/r1").single().json.getValue("sortOrder").jsonPrimitive.content.toLong())
            store.close()
        }

    @Test
    fun deletingARoomReportsIt() =
        runTest {
            assetsAndRooms()
            server.on("GET", "/api/v1/tasks", page())
            server.on("DELETE", "/api/v1/rooms/r2", "", HttpStatusCode.NoContent)
            val store = RoomsStore(app)
            store.await { it.rooms.size == 2 }
            store.delete("r2")
            val state = store.await { it.notice != null }
            assertEquals(tr("rooms_deleted_toast", "name" to "Küche"), state.notice?.message)
            store.close()
        }

    @Test
    fun roomDetailListsItsAssetsAndTheTasksOfThem() =
        runTest {
            server.on("GET", "/api/v1/rooms/r1", roomJson("r1", "Bad"))
            server.on("GET", "/api/v1/assets", page(assetJson("a1", "Waschmaschine", roomId = "r1", roomName = "Bad")))
            server.on(
                "GET",
                "/api/v1/tasks",
                page(taskJson("t1", "due", "2026-10-09", assetId = "a1"), taskJson("t2", "due", roomId = "r9"), taskJson("t3", "overdue", roomId = "r1")),
            )
            val store = RoomDetailStore(app, "r1")
            val state = store.await { it.room != null }
            assertEquals(listOf("Waschmaschine"), state.assets.map { it.name })
            assertEquals(listOf("t3", "t1"), state.tasks.map { it.id })
            server.on("DELETE", "/api/v1/rooms/r1", "", HttpStatusCode.NoContent)
            store.delete()
            assertTrue(store.await { it.deleted }.deleted)
            store.close()
        }

    @Test
    fun creatingARoomGoesToTheEndAndNameConflictsAreWorded() =
        runTest {
            server.on("GET", "/api/v1/rooms", page(roomJson("r1", "Bad", 0), roomJson("r2", "Küche", 4)))
            server.on("POST", "/api/v1/rooms", roomJson("r3", "Keller", 5), HttpStatusCode.Created)
            val store = RoomEditStore(app, null)
            store.save(RoomForm(name = " Keller ", icon = "warehouse", notes = "  "))
            assertEquals("r3", store.await { it.savedId != null }.savedId)
            val body = server.requestsTo("POST", "/api/v1/rooms").single().json
            assertEquals("Keller", body.getValue("name").jsonPrimitive.content)
            assertEquals("warehouse", body.getValue("icon").jsonPrimitive.content)
            assertEquals(5L, body.getValue("sortOrder").jsonPrimitive.content.toLong())
            assertNull(body["notes"])
            store.close()

            server.onError("POST", "/api/v1/rooms", HttpStatusCode.Conflict, "conflict")
            val second = RoomEditStore(app, null)
            second.save(RoomForm(name = "Bad"))
            assertEquals(tr("rooms_error_name_taken"), second.await { it.error != null }.error?.message)
            second.save(RoomForm(name = " "))
            assertEquals(mapOf("name" to tr("m_field_required")), second.await { it.fieldErrors.isNotEmpty() }.fieldErrors)
            second.close()
        }

    @Test
    fun editingARoomClearsIconAndNotesWithNull() =
        runTest {
            server.on("GET", "/api/v1/rooms/r1", roomJson("r1", "Bad", icon = "bath"))
            server.on("PATCH", "/api/v1/rooms/r1", roomJson("r1", "Bad"))
            val store = RoomEditStore(app, "r1")
            val form = assertNotNull(store.await { it.initial != null && !it.loading }.initial)
            assertEquals("bath", form.icon)
            store.save(form.copy(icon = ""))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/rooms/r1").single().json
            assertEquals(JsonNull, body["icon"])
            assertEquals(JsonNull, body["notes"])
            store.close()
        }

    @Test
    fun warrantiesAreSortedAndFilteredByStatus() =
        runTest {
            fun w(
                id: String,
                status: String,
                until: String,
                days: Int,
            ) = """{"assetId":"$id","assetName":"$id","roomName":null,"manufacturer":null,"model":null,"purchaseDate":null,
                "warrantyUntil":"$until","warrantyExtendedUntil":null,"effectiveUntil":"$until","status":"$status","daysLeft":$days}"""
            server.on(
                "GET",
                "/api/v1/warranties",
                page(w("old", "expired", "2020-01-01", -100), w("later", "valid", "2099-01-01", 900), w("soon", "expiring", "2026-12-01", 30), w("older", "expired", "2019-01-01", -200)),
            )
            val store = WarrantiesStore(app)
            val state = store.await { it.rows.isNotEmpty() }
            assertEquals(listOf("soon", "later", "old", "older"), state.rows.map { it.name })
            assertEquals(listOf(4, 1, 1, 2), state.chips.map { it.count })
            store.select("expired")
            assertEquals(listOf("old", "older"), store.await { it.status == "expired" }.rows.map { it.name })
            store.close()
        }

    @Test
    fun detailShowsFactsAndArchivesWithPatch() =
        runTest {
            server.on("GET", "/api/v1/assets/a1", assetJson("a1", "Waschmaschine", roomId = "r1", roomName = "Bad", manufacturer = "Musterwerk", warrantyUntil = "2099-01-01"))
            server.on("GET", "/api/v1/tasks", page(taskJson("t1", "due", "2026-10-09", assetId = "a1")))
            server.on("PATCH", "/api/v1/assets/a1", assetJson("a1", "Waschmaschine", archived = true))
            server.on("DELETE", "/api/v1/assets/a1", "", HttpStatusCode.NoContent)
            val store = AssetDetailStore(app, "a1")
            val state = store.await { it.asset != null }
            assertEquals(listOf(tr("asset_manufacturer") to "Musterwerk"), state.asset?.facts?.map { it.label to it.value })
            assertEquals(1, state.tasks.size)

            store.toggleArchive()
            store.await { it.notice != null }
            assertTrue(server.requestsTo("PATCH", "/api/v1/assets/a1").single().json.getValue("archived").jsonPrimitive.boolean)

            store.delete()
            assertTrue(store.await { it.deleted }.deleted)
            store.close()
        }

    @Test
    fun aNewPlantAlsoGetsItsWateringPlan() =
        runTest {
            server.on("GET", "/api/v1/rooms", page(roomJson("r1", "Bad")))
            server.on("POST", "/api/v1/assets", assetJson("p1", "Ficus", kind = "plant"), HttpStatusCode.Created)
            server.on("POST", "/api/v1/tasks", taskJson("t1", "ok"), HttpStatusCode.Created)
            val store = AssetEditStore(app, null, kind = "plant", roomId = "r1")
            val initial = assertNotNull(store.await { it.initial != null }.initial)
            assertEquals("plant", initial.kind)
            assertEquals("r1", initial.roomId)

            store.save(initial.copy(name = "Ficus", seasonal = true, everyDays = "10", summerEveryDays = "4"))
            assertEquals("p1", store.await { it.savedId != null }.savedId)
            val asset = server.requestsTo("POST", "/api/v1/assets").single().json
            assertEquals("plant", asset.getValue("kind").jsonPrimitive.content)
            assertNull(asset["category"])
            val trigger = server.requestsTo("POST", "/api/v1/tasks").single().json.getValue("trigger").jsonObject
            assertEquals("interval", trigger.getValue("type").jsonPrimitive.content)
            assertEquals(10L, trigger.getValue("every").jsonPrimitive.content.toLong())
            assertEquals(4L, trigger.getValue("seasons").jsonArray.single().jsonObject.getValue("every").jsonPrimitive.content.toLong())
            store.close()
        }

    @Test
    fun aFailedPlanKeepsTheFormAndARetryUpdatesTheCreatedPlant() =
        runTest {
            server.on("GET", "/api/v1/rooms", page())
            server.on("POST", "/api/v1/assets", assetJson("p1", "Ficus", kind = "plant"), HttpStatusCode.Created)
            server.on("PATCH", "/api/v1/assets/p1", assetJson("p1", "Ficus", kind = "plant"))
            server.on("GET", "/api/v1/assets/p1", assetJson("p1", "Ficus", kind = "plant"))
            server.onError("POST", "/api/v1/tasks", HttpStatusCode.InternalServerError, "internal_error")
            val store = AssetEditStore(app, null, kind = "plant")
            val initial = assertNotNull(store.await { it.initial != null }.initial)
            store.save(initial.copy(name = "Ficus"))
            val failed = store.await { !it.saving && it.error != null }
            assertEquals("plan_failed", failed.error?.code)
            assertNull(failed.savedId)

            store.save(initial.copy(name = "Ficus", makePlan = false))
            assertEquals("p1", store.await { it.savedId != null }.savedId)
            assertEquals(1, server.requestsTo("POST", "/api/v1/assets").size)
            assertEquals(1, server.requestsTo("PATCH", "/api/v1/assets/p1").size)
            store.close()
        }

    @Test
    fun theAssetFormValidatesBeforeAskingTheServer() =
        runTest {
            server.on("GET", "/api/v1/rooms", page())
            val store = AssetEditStore(app, null, kind = "plant")
            val initial = assertNotNull(store.await { it.initial != null }.initial)
            store.save(initial.copy(name = " ", everyDays = "0", purchaseDate = "31.02.2026"))
            val errors = store.await { it.fieldErrors.isNotEmpty() }.fieldErrors
            assertEquals(setOf("name", "everyDays", "purchaseDate"), errors.keys)
            assertTrue(server.requestsTo("POST", "/api/v1/assets").isEmpty())
            store.close()
        }

    @Test
    fun editingSendsNullToClearAndKeepsTheRest() =
        runTest {
            server.on("GET", "/api/v1/rooms", page(roomJson("r1", "Bad")))
            server.on("GET", "/api/v1/assets/a1", assetJson("a1", "Oven", roomId = "r1", roomName = "Bad", manufacturer = "Musterwerk"))
            server.on("PATCH", "/api/v1/assets/a1", assetJson("a1", "Oven"))
            val store = AssetEditStore(app, "a1")
            val form = assertNotNull(store.await { it.initial != null }.initial)
            assertEquals("Musterwerk", form.manufacturer)
            store.save(form.copy(manufacturer = "", roomId = ""))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/assets/a1").single().json
            assertEquals(JsonNull, body["manufacturer"])
            assertEquals(JsonNull, body["roomId"])
            assertEquals(JsonPrimitive("Oven"), body["name"])
            assertNull(body["archived"])
            store.close()
        }

    @Test
    fun hintsCreateTogglePinAndMoveWithinTheirGroup() =
        runTest {
            server.on("GET", "/api/v1/assets/a1/hints", page(hintJson("h1", "One", pinned = true, sortOrder = 0), hintJson("h2", "Two", sortOrder = 0), hintJson("h3", "Three", sortOrder = 0)))
            server.on("POST", "/api/v1/assets/a1/hints", hintJson("h4", "New"), HttpStatusCode.Created)
            server.on("PATCH", "/api/v1/hints/h1", hintJson("h1", "One"))
            server.on("PATCH", "/api/v1/hints/h2", hintJson("h2", "Two"))
            server.on("PATCH", "/api/v1/hints/h3", hintJson("h3", "Three"))
            val store = AssetHintsStore(app, "a1")
            val items = store.await { it.items.isNotEmpty() }.items
            assertTrue(!items[1].canMoveUp && items[1].canMoveDown)

            store.save(null, HintForm(title = " "))
            assertEquals(setOf("title"), store.await { it.fieldErrors.isNotEmpty() }.fieldErrors.keys)
            store.save(null, HintForm(kind = "warning", title = "New", pinned = true))
            store.await { it.saved }
            val created = server.requestsTo("POST", "/api/v1/assets/a1/hints").single().json
            assertEquals("warning", created.getValue("kind").jsonPrimitive.content)
            assertTrue(created.getValue("pinned").jsonPrimitive.boolean)
            store.ackSaved()

            store.togglePin("h2")
            store.await { server.requestsTo("PATCH", "/api/v1/hints/h2").isNotEmpty() && !it.busy }
            assertTrue(server.requestsTo("PATCH", "/api/v1/hints/h2").single().json.getValue("pinned").jsonPrimitive.boolean)

            store.move("h2", 1)
            store.await { server.requestsTo("PATCH", "/api/v1/hints/h3").isNotEmpty() && !it.busy }
            assertEquals(10L, server.requestsTo("PATCH", "/api/v1/hints/h3").single().json.getValue("sortOrder").jsonPrimitive.content.toLong())
            store.move("h1", 1)
            assertTrue(server.requestsTo("PATCH", "/api/v1/hints/h1").isEmpty())
            store.close()
        }

    @Test
    fun notesAreAddedResolvedUndoneAndTurnedIntoDefects() =
        runTest {
            server.on("GET", "/api/v1/assets/a1/notes", page(noteJson("n1", "Brakes squeak\\nrear left")))
            server.on("POST", "/api/v1/assets/a1/notes", noteJson("n2", "x"), HttpStatusCode.Created)
            server.on("PATCH", "/api/v1/asset-notes/n1", noteJson("n1", "x", "resolved"))
            val store = AssetNotesStore(app, "a1")
            val state = store.await { it.open.isNotEmpty() }
            assertEquals("Brakes squeak", state.open.single().excerpt)
            assertEquals(tr("asset_notes_list_title", "asset" to "Oven") + "\n- Brakes squeak\n  rear left", state.shareText)

            store.save(null, "   ")
            assertNotNull(store.await { it.formError != null }.formError)
            store.save(null, " New note ")
            store.await { it.saved }
            assertEquals("New note", server.requestsTo("POST", "/api/v1/assets/a1/notes").single().json.getValue("body").jsonPrimitive.content)

            store.resolve("n1")
            assertTrue(store.await { it.notice?.undo == true }.notice?.undo == true)
            store.undo()
            store.await { it.notice?.message == tr("asset_notes_reopened_toast") }
            val statuses = server.requests.filter { it.method == "PATCH" }.map { it.json.getValue("status").jsonPrimitive.content }
            assertEquals(listOf("resolved", "open"), statuses)

            server.on("POST", "/api/v1/asset-notes/n1/to-defect", """{"note":${noteJson("n1", "x", "resolved")},"defect":${defectJson()}}""", HttpStatusCode.Created)
            store.toDefect("n1")
            assertEquals("d1", store.await { it.notice?.defectId != null }.notice?.defectId)
            store.close()
        }

    private fun defectJson() =
        """{"id":"d1","number":1,"title":"x","descriptionMd":"","status":"open","severity":"medium","roomId":null,"roomName":null,"assetId":"a1",
            "assetName":"Oven","locationDetail":null,"discoveredOn":"2026-01-01","reportedOn":null,"responsibleContactId":null,
            "responsibleContactName":null,"deadlineDate":null,"deadlineSource":"manual","fixedOn":null,"resolutionMd":"","costEntryId":null,
            "costs":{"totalMinor":0,"count":0},"reminderTaskId":null,"commentCount":0,"createdBy":null,
            "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

    @Test
    fun resolvedNotesLoadOnDemand() =
        runTest {
            server.on("GET", "/api/v1/assets/a1/notes", page(noteJson("n1", "open one")))
            val store = AssetNotesStore(app, "a1")
            store.await { it.open.isNotEmpty() }
            assertTrue(server.requests.none { it.query?.contains("resolved") == true })
            store.toggleResolved()
            store.await { it.resolvedShown && !it.resolvedLoading && server.requests.any { r -> r.query?.contains("status=resolved") == true } }
            store.close()
        }

    @Test
    fun serviceEntriesParseTheCostAndTickOffNotes() =
        runTest {
            server.on("GET", "/api/v1/assets/a1/service-log", page(serviceJson("s1", "Descaled", costMinor = 4550)))
            server.on("GET", "/api/v1/contacts", page(contactJson("c1", "Muster AG")))
            server.on("GET", "/api/v1/assets/a1/notes", page(noteJson("n1", "Door squeaks")))
            server.on("POST", "/api/v1/assets/a1/service-log", serviceJson("s2", "New"), HttpStatusCode.Created)
            server.on("PATCH", "/api/v1/assets/a1/service-log/s1", serviceJson("s1", "Descaled"))
            val store = AssetServiceLogStore(app, "a1")
            val state = store.await { it.items.isNotEmpty() && it.openNotes.isNotEmpty() }
            assertEquals("CHF 45.50", state.items.single().costText)
            assertEquals("45.50", state.items.single().form.cost)
            assertEquals(listOf("", "c1"), state.contactOptions.map { it.value })
            assertEquals(listOf("n1"), state.openNotes.map { it.id })

            store.save(null, state.blank.copy(title = "New", cost = "abc"))
            assertEquals(setOf("costMinor"), store.await { it.fieldErrors.isNotEmpty() }.fieldErrors.keys)
            store.save(null, state.blank.copy(title = "New", cost = "12.5", contactId = "c1", resolvedNoteIds = listOf("n1")))
            store.await { it.saved }
            val body = server.requestsTo("POST", "/api/v1/assets/a1/service-log").single().json
            assertEquals(1250L, body.getValue("costMinor").jsonPrimitive.content.toLong())
            assertEquals("CHF", body.getValue("currency").jsonPrimitive.content)
            assertEquals("n1", body.getValue("resolvedNoteIds").jsonArray.single().jsonPrimitive.content)
            store.ackSaved()

            store.save("s1", state.items.single().form.copy(cost = ""))
            store.await { it.saved }
            val patch = server.requestsTo("PATCH", "/api/v1/assets/a1/service-log/s1").single().json
            assertEquals(JsonNull, patch["costMinor"])
            assertEquals(JsonNull, patch["currency"])
            assertEquals(JsonNull, patch["contactId"])
            store.close()
        }

    @Test
    fun contactsLinkWithARoleAndConflictsAreWorded() =
        runTest {
            server.on("GET", "/api/v1/assets/a1/contacts", page())
            server.on("GET", "/api/v1/contacts", page(contactJson("c1", "Muster AG")))
            val link = """{"id":"l1","assetId":"a1","contactId":"c1","role":"service","contact":${contactJson("c1", "Muster AG")}}"""
            server.on("POST", "/api/v1/assets/a1/contacts", link, HttpStatusCode.Created)
            val store = AssetContactsStore(app, "a1")
            store.await { it.contactOptions.isNotEmpty() }
            store.link("", "service")
            assertEquals(tr("contact_link_choose"), store.await { it.formError != null }.formError?.message)
            store.link("c1", "installer")
            store.await { it.saved }
            assertEquals("installer", server.requestsTo("POST", "/api/v1/assets/a1/contacts").single().json.getValue("role").jsonPrimitive.content)
            store.ackSaved()

            server.onError("POST", "/api/v1/assets/a1/contacts", HttpStatusCode.Conflict, "conflict")
            store.link("c1", "installer")
            assertEquals(tr("contact_link_taken"), store.await { it.formError?.message == tr("contact_link_taken") }.formError?.message)
            store.close()
        }

    @Test
    fun unlinkingAContactOffersUndoThatLinksItAgain() =
        runTest {
            val link = """{"id":"l1","assetId":"a1","contactId":"c1","role":"seller","contact":${contactJson("c1", "Muster AG")}}"""
            server.on("GET", "/api/v1/assets/a1/contacts", page(link))
            server.on("GET", "/api/v1/contacts", page(contactJson("c1", "Muster AG")))
            server.on("DELETE", "/api/v1/assets/a1/contacts/l1", "", HttpStatusCode.NoContent)
            server.on("POST", "/api/v1/assets/a1/contacts", link, HttpStatusCode.Created)
            val store = AssetContactsStore(app, "a1")
            assertEquals(tr("contact_role_seller"), store.await { it.items.isNotEmpty() }.items.single().roleLabel)
            store.unlink("l1")
            assertTrue(store.await { it.notice?.undo == true }.notice?.undo == true)
            store.undo()
            store.await { it.notice?.message == tr("toast_undone") }
            val body = server.requestsTo("POST", "/api/v1/assets/a1/contacts").single().json
            assertEquals("seller", body.getValue("role").jsonPrimitive.content)
            store.close()
        }

    @Test
    fun partsOfferOnlyUnlinkedOnesAndUnlinkCanBeUndone() =
        runTest {
            server.on("GET", "/api/v1/assets/a1/parts", page("""{"assetId":"a1","partId":"p1","part":${partJson("p1", "Filter", stock = 0)}}"""))
            server.on("GET", "/api/v1/parts", page(partJson("p1", "Filter", stock = 0), partJson("p2", "Seal")))
            server.on("DELETE", "/api/v1/assets/a1/parts/p1", "", HttpStatusCode.NoContent)
            server.on("POST", "/api/v1/assets/a1/parts", """{"assetId":"a1","partId":"p2","part":${partJson("p2", "Seal")}}""", HttpStatusCode.Created)
            val store = AssetPartsStore(app, "a1")
            val state = store.await { it.items.isNotEmpty() && it.partOptions.isNotEmpty() }
            assertEquals(tr("part_stock_empty"), state.items.single().stockText)
            assertEquals(listOf("p2"), state.partOptions.map { it.value })
            assertEquals("CHF 12.50", state.items.single().priceText)

            store.link("p2")
            store.await { it.saved }
            assertEquals("p2", server.requestsTo("POST", "/api/v1/assets/a1/parts").single().json.getValue("partId").jsonPrimitive.content)
            store.unlink("p1")
            assertTrue(store.await { it.notice?.undo == true }.notice?.undo == true)
            store.close()
        }
}
