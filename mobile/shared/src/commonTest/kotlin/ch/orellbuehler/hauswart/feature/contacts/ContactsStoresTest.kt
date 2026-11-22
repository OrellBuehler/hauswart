package ch.orellbuehler.hauswart.feature.contacts

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
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.seconds

class ContactsStoresTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun contact(
        id: String,
        name: String,
        kind: String = "installer",
        company: String? = null,
        emergency: Boolean = false,
        phone: String? = null,
        email: String? = null,
    ): String =
        """{"id":"$id","kind":"$kind","name":"$name","company":${company.json()},"phone":${phone.json()},"email":${email.json()},
            "url":null,"address":null,"notes":null,"emergency":$emergency,"guestVisible":false,"sortOrder":0,
            "externalSource":null,"externalRef":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

    private fun String?.json(): String = if (this == null) "null" else "\"$this\""

    private fun detail(
        id: String,
        name: String,
        email: String? = null,
    ): String =
        contact(id, name, email = email).dropLast(1) +
            ""","assets":[{"linkId":"l1","assetId":"a1","assetName":"Boiler","role":"service"}]}"""

    private fun page(vararg items: String) = """{"items":[${items.joinToString(",")}],"nextCursor":null}"""

    private fun listWithThree() =
        server.on(
            "GET",
            "/api/v1/contacts",
            page(
                contact("c1", "Berta Muster", kind = "neighbor"),
                contact("c2", "Muster Heizungen AG", kind = "installer", company = "Muster AG"),
                contact("c3", "Notruf Wasser", kind = "emergency", emergency = true),
            ),
        )

    @Test
    fun listLoadsAndGroupsByKind() =
        runTest {
            listWithThree()
            val store = ContactsListStore(app)
            val state = store.await { !it.loading }
            assertNull(state.error)
            assertEquals(3, state.total)
            assertEquals(listOf("installer", "emergency", "neighbor"), state.groups.map { it.kind })
            assertEquals(tr("contact_group_installer"), state.groups.first().title)
            assertEquals(3, state.shown)
            store.close()
        }

    @Test
    fun searchAndEmergencyFilterNarrowTheGroups() =
        runTest {
            listWithThree()
            val store = ContactsListStore(app)
            store.await { !it.loading }

            store.search("heiz")
            val searched = store.await { it.query == "heiz" }
            assertEquals(listOf("c2"), searched.groups.flatMap { it.contacts }.map { it.id })
            assertTrue(searched.filtered)

            store.search("")
            store.setEmergencyOnly(true)
            val emergency = store.await { it.emergencyOnly }
            assertEquals(listOf("c3"), emergency.groups.flatMap { it.contacts }.map { it.id })
            assertEquals(3, emergency.total)

            store.search("zzz")
            val none = store.await { it.query == "zzz" }
            assertTrue(none.groups.isEmpty())
            assertEquals(3, none.total)
            store.close()
        }

    @Test
    fun aFailedLoadSetsTheError() =
        runTest {
            server.onError("GET", "/api/v1/contacts", HttpStatusCode.InternalServerError, "internal_error")
            val store = ContactsListStore(app)
            val state = store.await { !it.loading }
            assertEquals(tr("m_error_server"), state.error?.message)
            assertTrue(state.groups.isEmpty())
            store.close()
        }

    @Test
    fun detailLoadsTheContactWithItsDevices() =
        runTest {
            server.on("GET", "/api/v1/contacts/c1", detail("c1", "Berta Muster"))
            val store = ContactDetailStore(app, "c1")
            val state = store.await { !it.loading }
            assertEquals("Berta Muster", state.contact?.name)
            assertEquals(listOf("a1"), state.contact?.assets?.map { it.assetId })
            store.close()
        }

    @Test
    fun deletingClosesTheScreenAndReportsTheChange() =
        runTest {
            server.on("GET", "/api/v1/contacts/c1", detail("c1", "Berta Muster"))
            server.on("DELETE", "/api/v1/contacts/c1", "", HttpStatusCode.NoContent)
            val store = ContactDetailStore(app, "c1")
            store.await { it.contact != null }
            val change = async(Dispatchers.Unconfined) { app.changes.first() }

            store.delete()
            val state = store.await { it.deleted }
            assertEquals(1, server.requestsTo("DELETE", "/api/v1/contacts/c1").size)
            assertTrue(state.deleted)
            assertEquals("contacts", withContext(Dispatchers.Default) { withTimeout(60.seconds) { change.await() } })
            store.close()
        }

    @Test
    fun aFailedDeleteKeepsTheContactAndReports() =
        runTest {
            server.on("GET", "/api/v1/contacts/c1", detail("c1", "Berta Muster"))
            server.onError("DELETE", "/api/v1/contacts/c1", HttpStatusCode.Forbidden, "forbidden")
            val store = ContactDetailStore(app, "c1")
            store.await { it.contact != null }
            store.delete()
            val state = store.await { it.actionError != null }
            assertEquals(tr("m_error_forbidden"), state.actionError?.message)
            assertEquals(false, state.deleted)
            assertNotNull(state.contact)
            store.close()
        }

    @Test
    fun savingWithoutANameAsksNoServer() =
        runTest {
            val store = ContactEditStore(app, null)
            store.save(ContactForm(name = "   "))
            val state = store.await { it.fieldErrors.isNotEmpty() }
            assertEquals(mapOf("name" to tr("m_field_required")), state.fieldErrors)
            assertTrue(server.requests.isEmpty())
            assertNull(state.savedId)
            store.close()
        }

    @Test
    fun creatingSendsTheTrimmedFieldsAndFinishes() =
        runTest {
            server.on("POST", "/api/v1/contacts", contact("c9", "Hans Beispiel"), HttpStatusCode.Created)
            val store = ContactEditStore(app, null)
            store.save(
                ContactForm(
                    kind = "neighbor",
                    name = " Hans Beispiel ",
                    phone = "+41 00 000 00 00",
                    email = "",
                    notes = "  ",
                    emergency = true,
                ),
            )
            val state = store.await { it.savedId != null }
            assertEquals("c9", state.savedId)
            val body = server.requestsTo("POST", "/api/v1/contacts").single().json
            assertEquals("neighbor", body.getValue("kind").jsonPrimitive.content)
            assertEquals("Hans Beispiel", body.getValue("name").jsonPrimitive.content)
            assertEquals("+41 00 000 00 00", body.getValue("phone").jsonPrimitive.content)
            assertNull(body["email"])
            assertNull(body["notes"])
            assertEquals(true, body.getValue("emergency").jsonPrimitive.booleanOrNull)
            assertEquals(false, body.getValue("guestVisible").jsonPrimitive.booleanOrNull)
            store.close()
        }

    @Test
    fun updatingClearsFieldsWithNullAndTheEmailWithAnEmptyString() =
        runTest {
            server.on("GET", "/api/v1/contacts/c1", detail("c1", "Berta Muster", email = "berta@example.org"))
            server.on("PATCH", "/api/v1/contacts/c1", contact("c1", "Berta Muster"))
            val store = ContactEditStore(app, "c1")
            val loaded = store.await { it.initial != null && !it.loading }
            val form = assertNotNull(loaded.initial)
            assertEquals("berta@example.org", form.email)

            store.save(form.copy(email = "", company = ""))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/contacts/c1").single().json
            assertEquals(JsonNull, body["company"])
            assertEquals(JsonNull, body["phone"])
            assertEquals(JsonPrimitive(""), body["email"])
            assertEquals(JsonPrimitive(""), body["url"])
            store.close()
        }

    @Test
    fun serverFieldErrorsLandInFieldErrors() =
        runTest {
            server.onError(
                "POST",
                "/api/v1/contacts",
                HttpStatusCode.BadRequest,
                "invalid_request",
                details = """{"body":{"formErrors":[],"fieldErrors":{"email":["Invalid email"]}}}""",
            )
            val store = ContactEditStore(app, null)
            store.save(ContactForm(name = "Hans", email = "nope"))
            val state = store.await { !it.saving && it.fieldErrors.isNotEmpty() }
            assertEquals(mapOf("email" to "Invalid email"), state.fieldErrors)
            assertNull(state.error)
            assertNull(state.savedId)
            store.close()
        }
}
