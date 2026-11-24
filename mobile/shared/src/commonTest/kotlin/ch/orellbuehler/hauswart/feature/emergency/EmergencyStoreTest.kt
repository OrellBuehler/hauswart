package ch.orellbuehler.hauswart.feature.emergency

import ch.orellbuehler.hauswart.feature.inventory.contactJson
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class EmergencyStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private val full =
        """{"household":{"name":"Example Home"},
            "pages":[{"id":"p1","slug":"water-leak","title":"Water leak","section":"emergency","renderedHtml":"<p>Close the valve</p>","updatedAt":"2026-01-01T00:00:00.000Z"}],
            "contacts":[${contactJson(
            "c1",
            "Water Service",
        ).replace("\"phone\":null", "\"phone\":\"+41 00 000 00 00\"").replace("\"company\":null", "\"company\":\"Water Service\"")}],
            "assets":[{"id":"a1","name":"Main valve","roomName":"Cellar","pinnedHints":[{"id":"h1","title":"Turn clockwise","bodyMd":" Shut ","kind":"warning"}]},
                      {"id":"a2","name":"Fuse box","roomName":null,"pinnedHints":[]}],
            "insurance":[{"id":"i1","title":"Household","type":"household","insurerName":"Example Insurance","insurerPhone":"+41 11 111 11 11","policyNumber":"P-1","assistancePhone":"0800 000 000"}]}"""

    @Test
    fun theEmergencyPageIsPreparedForTheScreens() =
        runTest {
            server.on("GET", "/api/v1/emergency", full)
            val store = EmergencyStore(app)
            val state = store.await { !it.loading }
            assertEquals(tr("emergency_description", "name" to "Example Home"), state.description)
            assertEquals("", state.contacts.single().company, "a company equal to the name is left out")
            assertEquals("+41 00 000 00 00", state.contacts.single().phone)
            val policy = state.insurance.single()
            assertEquals("0800 000 000", policy.assistancePhone)
            assertTrue(
                tr("insurance_type_household") in policy.subtitle && tr("emergency_insurance_number", "number" to "P-1") in policy.subtitle,
            )
            assertEquals(tr("emergency_room", "room" to "Cellar"), state.assets[0].room)
            assertEquals("", state.assets[1].room)
            val hint = state.assets[0].hints.single()
            assertEquals("Shut", hint.body)
            assertEquals(tr("hint_kind_warning"), hint.kindLabel)
            assertEquals("water-leak", state.pages.single().slug)
            assertEquals(false, state.empty)
            store.close()
        }

    @Test
    fun anEmptyPageSaysSo() =
        runTest {
            server.on("GET", "/api/v1/emergency", """{"household":{"name":"H"},"pages":[],"contacts":[],"assets":[],"insurance":[]}""")
            val store = EmergencyStore(app)
            assertTrue(store.await { !it.loading }.empty)
            store.close()
        }

    @Test
    fun theSheetAsksForSecretsOnlyWhenToldTo() =
        runTest {
            server.on("GET", "/api/v1/emergency", full)
            server.on("GET", "/api/v1/emergency/export.pdf", "%PDF")
            val store = EmergencyStore(app)
            store.await { !it.loading }
            store.exportSheet()
            val sheet = store.await { it.sheet != null }.sheet!!
            assertEquals("application/pdf", sheet.file.mime)
            assertTrue(sheet.file.name.endsWith(".pdf"))
            assertEquals("", server.requestsTo("GET", "/api/v1/emergency/export.pdf").single().query)
            store.clearSheet()
            store.setIncludeSecrets(true)
            store.exportSheet()
            store.await { it.sheet != null }
            assertTrue("includeSecrets=1" in server.requestsTo("GET", "/api/v1/emergency/export.pdf").last().query)
            store.close()
        }

    @Test
    fun aFailedExportKeepsThePage() =
        runTest {
            server.on("GET", "/api/v1/emergency", full)
            server.onError("GET", "/api/v1/emergency/export.pdf", HttpStatusCode.InternalServerError, "internal_error")
            val store = EmergencyStore(app)
            store.await { !it.loading }
            store.exportSheet()
            val state = store.await { it.exportError != null }
            assertEquals(1, state.contacts.size)
            store.close()
        }
}
