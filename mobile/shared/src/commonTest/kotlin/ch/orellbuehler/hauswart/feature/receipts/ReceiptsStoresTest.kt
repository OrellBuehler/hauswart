package ch.orellbuehler.hauswart.feature.receipts

import ch.orellbuehler.hauswart.feature.costs.costBook
import ch.orellbuehler.hauswart.feature.costs.page
import ch.orellbuehler.hauswart.feature.costsplit.settle
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.seconds

class ReceiptsStoresTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun String?.q() = if (this == null) "null" else "\"$this\""

    private fun task(
        id: String,
        status: String = "pending",
        by: String = "u1",
        reason: String? = null,
        withCosts: Boolean = false,
    ) = """{"id":"$id","kind":"receipt","status":"$status","note":"Tankstelle","createdByUserId":"$by","createdByName":"Anna",
        "attachment":{"id":"a-$id","ownerType":"ai_task","ownerId":"$id","filename":"beleg.jpg","mime":"image/jpeg","size":1000,"width":10,"height":10,
        "caption":null,"guestVisible":false,"url":"/x","thumbUrl":"/t","uploadedBy":"u1","createdAt":"2026-11-01T00:00:00.000Z","updatedAt":"2026-11-01T00:00:00.000Z"},
        "bookId":null,"bookName":"Auto","assetId":null,"assetName":null,"claim":null,"bookedSoFar":[],
        "result":${
        if (withCosts) {
            """{"createdCostIds":["e1"],"createdFuelLogIds":[],"note":"unsicher","costs":[{"id":"e1","date":"2026-11-02","title":"Benzin","amountMinor":6000,"currency":"CHF","reviewNeeded":true,"fuelLogId":null}]}"""
        } else {
            "null"
        }
    },
        "dismissReason":${reason.q()},"completedAt":null,"completedVia":null,"completedByUserId":null,"completedByName":null,
        "createdAt":"2026-11-01T10:00:00.000Z","updatedAt":"2026-11-01T10:00:00.000Z"}"""

    private fun listing(vararg items: String) = """{"items":[${items.joinToString(",")}],"nextCursor":null}"""

    @Test
    fun openReceiptsComeFirstAndEachOnlyOnce() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/ai-tasks/count", """{"count":1}""")
            server.on("GET", "/api/v1/ai-tasks", listing(task("t2", status = "done", withCosts = true), task("t1")))
            val store = ReceiptsStore(app, null)
            val state = store.await { !it.loading }
            assertEquals(listOf("t1", "t2"), state.rows.map { it.id }.sorted())
            assertEquals(1, state.pendingCount)
            assertEquals("1", state.views.first { it.value == "pending" }.badge)
            val done = state.rows.first { it.id == "t2" }
            assertEquals("Benzin", done.costs.single().title)
            assertTrue(done.costs.single().reviewNeeded)
            settle()
            store.close()
        }

    @Test
    fun theStatusFilterIsPassedToTheServer() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/ai-tasks/count", """{"count":0}""")
            server.on("GET", "/api/v1/ai-tasks", listing())
            val store = ReceiptsStore(app, "dismissed")
            val state = store.await { !it.loading }
            assertEquals("dismissed", state.view)
            assertEquals(tr("receipts_empty_dismissed_title"), state.emptyTitle)
            assertTrue(server.requestsTo("GET", "/api/v1/ai-tasks").all { "status=dismissed" in it.query })
            settle()
            store.close()
        }

    @Test
    fun dismissingSendsTheReasonAndAConflictReloads() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/ai-tasks/count", """{"count":1}""")
            server.on("GET", "/api/v1/ai-tasks", listing(task("t1")))
            server.on("POST", "/api/v1/ai-tasks/t1/dismiss", task("t1", status = "dismissed", reason = "kein Beleg"))
            val store = ReceiptsStore(app, null)
            store.await { !it.loading }
            store.dismiss("t1", " kein Beleg ")
            store.await { it.notice != null }
            assertEquals(
                "kein Beleg",
                server
                    .requestsTo("POST", "/api/v1/ai-tasks/t1/dismiss")
                    .single()
                    .json
                    .getValue("reason")
                    .jsonPrimitive.content,
            )

            server.onError("POST", "/api/v1/ai-tasks/t1/dismiss", HttpStatusCode.Conflict, "conflict")
            store.dismissNotice()
            store.dismiss("t1", "")
            assertEquals(tr("receipts_conflict"), store.await { it.actionError != null }.actionError?.message)
            settle()
            store.close()
        }

    @Test
    fun onlyTheUploaderAndAdminsCanDelete() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/ai-tasks/count", """{"count":2}""")
            server.on("GET", "/api/v1/ai-tasks", listing(task("t1"), task("t2", by = "u2")))
            val store = ReceiptsStore(app, null)
            val rows = store.await { !it.loading }.rows
            assertTrue(rows.all { it.canDelete })
            settle()
            store.close()

            server.signIn(
                user =
                    ch.orellbuehler.hauswart.api.generated.User(
                        id = "u3",
                        username = "ben",
                        displayName = "Ben",
                        role = "member",
                        locale = "de",
                    ),
            )
            val member = ReceiptsStore(app, null)
            val memberRows = member.await { !it.loading }.rows
            assertTrue(memberRows.none { it.canDelete })
            settle()
            member.close()
        }

    @Test
    fun aReceiptNeedsAFileAndRefusesHeic() =
        runTest {
            server.on("GET", "/api/v1/cost-books", page(costBook("b1", "Haushalt"), costBook("b2", "Auto")))
            server.on("GET", "/api/v1/assets", page())
            val store = ReceiptSubmitStore(app)
            val loaded = store.await { !it.loading }
            assertEquals(3, loaded.books.size)
            store.submit(ReceiptForm())
            assertEquals(tr("quick_receipt_required"), store.await { it.fieldErrors.isNotEmpty() }.fieldErrors["file"])

            store.pickFile("beleg.heic", null, byteArrayOf(1, 2, 3))
            val heic = store.await { it.fileProblem != null }
            assertEquals(tr("attach_error_heic"), heic.fileProblem)
            store.submit(ReceiptForm())
            assertEquals(heic.fileProblem, store.await { it.fieldErrors["file"] != null }.fieldErrors["file"])
            assertTrue(server.requestsTo("POST", "/api/v1/ai-tasks").isEmpty())
            settle()
            store.close()
        }

    @Test
    fun aLargePdfIsWarnedAbout() =
        runTest {
            server.on("GET", "/api/v1/cost-books", page(costBook("b1", "Haushalt")))
            server.on("GET", "/api/v1/assets", page())
            val store = ReceiptSubmitStore(app)
            store.await { !it.loading }
            store.pickFile("rechnung.pdf", "application/pdf", ByteArray((RECEIPT_PDF_READ_MAX_BYTES + 1).toInt()))
            val state = store.await { it.fileName != null }
            assertNull(state.fileProblem)
            assertNotNull(state.fileWarning)
            settle()
            store.close()
        }

    @Test
    fun submittingUploadsTheFileWithAKeyAndCanBeUndone() =
        runTest {
            server.on("GET", "/api/v1/cost-books", page(costBook("b1", "Haushalt")))
            server.on("GET", "/api/v1/assets", page())
            server.on("POST", "/api/v1/ai-tasks", task("t7"), HttpStatusCode.Created)
            server.on("DELETE", "/api/v1/ai-tasks/t7", "", HttpStatusCode.NoContent)
            val store = ReceiptSubmitStore(app)
            store.await { !it.loading }
            store.pickFile("beleg.jpg", "image/jpeg", byteArrayOf(1, 2, 3))
            store.submit(ReceiptForm(note = "Tanken"))
            assertEquals("t7", store.await { it.createdId != null }.createdId)
            val request = server.requestsTo("POST", "/api/v1/ai-tasks").single()
            assertTrue("idempotencyKey" in request.body && "Tanken" in request.body && "beleg.jpg" in request.body)
            store.undo()
            assertTrue(store.await { it.undone }.undone)
            assertEquals(1, server.requestsTo("DELETE", "/api/v1/ai-tasks/t7").size)
            settle()
            store.close()
        }

    @Test
    fun aReceiptIsStillSentWhenTheScreenIsLeft() =
        runTest {
            server.on("GET", "/api/v1/cost-books", page(costBook("b1", "Haushalt")))
            server.on("GET", "/api/v1/assets", page())
            server.on("POST", "/api/v1/ai-tasks", task("t7"), HttpStatusCode.Created)
            val store = ReceiptSubmitStore(app)
            store.await { !it.loading }
            store.pickFile("beleg.jpg", "image/jpeg", byteArrayOf(1, 2, 3))
            val change = async(start = CoroutineStart.UNDISPATCHED) { app.changes.first { it == "costs" } }
            store.submit(ReceiptForm(note = "Tanken"))
            store.close()
            server.awaitRequest("POST", "/api/v1/ai-tasks")
            withContext(Dispatchers.Default) { withTimeout(60.seconds) { change.await() } }
            assertEquals("t7", store.value.createdId)
        }

    @Test
    fun aLostConnectionPointsToTheList() =
        runTest {
            server.on("GET", "/api/v1/cost-books", page(costBook("b1", "Haushalt")))
            server.on("GET", "/api/v1/assets", page())
            val store = ReceiptSubmitStore(app)
            store.await { !it.loading }
            store.pickFile("beleg.jpg", "image/jpeg", byteArrayOf(1, 2, 3))
            server.offline = true
            store.submit(ReceiptForm())
            val state = store.await { it.noAnswer }
            assertEquals(tr("quick_error_network_receipt"), state.error)
            server.offline = false
            settle()
            store.close()
        }
}
