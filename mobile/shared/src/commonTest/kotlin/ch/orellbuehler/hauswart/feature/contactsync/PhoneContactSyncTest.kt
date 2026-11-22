package ch.orellbuehler.hauswart.feature.contactsync

import ch.orellbuehler.hauswart.feature.contacts.ContactDetailStore
import ch.orellbuehler.hauswart.feature.settings.settingsEntries
import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.platform.MemoryStore
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.seconds

class PhoneContactSyncTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app
    private val prefs = PhoneContactPrefs(server.settings)

    @BeforeTest
    fun german() {
        I18n.locale = "de"
    }

    @AfterTest
    fun tearDown() = server.close()

    private fun contact(
        id: String,
        name: String,
        phone: String? = "+41 44 000 00 00",
        company: String? = null,
    ): String =
        """{"id":"$id","kind":"installer","name":"$name","company":${company.json()},"phone":${phone.json()},"email":null,
            "url":null,"address":null,"notes":null,"emergency":false,"guestVisible":false,"sortOrder":0,
            "externalSource":null,"externalRef":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

    private fun String?.json(): String = if (this == null) "null" else "\"$this\""

    private fun contacts(vararg items: String) =
        server.on("GET", "/api/v1/contacts", """{"items":[${items.joinToString(",")}],"nextCursor":null}""")

    @Test
    fun prefsKeepTheChoiceTheLinksAndTheList() {
        assertTrue(prefs.chosen().isEmpty())
        assertTrue(prefs.links().isEmpty())
        assertNull(prefs.listId())
        assertFalse(prefs.writeFailed())

        prefs.setChosen("c1", true)
        prefs.setChosen("c2", true)
        prefs.setChosen("c1", false)
        prefs.saveLinks(listOf(PhoneContactLink("c2", "p2", "f")))
        prefs.saveListId("g1")
        prefs.saveWriteFailed(true)

        val again = PhoneContactPrefs(server.settings)
        assertEquals(setOf("c2"), again.chosen())
        assertEquals(listOf(PhoneContactLink("c2", "p2", "f")), again.links())
        assertEquals("g1", again.listId())
        assertTrue(again.writeFailed())

        again.saveListId(null)
        again.saveWriteFailed(false)
        assertNull(prefs.listId())
        assertFalse(prefs.writeFailed())
    }

    @Test
    fun prefsThatCannotBeReadAreEmpty() {
        val store = MemoryStore()
        store.save("contact_sync_chosen", "{nonsense")
        store.save("contact_sync_links", "[{\"contactId\":1}]")
        val broken = PhoneContactPrefs(store)
        assertTrue(broken.chosen().isEmpty())
        assertTrue(broken.links().isEmpty())
    }

    @Test
    fun nothingChosenMeansNoPlanAndNoRequest() =
        runTest {
            contacts(contact("c1", "Muster AG"))
            assertNull(PhoneContactSync(app).plan())
            assertTrue(server.requests.isEmpty())
        }

    @Test
    fun signedOutMeansNoPlan() =
        runTest {
            prefs.setChosen("c1", true)
            app.session.signOut()
            assertNull(PhoneContactSync(app).plan())
            assertTrue(server.requests.isEmpty())
            assertEquals(setOf("c1"), prefs.chosen())
        }

    @Test
    fun plansAppliesAndThenHasNothingToRewrite() =
        runTest {
            contacts(contact("c1", "Muster AG"), contact("c2", "Other AG"))
            prefs.setChosen("c1", true)
            val sync = PhoneContactSync(app)

            val first = assertNotNull(sync.plan())
            assertEquals(listOf("c1"), first.contacts.map { it.contactId })
            assertNull(first.contacts.single().phoneId)

            prefs.saveWriteFailed(true)
            sync.applied(first, mapOf("c1" to "p1"), "g1")
            assertEquals("g1", prefs.listId())
            assertFalse(prefs.writeFailed())

            val second = assertNotNull(sync.plan())
            assertEquals("p1", second.contacts.single().phoneId)
            assertFalse(second.contacts.single().changed)
            assertEquals("g1", second.listId)

            contacts(contact("c1", "Muster AG", phone = "+41 44 000 00 99"), contact("c2", "Other AG"))
            assertTrue(assertNotNull(sync.plan()).contacts.single().changed)
        }

    @Test
    fun anUnreachableServerLeavesThePhoneAlone() =
        runTest {
            contacts(contact("c1", "Muster AG"))
            prefs.setChosen("c1", true)
            prefs.saveLinks(listOf(PhoneContactLink("c1", "p1", "f")))
            val sync = PhoneContactSync(app)

            server.offline = true
            assertNull(sync.plan())
            assertNotNull(sync.lastError)
            assertEquals(setOf("c1"), prefs.chosen())
            assertEquals(1, prefs.links().size)

            server.offline = false
            assertNotNull(sync.plan())
            assertNull(sync.lastError)
        }

    @Test
    fun aContactDeletedOnTheServerLeavesTheChoiceAndThePhone() =
        runTest {
            contacts(contact("c2", "Other AG"))
            prefs.saveChosen(setOf("c1", "c2"))
            prefs.saveLinks(listOf(PhoneContactLink("c1", "p1", "f")))
            val sync = PhoneContactSync(app)

            val plan = assertNotNull(sync.plan())
            assertEquals(listOf("p1"), plan.remove)
            assertEquals(listOf("c2"), plan.contacts.map { it.contactId })
            assertEquals(setOf("c2"), prefs.chosen())

            sync.applied(plan, mapOf("c2" to "p2"), "g1")
            assertEquals(listOf("c2"), prefs.links().map { it.contactId })
        }

    @Test
    fun unchoosingEverythingTakesTheListAway() =
        runTest {
            contacts(contact("c1", "Muster AG"))
            prefs.saveLinks(listOf(PhoneContactLink("c1", "p1", "f")))
            prefs.saveListId("g1")
            val sync = PhoneContactSync(app)

            val plan = assertNotNull(sync.plan())
            assertTrue(plan.removeList)
            assertEquals(listOf("p1"), plan.remove)

            sync.applied(plan, emptyMap(), null)
            assertTrue(prefs.links().isEmpty())
            assertNull(prefs.listId())
            assertNull(sync.plan())
        }

    @Test
    fun aFailedWriteKeepsWhatIsStored() {
        prefs.saveLinks(listOf(PhoneContactLink("c1", "p1", "f")))
        PhoneContactSync(app).failed()
        assertTrue(prefs.writeFailed())
        assertEquals(1, prefs.links().size)
    }

    @Test
    fun watchPlansAgainAfterTheChoiceChanged() =
        runTest {
            contacts(contact("c1", "Muster AG"))
            val planned = CompletableDeferred<PhoneContactPlan>()
            val watching = PhoneContactSync(app).watch { planned.complete(it) }

            PhoneContactsStore(app).also { it.setChosen("c1", true) }.close()

            val plan = withContext(Dispatchers.Default) { withTimeout(60.seconds) { planned.await() } }
            assertEquals(listOf("c1"), plan.contacts.map { it.contactId })
            watching.cancel()
        }

    @Test
    fun theSettingsScreenListsTheContactsWithTheirSwitch() =
        runTest {
            contacts(
                contact("c2", "Zeta AG", company = "Zeta Holding"),
                contact("c1", "Muster AG"),
                contact("c3", "Ohne Nummer", phone = null),
            )
            prefs.saveChosen(setOf("c1", "c3"))
            val store = PhoneContactsStore(app)

            val state = store.await { !it.loading && it.choices.isNotEmpty() }
            assertEquals(listOf("Muster AG", "Ohne Nummer", "Zeta AG"), state.choices.map { it.name })
            assertEquals(listOf(true, false, false), state.choices.map { it.chosen })
            assertEquals(listOf(true, false, true), state.choices.map { it.possible })
            assertEquals("+41 44 000 00 00", state.choices[0].detail)
            assertEquals(tr("m_contact_sync_not_possible"), state.choices[1].detail)
            assertEquals("Zeta Holding", state.choices[2].detail)
            assertEquals(1, state.chosenCount)
            assertFalse(state.accessBlocked)

            store.setAccess(PHONE_ACCESS_DENIED)
            assertTrue(store.value.accessBlocked)
            store.setAccess(PHONE_ACCESS_LIMITED)
            assertTrue(store.value.accessLimited)
            assertFalse(store.value.accessBlocked)

            store.setAccess(PHONE_ACCESS_GRANTED)
            assertFalse(store.value.listMissing)
            PhoneContactSync(app).applied(PhoneContactPlanner.plan(emptyList(), emptySet(), emptyList(), null), emptyMap(), null)
            prefs.saveLinks(listOf(PhoneContactLink("c1", "p1", "f")))
            PhoneContactSync(app).failed()
            val after = store.await { it.writeFailed }
            assertTrue(after.listMissing)

            store.setChosen("c2", true)
            assertEquals(2, store.await { it.chosenCount == 2 }.chosenCount)
            store.chooseNone()
            assertEquals(0, store.await { it.chosenCount == 0 }.chosenCount)
            assertTrue(prefs.chosen().isEmpty())
            store.close()
        }

    @Test
    fun theContactPageHasTheSwitch() =
        runTest {
            server.on("GET", "/api/v1/contacts/c1", contact("c1", "Muster AG").dropLast(1) + ""","assets":[]}""")
            val store = ContactDetailStore(app, "c1")
            val loaded = store.await { it.contact != null && it.canBeOnPhone }
            assertFalse(loaded.onPhone)

            store.setOnPhone(true)
            assertTrue(store.await { it.onPhone }.onPhone)
            assertEquals(setOf("c1"), prefs.chosen())
            assertFalse(store.value.phoneAccessBlocked)

            store.setPhoneAccess(PHONE_ACCESS_DENIED)
            assertTrue(store.value.phoneAccessBlocked)

            store.setOnPhone(false)
            val off = store.await { !it.onPhone }
            assertFalse(off.phoneAccessBlocked)
            assertTrue(prefs.chosen().isEmpty())
            store.close()
        }

    @Test
    fun aContactWithoutPhoneAndEmailHasNoSwitch() =
        runTest {
            server.on("GET", "/api/v1/contacts/c1", contact("c1", "Muster AG", phone = null).dropLast(1) + ""","assets":[]}""")
            prefs.setChosen("c1", true)
            val store = ContactDetailStore(app, "c1")
            val loaded = store.await { it.contact != null }
            assertFalse(loaded.canBeOnPhone)
            assertFalse(loaded.onPhone)
            store.close()
        }

    @Test
    fun onlyTheIosSettingsListTheScreen() {
        assertTrue(settingsEntries("ios").any { it.id == "contact_sync" })
        assertFalse(settingsEntries("android").any { it.id == "contact_sync" })
    }
}
