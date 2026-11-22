package ch.orellbuehler.hauswart.feature.parts

import ch.orellbuehler.hauswart.feature.inventory.assetJson
import ch.orellbuehler.hauswart.feature.inventory.taskJson
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

class PartsStoresTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun String?.json() = if (this == null) "null" else "\"$this\""

    private fun part(
        id: String,
        name: String,
        stock: Int = 5,
        min: Int = 2,
        ordered: Boolean = false,
        archived: Boolean = false,
        partNumber: String? = null,
        price: Int? = null,
        notes: String? = null,
    ) = """"id":"$id","name":"$name","partNumber":${partNumber.json()},"supplier":"Muster AG","shopUrl":"https://shop.example.org/x",
        "unitPriceMinor":${price ?: "null"},"currency":"CHF","stockCount":$stock,"minStock":$min,"reorderQty":4,"leadTimeDays":14,
        "orderedAt":${if (ordered) "\"2026-11-10T10:00:00.000Z\"" else "null"},"orderedQty":${if (ordered) 3 else 0},
        "lowStock":${stock <= min},"notes":${notes.json()},"archivedAt":${if (archived) "\"2026-11-11T10:00:00.000Z\"" else "null"},
        "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z""""

    private fun partJson(
        id: String,
        name: String,
        stock: Int = 5,
        min: Int = 2,
        ordered: Boolean = false,
        archived: Boolean = false,
        partNumber: String? = null,
        price: Int? = null,
        notes: String? = null,
    ) = "{" + part(id, name, stock, min, ordered, archived, partNumber, price, notes) + "}"

    private fun detail(
        id: String = "p1",
        stock: Int = 5,
        ordered: Boolean = false,
    ) = "{" + part(id, "Filter", stock, 2, ordered, price = 1250) +
        ""","assets":[{"id":"a1","name":"Boiler"}],"tasks":[{"id":"t1","title":"Filter wechseln","qty":2}],"recentMovements":[]}"""

    private fun movements(next: String? = null) =
        """{"items":[{"id":"m1","partId":"p1","delta":-2,"reason":"used","userId":null,"userName":null,"completionId":"c1","note":null,
            "at":"2026-11-10T10:00:00.000Z"},{"id":"m2","partId":"p1","delta":5,"reason":"bought","userId":"u1","userName":"Anna","completionId":null,
            "note":"Lieferung","at":"2026-11-09T10:00:00.000Z"}],"nextCursor":${next.json()}}"""

    private fun page(vararg items: String) = """{"items":[${items.joinToString(",")}],"nextCursor":null}"""

    private fun orderNow() =
        """{"items":[{"id":"o1","title":"Filter","date":"2026-12-01","taskId":"t1","taskTitle":"Filter wechseln","partId":"p2","partName":"Dichtung",
            "quantity":3,"neededBy":"2026-12-01","orderBy":"2026-11-15","late":true,"stockCount":0,"supplier":"Muster AG",
            "shopUrl":"https://shop.example.org/d","unitPriceMinor":500,"currency":"CHF"}]}"""

    private fun listing() {
        server.household()
        server.on(
            "GET",
            "/api/v1/parts",
            page(
                partJson("p1", "Filter", stock = 5),
                partJson("p2", "Dichtung", stock = 2, min = 2, partNumber = "D-1"),
                partJson("p3", "Leuchte", stock = 0),
                partJson("p4", "Alt", archived = true),
            ),
        )
        server.on("GET", "/api/v1/parts/order-now", orderNow())
    }

    @Test
    fun stockLevelsFollowTheMinimum() {
        assertEquals(STOCK_EMPTY, partStockLevel(0, 0))
        assertEquals(STOCK_LOW, partStockLevel(2, 2))
        assertEquals(STOCK_OK, partStockLevel(2, 0))
        assertEquals(STOCK_OK, partStockLevel(3, 2))
        assertEquals(tr("part_stock_low", "count" to 2), partStockLabel(2, 2))
    }

    @Test
    fun theListHidesArchivedPartsAndCountsTheLowOnes() =
        runTest {
            listing()
            val store = PartsListStore(app)
            val state = store.await { !it.loading && it.total > 0 }
            assertEquals(listOf("p1", "p2", "p3"), state.rows.map { it.id })
            assertEquals(3, state.total)
            assertEquals(2, state.lowCount)
            assertTrue(state.hasArchived)
            assertEquals(1, state.orderNow.size)
            assertTrue(state.orderNow.single().late)
            assertEquals("CHF 15.00", state.orderNow.single().priceText)
            store.close()
        }

    @Test
    fun searchLowOnlyAndArchivedNarrowTheList() =
        runTest {
            listing()
            val store = PartsListStore(app)
            store.await { it.total > 0 }
            store.setLowOnly(true)
            assertEquals(listOf("p2", "p3"), store.await { it.lowOnly }.rows.map { it.id })
            store.search("d-1")
            assertEquals(listOf("p2"), store.await { it.query == "d-1" }.rows.map { it.id })
            store.reset()
            store.setShowArchived(true)
            assertEquals(4, store.await { it.showArchived && it.query.isEmpty() && !it.lowOnly }.rows.size)
            store.close()
        }

    @Test
    fun markingOrderedSendsTheQuantityAndUndoClearsIt() =
        runTest {
            listing()
            server.on("POST", "/api/v1/parts/p2/ordered", partJson("p2", "Dichtung", ordered = true))
            val store = PartsListStore(app)
            store.await { it.orderNow.isNotEmpty() }
            store.markOrdered("p2")
            val state = store.await { it.notice != null }
            assertEquals("p2", state.notice?.undoPartId)
            assertEquals(
                3L,
                server
                    .requestsTo("POST", "/api/v1/parts/p2/ordered")
                    .single()
                    .json
                    .getValue("qty")
                    .jsonPrimitive.content
                    .toLong(),
            )
            store.undoOrdered("p2")
            store.await { it.notice?.undoPartId == null && it.notice != null }
            assertEquals(
                "0",
                server
                    .requestsTo("POST", "/api/v1/parts/p2/ordered")
                    .last()
                    .json
                    .getValue("qty")
                    .jsonPrimitive.content,
            )
            store.close()
        }

    @Test
    fun detailShowsTheStockLinksAndMovements() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/parts/p1", detail(ordered = true))
            server.on("GET", "/api/v1/parts/p1/movements", movements(next = "c2"))
            val store = PartDetailStore(app, "p1")
            val state = store.await { it.view != null }
            val view = assertNotNull(state.view)
            assertEquals("CHF 12.50", view.priceText)
            assertTrue(view.onOrder)
            assertEquals(listOf("Boiler"), view.assets.map { it.name })
            assertEquals("2 ×", view.tasks.single().qtyText)
            assertEquals(listOf("−2", "+5"), state.movements.map { it.deltaText })
            assertTrue(
                state.movements
                    .first()
                    .byText
                    .startsWith(tr("part_movement_by_task")),
            )
            assertTrue(state.moreMovements)
            store.close()
        }

    @Test
    fun quickBookingsSendOnePiece() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/parts/p1", detail())
            server.on("GET", "/api/v1/parts/p1/movements", movements())
            server.on("POST", "/api/v1/parts/p1/stock", partJson("p1", "Filter"))
            val store = PartDetailStore(app, "p1")
            store.await { it.view != null }
            store.quick(true)
            store.await { server.requestsTo("POST", "/api/v1/parts/p1/stock").size == 1 && !it.busy }
            store.quick(false)
            store.await { server.requestsTo("POST", "/api/v1/parts/p1/stock").size == 2 && !it.busy }
            val bodies = server.requestsTo("POST", "/api/v1/parts/p1/stock").map { it.json }
            assertEquals(listOf("-1", "1"), bodies.map { it.getValue("delta").jsonPrimitive.content })
            assertEquals(listOf("used", "bought"), bodies.map { it.getValue("reason").jsonPrimitive.content })
            store.close()
        }

    @Test
    fun usingTheLastPieceIsNotOfferedWhenTheStockIsEmpty() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/parts/p1", detail(stock = 0))
            server.on("GET", "/api/v1/parts/p1/movements", movements())
            val store = PartDetailStore(app, "p1")
            assertEquals(false, store.await { it.view != null }.view?.canUseOne)
            store.quick(true)
            assertTrue(server.requestsTo("POST", "/api/v1/parts/p1/stock").isEmpty())
            store.close()
        }

    @Test
    fun archivingUnlinkingAndDeletingGoToTheirEndpoints() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/parts/p1", detail())
            server.on("GET", "/api/v1/parts/p1/movements", movements())
            server.on("PATCH", "/api/v1/parts/p1", partJson("p1", "Filter", archived = true))
            server.on("DELETE", "/api/v1/assets/a1/parts/p1", "", HttpStatusCode.NoContent)
            server.on("DELETE", "/api/v1/tasks/t1/parts/p1", "", HttpStatusCode.NoContent)
            server.on("DELETE", "/api/v1/parts/p1", "", HttpStatusCode.NoContent)
            val store = PartDetailStore(app, "p1")
            store.await { it.view != null }
            store.toggleArchive()
            store.await { server.requestsTo("PATCH", "/api/v1/parts/p1").size == 1 && !it.busy }
            assertEquals(
                true,
                server
                    .requestsTo("PATCH", "/api/v1/parts/p1")
                    .single()
                    .json
                    .getValue("archived")
                    .jsonPrimitive.content
                    .toBoolean(),
            )
            store.unlinkAsset("a1")
            store.await { server.requestsTo("DELETE", "/api/v1/assets/a1/parts/p1").size == 1 && !it.busy }
            store.unlinkTask("t1")
            store.await { server.requestsTo("DELETE", "/api/v1/tasks/t1/parts/p1").size == 1 && !it.busy }
            store.delete()
            assertTrue(store.await { it.deleted }.deleted)
            store.close()
        }

    @Test
    fun aFailedLoadSetsTheError() =
        runTest {
            server.household()
            server.onError("GET", "/api/v1/parts/p1", HttpStatusCode.NotFound, "not_found")
            server.on("GET", "/api/v1/parts/p1/movements", movements())
            val store = PartDetailStore(app, "p1")
            assertEquals(tr("m_error_not_found"), store.await { !it.loading }.error?.message)
            store.close()
        }

    @Test
    fun creatingValidatesAndSendsTheFieldsAsMinorUnits() =
        runTest {
            server.household()
            server.on("POST", "/api/v1/parts", partJson("p9", "Neu"), HttpStatusCode.Created)
            val store = PartEditStore(app, null)
            val form = assertNotNull(store.await { it.initial != null }.initial)
            assertEquals("CHF", store.value.currency)
            store.save(form.copy(name = " ", price = "abc", minStock = "x", reorderQty = "0"))
            val errors = store.await { it.fieldErrors.isNotEmpty() }.fieldErrors
            assertEquals(setOf("name", "unitPriceMinor", "minStock", "reorderQty"), errors.keys)
            assertTrue(server.requests.none { it.method == "POST" })
            store.save(form.copy(name = " Neu ", price = "12.50", stockCount = "3", supplier = " ", shopUrl = ""))
            assertEquals("p9", store.await { it.savedId != null }.savedId)
            val body = server.requestsTo("POST", "/api/v1/parts").single().json
            assertEquals("Neu", body.getValue("name").jsonPrimitive.content)
            assertEquals("1250", body.getValue("unitPriceMinor").jsonPrimitive.content)
            assertEquals("3", body.getValue("stockCount").jsonPrimitive.content)
            assertEquals("CHF", body.getValue("currency").jsonPrimitive.content)
            assertNull(body["supplier"])
            assertNull(body["shopUrl"])
            store.close()
        }

    @Test
    fun editingClearsFieldsWithNullAndTheShopWithAnEmptyString() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/parts/p1", detail())
            server.on("GET", "/api/v1/parts/p1/movements", movements())
            server.on("PATCH", "/api/v1/parts/p1", partJson("p1", "Filter"))
            val store = PartEditStore(app, "p1")
            val form = assertNotNull(store.await { it.initial != null }.initial)
            assertEquals("12.50", form.price)
            store.save(form.copy(price = "", supplier = "", shopUrl = "", notes = ""))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/parts/p1").single().json
            assertEquals(JsonNull, body["unitPriceMinor"])
            assertEquals(JsonNull, body["supplier"])
            assertEquals(JsonNull, body["notes"])
            assertEquals(JsonPrimitive(""), body["shopUrl"])
            assertNull(body["stockCount"])
            store.close()
        }

    @Test
    fun stockSheetComputesTheDeltaAndRefusesNegativeStock() =
        runTest {
            server.on("GET", "/api/v1/parts/p1", detail(stock = 3))
            server.on("POST", "/api/v1/parts/p1/stock", partJson("p1", "Filter"))
            val store = PartStockStore(app, "p1", "used", 1)
            val form = assertNotNull(store.await { it.initial != null }.initial)
            assertEquals(-1, store.delta(form))
            assertEquals(tr("part_stock_result", "count" to 2), store.resultText(form))
            assertEquals(5, store.delta(form.copy(reason = "bought", qty = "5")))
            assertEquals(-2, store.delta(form.copy(reason = "correction", direction = "less", qty = "2")))
            assertEquals("4", store.step(form.copy(qty = "3"), 1).qty)
            assertEquals("1", store.step(form, -1).qty)
            store.save(form.copy(qty = "4"))
            assertEquals(tr("part_stock_below_zero"), store.await { it.fieldErrors.isNotEmpty() }.fieldErrors["delta"])
            store.save(form.copy(qty = "0"))
            assertEquals(
                tr("field_min", "min" to 1),
                store.await { it.fieldErrors["delta"] != tr("part_stock_below_zero") }.fieldErrors["delta"],
            )
            assertTrue(server.requestsTo("POST", "/api/v1/parts/p1/stock").isEmpty())
            store.save(form.copy(qty = "2", note = " Test "))
            store.await { it.done }
            val body = server.requestsTo("POST", "/api/v1/parts/p1/stock").single().json
            assertEquals("-2", body.getValue("delta").jsonPrimitive.content)
            assertEquals("Test", body.getValue("note").jsonPrimitive.content)
            store.close()
        }

    @Test
    fun theArrivalOfAnOrderStartsWithItsQuantity() =
        runTest {
            server.on("GET", "/api/v1/parts/p1", detail())
            val store = PartStockStore(app, "p1", "bought", 3)
            val form = assertNotNull(store.await { it.initial != null }.initial)
            assertEquals("bought", form.reason)
            assertEquals("3", form.qty)
            store.close()
        }

    @Test
    fun orderedSheetStartsWithTheReorderQuantityAndSendsTheQuantity() =
        runTest {
            server.on("GET", "/api/v1/parts/p1", detail())
            server.on("POST", "/api/v1/parts/p1/ordered", partJson("p1", "Filter", ordered = true))
            val store = PartOrderedStore(app, "p1")
            assertEquals("4", store.await { !it.loading }.initialQty)
            store.save("0")
            store.await { it.fieldErrors.isNotEmpty() }
            store.save("6")
            store.await { it.done }
            assertEquals(
                "6",
                server
                    .requestsTo("POST", "/api/v1/parts/p1/ordered")
                    .single()
                    .json
                    .getValue("qty")
                    .jsonPrimitive.content,
            )
            store.close()
        }

    @Test
    fun linkingADeviceOffersOnlyUnlinkedOnesAndReportsATakenLink() =
        runTest {
            server.on("GET", "/api/v1/parts/p1", detail())
            server.on("GET", "/api/v1/assets", page(assetJson("a1", "Boiler"), assetJson("a2", "Ofen", roomName = "Küche")))
            server.onError("POST", "/api/v1/assets/a2/parts", HttpStatusCode.Conflict, "conflict", "Conflict")
            val store = PartAssetLinkStore(app, "p1")
            val state = store.await { !it.loading }
            assertEquals(listOf("a2"), state.options.map { it.value })
            assertEquals("Küche", state.options.single().detail)
            store.link("")
            assertEquals(tr("part_link_choose_asset"), store.await { it.fieldErrors.isNotEmpty() }.fieldErrors["choice"])
            store.link("a2")
            assertEquals(tr("part_link_taken"), store.await { it.error != null }.error?.message)
            store.close()
        }

    @Test
    fun linkingATaskSendsThePartAndTheQuantity() =
        runTest {
            server.on("GET", "/api/v1/parts/p1", detail())
            server.on(
                "GET",
                "/api/v1/tasks",
                page(taskJson("t1", "due", title = "Filter wechseln"), taskJson("t2", "due", title = "Heizung warten")),
            )
            server.on(
                "POST",
                "/api/v1/tasks/t2/parts",
                """{"taskId":"t2","partId":"p1","qty":2,"part":${partJson("p1", "Filter")}}""",
                HttpStatusCode.Created,
            )
            val store = PartTaskLinkStore(app, "p1")
            assertEquals(listOf("t2"), store.await { !it.loading }.options.map { it.value })
            store.link("t2", "0")
            assertEquals(setOf("qty"), store.await { it.fieldErrors.isNotEmpty() }.fieldErrors.keys)
            store.link("t2", "2")
            store.await { it.done }
            val body = server.requestsTo("POST", "/api/v1/tasks/t2/parts").single().json
            assertEquals("p1", body.getValue("partId").jsonPrimitive.content)
            assertEquals("2", body.getValue("qty").jsonPrimitive.content)
            store.close()
        }

    @Test
    fun changingTheQuantityOfALinkedTask() =
        runTest {
            server.on("PATCH", "/api/v1/tasks/t1/parts/p1", """{"taskId":"t1","partId":"p1","qty":4,"part":${partJson("p1", "Filter")}}""")
            val store = PartTaskQtyStore(app, "p1", "t1", "Filter wechseln")
            store.save("1000")
            store.await { it.fieldErrors.isNotEmpty() }
            store.save("4")
            store.await { it.done }
            assertEquals(
                "4",
                server
                    .requestsTo("PATCH", "/api/v1/tasks/t1/parts/p1")
                    .single()
                    .json
                    .getValue("qty")
                    .jsonPrimitive.content,
            )
            store.close()
        }
}
