package ch.orellbuehler.hauswart.feature.attachments

import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.seconds

class AttachmentsStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun attachment(
        id: String,
        filename: String = "$id.jpg",
        mime: String = "image/jpeg",
        caption: String? = null,
        guest: Boolean = false,
        size: Long = 2048,
    ): String =
        """{"id":"$id","ownerType":"task","ownerId":"t1","filename":"$filename","mime":"$mime","size":$size,"width":null,"height":null,
            "caption":${if (caption == null) "null" else "\"$caption\""},"guestVisible":$guest,"url":"/api/v1/attachments/$id/content",
            "thumbUrl":${if (mime.startsWith("image/")) "\"/api/v1/attachments/$id/thumb\"" else "null"},
            "uploadedBy":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

    private fun page(vararg items: String) = """{"items":[${items.joinToString(",")}],"nextCursor":null}"""

    private fun store(owner: String = "task"): AttachmentsStore = AttachmentsStore(app, owner, "t1")

    private val jpeg = byteArrayOf(1, 2, 3, 4)

    @Test
    fun loadsTheFilesWithLabelsAndKinds() =
        runTest {
            server.on(
                "GET",
                "/api/v1/attachments",
                page(
                    attachment("a1", caption = "Boiler plate"),
                    attachment("a2", "manual.pdf", "application/pdf", size = 5L * 1024 * 1024),
                ),
            )
            val store = store()
            val state = store.await { !it.loading }
            assertNull(state.error)
            assertEquals(listOf("Boiler plate", "manual.pdf"), state.rows.map { it.label })
            assertEquals(listOf("image", "pdf"), state.rows.map { it.kind })
            assertEquals(listOf(true, false), state.rows.map { it.hasThumb })
            assertEquals("5 MB", state.rows[1].sizeText)
            assertTrue(state.guestOwner)
            val query = server.requests.first { it.path == "/api/v1/attachments" }.query
            assertTrue("ownerType=task" in query && "ownerId=t1" in query)
            store.close()
        }

    @Test
    fun onlySomeOwnersOfferGuestVisibility() =
        runTest {
            server.on("GET", "/api/v1/attachments", page())
            val appointments = store("appointment")
            assertFalse(appointments.value.guestOwner)
            appointments.close()
        }

    @Test
    fun aFailedLoadSetsTheError() =
        runTest {
            server.onError("GET", "/api/v1/attachments", HttpStatusCode.InternalServerError, "internal_error")
            val store = store()
            val state = store.await { !it.loading }
            assertEquals(tr("m_error_server"), state.error?.message)
            store.close()
        }

    @Test
    fun uploadingSendsTheFileAsMultipartAndListsIt() =
        runTest {
            server.on("GET", "/api/v1/attachments", page())
            val store = store()
            store.await { !it.loading }
            server.on("POST", "/api/v1/attachments", attachment("a9", "photo.jpg"), HttpStatusCode.Created)
            server.on("GET", "/api/v1/attachments", page(attachment("a9", "photo.jpg")))

            store.upload("photo.jpg", "image/jpeg", jpeg)
            val state = store.await { it.rows.isNotEmpty() && it.uploads.isEmpty() }
            assertEquals(listOf("a9"), state.rows.map { it.id })
            val request = server.requestsTo("POST", "/api/v1/attachments").single()
            assertTrue("name=\"ownerType\"\r\nContent-Length: 4\r\n\r\ntask" in request.body)
            assertTrue("name=\"ownerId\"\r\nContent-Length: 2\r\n\r\nt1" in request.body)
            assertTrue("name=\"file\"; filename=\"photo.jpg\"\r\nContent-Type: image/jpeg" in request.body)
            store.close()
        }

    @Test
    fun anUploadSurvivesLeavingTheScreenAndReportsTheChange() =
        runTest {
            server.on("GET", "/api/v1/attachments", page())
            val store = store()
            store.await { !it.loading }
            server.on("POST", "/api/v1/attachments", attachment("a9", "photo.jpg"), HttpStatusCode.Created)
            val changes = mutableListOf<String>()
            val watching = launch(Dispatchers.Unconfined) { app.changes.collect { changes += it } }

            store.upload("photo.jpg", "image/jpeg", jpeg)
            store.close()
            server.awaitRequest("POST", "/api/v1/attachments")
            withContext(Dispatchers.Default) { withTimeout(60.seconds) { while ("attachments" !in changes) delay(10) } }
            watching.cancel()
            assertTrue(store.value.uploads.isEmpty())
            assertEquals(listOf("a9"), store.value.rows.map { it.id })
        }

    @Test
    fun refusedFilesNeverReachTheServer() =
        runTest {
            server.on("GET", "/api/v1/attachments", page())
            val store = store()
            store.await { !it.loading }
            val cases =
                listOf(
                    Triple("IMG_1.HEIC", "image/heic", "attach_error_heic"),
                    Triple("notes.txt", "text/plain", "attach_error_unsupported_type"),
                    Triple("empty.pdf", "application/pdf", "attach_error_empty"),
                )
            cases.forEachIndexed { index, (name, mime, key) ->
                store.upload(name, mime, if (key == "attach_error_empty") ByteArray(0) else jpeg)
                val row = store.value.uploads[index]
                assertTrue(row.failed, name)
                assertFalse(row.canRetry, name)
                assertEquals(tr(key), row.error, name)
            }
            assertTrue(server.requestsTo("POST", "/api/v1/attachments").isEmpty())
            store.dismissUpload(
                store.value.uploads
                    .first()
                    .id,
            )
            assertEquals(2, store.value.uploads.size)
            store.close()
        }

    @Test
    fun theTypeComesFromTheExtensionWhenThePickerGivesNone() =
        runTest {
            server.on("GET", "/api/v1/attachments", page())
            server.on("POST", "/api/v1/attachments", attachment("a9", "scan.pdf", "application/pdf"), HttpStatusCode.Created)
            val store = store()
            store.await { !it.loading }
            store.upload("scan.pdf", null, jpeg)
            store.await { it.rows.isNotEmpty() }
            assertTrue("application/pdf" in server.requestsTo("POST", "/api/v1/attachments").single().body)
            store.close()
        }

    @Test
    fun aServerRefusalShowsItsReasonAndCannotBeRetried() =
        runTest {
            server.on("GET", "/api/v1/attachments", page())
            server.onError(
                "POST",
                "/api/v1/attachments",
                HttpStatusCode.PayloadTooLarge,
                "invalid_request",
                details = """{"code":"image_too_large"}""",
            )
            val store = store()
            store.await { !it.loading }
            store.upload("big.jpg", "image/jpeg", jpeg)
            val row = store.await { it.uploads.any { u -> u.failed } }.uploads.single()
            assertEquals(tr("attach_error_image_too_large"), row.error)
            assertFalse(row.canRetry)
            store.close()
        }

    @Test
    fun aNetworkFailureCanBeRetried() =
        runTest {
            server.on("GET", "/api/v1/attachments", page())
            val store = store()
            store.await { !it.loading }
            server.offline = true
            store.upload("photo.jpg", "image/jpeg", jpeg)
            val failed = store.await { it.uploads.any { u -> u.failed } }.uploads.single()
            assertEquals(tr("attach_error_network"), failed.error)
            assertTrue(failed.canRetry)

            server.offline = false
            server.on("POST", "/api/v1/attachments", attachment("a9", "photo.jpg"), HttpStatusCode.Created)
            store.retryUpload(failed.id)
            val state = store.await { it.rows.isNotEmpty() && it.uploads.isEmpty() }
            assertEquals("a9", state.rows.single().id)
            store.close()
        }

    @Test
    fun savingACaptionSendsItAndAnEmptyOneClearsIt() =
        runTest {
            server.on("GET", "/api/v1/attachments", page(attachment("a1")))
            val store = store()
            store.await { !it.loading }
            server.on("PATCH", "/api/v1/attachments/a1", attachment("a1", caption = "Front"))
            store.saveCaption("a1", "  Front ")
            store.await { it.captioned == 1 }
            assertEquals(
                "Front",
                server
                    .requestsTo("PATCH", "/api/v1/attachments/a1")
                    .last()
                    .json
                    .getValue("caption")
                    .jsonPrimitive.content,
            )

            server.on("PATCH", "/api/v1/attachments/a1", attachment("a1"))
            store.saveCaption("a1", " ")
            store.await { it.captioned == 2 }
            assertEquals(JsonNull, server.requestsTo("PATCH", "/api/v1/attachments/a1").last().json["caption"])
            store.close()
        }

    @Test
    fun aTooLongCaptionIsRefusedBeforeSending() =
        runTest {
            server.on("GET", "/api/v1/attachments", page(attachment("a1")))
            val store = store()
            store.await { !it.loading }
            store.saveCaption("a1", "x".repeat(ATTACHMENT_CAPTION_MAX + 1))
            assertEquals(tr("field_too_long", "max" to ATTACHMENT_CAPTION_MAX), store.value.captionError)
            assertTrue(server.requestsTo("PATCH", "/api/v1/attachments/a1").isEmpty())
            store.close()
        }

    @Test
    fun theGuestSwitchSendsTheNewValue() =
        runTest {
            server.on("GET", "/api/v1/attachments", page(attachment("a1")))
            val store = store()
            store.await { !it.loading }
            server.on("PATCH", "/api/v1/attachments/a1", attachment("a1", guest = true))
            // The store reloads after its own change; the list has to say the same by then.
            server.on("GET", "/api/v1/attachments", page(attachment("a1", guest = true)))
            store.setGuestVisible("a1", true)
            val state = store.await { it.rows.first().guestVisible && it.busyId == null }
            assertNull(state.busyId)
            assertEquals(
                true,
                server
                    .requestsTo(
                        "PATCH",
                        "/api/v1/attachments/a1",
                    ).single()
                    .json
                    .getValue("guestVisible")
                    .jsonPrimitive.content
                    .toBoolean(),
            )
            store.close()
        }

    @Test
    fun deletingRemovesTheFile() =
        runTest {
            server.on("GET", "/api/v1/attachments", page(attachment("a1"), attachment("a2")))
            val store = store()
            store.await { !it.loading }
            server.on("GET", "/api/v1/attachments", page(attachment("a2")))
            server.on("DELETE", "/api/v1/attachments/a1", "", HttpStatusCode.NoContent)
            store.delete("a1")
            val state = store.await { it.rows.map { r -> r.id } == listOf("a2") && it.busyId == null }
            assertNull(state.actionError)
            store.close()
        }

    @Test
    fun aRefusedDeleteKeepsTheFileAndReports() =
        runTest {
            server.on("GET", "/api/v1/attachments", page(attachment("a1")))
            server.onError("DELETE", "/api/v1/attachments/a1", HttpStatusCode.Conflict, "conflict")
            val store = store()
            store.await { !it.loading }
            store.delete("a1")
            val state = store.await { it.actionError != null }
            assertEquals(1, state.rows.size)
            assertNull(state.busyId)
            store.close()
        }

    @Test
    fun openingFetchesTheContentForTheViewer() =
        runTest {
            server.on("GET", "/api/v1/attachments", page(attachment("a1", "manual.pdf", "application/pdf")))
            server.on("GET", "/api/v1/attachments/a1/content", "PDFBYTES")
            val store = store()
            store.await { !it.loading }
            store.open("a1")
            val opened = assertNotNull(store.await { it.opened != null }.opened)
            assertEquals("a1", opened.attachmentId)
            assertEquals("manual.pdf", opened.file.name)
            assertEquals("application/pdf", opened.file.mime)
            assertContentEquals("PDFBYTES".encodeToByteArray(), opened.file.bytes)
            assertFalse(opened.share)
            store.clearOpened()
            assertNull(store.value.opened)

            store.share("a1")
            assertTrue(store.await { it.opened != null }.opened!!.share)
            assertTrue(
                server
                    .requestsTo("GET", "/api/v1/attachments/a1/content")
                    .last()
                    .query
                    .contains("download=1"),
            )
            store.close()
        }

    @Test
    fun aFailedOpenReports() =
        runTest {
            server.on("GET", "/api/v1/attachments", page(attachment("a1")))
            server.onError("GET", "/api/v1/attachments/a1/content", HttpStatusCode.NotFound, "not_found")
            val store = store()
            store.await { !it.loading }
            store.open("a1")
            val state = store.await { it.actionError != null }
            assertEquals(tr("m_error_not_found"), state.actionError?.message)
            assertNull(state.opening)
            store.close()
        }

    @Test
    fun thumbnailsLoadLazilyAndStayInMemory() =
        runTest {
            server.on("GET", "/api/v1/attachments", page(attachment("a1"), attachment("a2")))
            server.on("GET", "/api/v1/attachments/a1/thumb", "THUMB1")
            server.onError("GET", "/api/v1/attachments/a2/thumb", HttpStatusCode.NotFound, "not_found")
            val store = store()
            store.await { !it.loading }
            assertNull(store.thumbnail("a1"))
            assertTrue(server.requestsTo("GET", "/api/v1/attachments/a1/thumb").isEmpty())

            store.requestThumbnail("a1")
            store.requestThumbnail("a1")
            store.requestThumbnail("a2")
            store.await { store.thumbnail("a1") != null && store.thumbnailFailed("a2") }
            assertContentEquals("THUMB1".encodeToByteArray(), store.thumbnail("a1"))
            assertEquals("VEhVTUIx", store.thumbnailBase64("a1"))

            store.requestThumbnail("a1")
            store.requestThumbnail("a2")
            assertEquals(1, server.requestsTo("GET", "/api/v1/attachments/a1/thumb").size)
            assertEquals(1, server.requestsTo("GET", "/api/v1/attachments/a2/thumb").size)
            store.close()
        }
}
