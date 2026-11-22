package ch.orellbuehler.hauswart.feature.contactsync

import ch.orellbuehler.hauswart.api.generated.Contact
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PhoneContactPlannerTest {
    private fun contact(
        id: String,
        name: String,
        kind: String = "installer",
        company: String? = null,
        phone: String? = "+41 44 000 00 00",
        email: String? = null,
        url: String? = null,
        address: String? = null,
        notes: String? = null,
    ) = Contact(
        id = id,
        kind = kind,
        name = name,
        company = company,
        phone = phone,
        email = email,
        url = url,
        address = address,
        notes = notes,
        emergency = false,
        guestVisible = false,
        sortOrder = 0,
        externalSource = null,
        externalRef = null,
        createdAt = "2026-01-01T00:00:00.000Z",
        updatedAt = "2026-01-01T00:00:00.000Z",
    )

    private fun linkOf(
        contact: Contact,
        phoneId: String,
    ) = PhoneContactLink(contact.id, phoneId, phoneContactOf(contact, null).fingerprint)

    @Test
    fun namesAreMappedByCompanyAndKind() {
        data class Case(
            val contact: Contact,
            val given: String,
            val family: String,
            val organization: String,
        )
        val cases =
            listOf(
                Case(contact("c1", "Muster Heizungen AG"), "", "", "Muster Heizungen AG"),
                Case(contact("c2", "Hans Peter Muster", company = "Muster Heizungen AG"), "Hans Peter", "Muster", "Muster Heizungen AG"),
                Case(contact("c3", "Hans", company = "Muster AG"), "Hans", "", "Muster AG"),
                Case(contact("c4", "Muster AG", company = "Muster AG"), "", "", "Muster AG"),
                Case(contact("c5", "Berta Muster", kind = "neighbor"), "Berta", "Muster", ""),
                Case(contact("c6", "  Notruf Wasser ", kind = "emergency", company = " "), "", "", "Notruf Wasser"),
            )
        for (case in cases) {
            val mapped = phoneContactOf(case.contact, null)
            assertEquals(case.given, mapped.givenName, case.contact.id)
            assertEquals(case.family, mapped.familyName, case.contact.id)
            assertEquals(case.organization, mapped.organization, case.contact.id)
        }
    }

    @Test
    fun aChosenContactWithoutALinkIsCreated() {
        val plan = PhoneContactPlanner.plan(listOf(contact("c1", "Muster AG"), contact("c2", "Other AG")), setOf("c1"), emptyList(), null)
        assertEquals(listOf("c1"), plan.contacts.map { it.contactId })
        assertNull(plan.contacts.single().phoneId)
        assertTrue(plan.contacts.single().changed)
        assertEquals("+41 44 000 00 00", plan.contacts.single().phone)
        assertTrue(plan.remove.isEmpty())
        assertFalse(plan.removeList)
        assertFalse(plan.nothingToDo)
        assertEquals(PHONE_LIST_NAME, plan.listName)
    }

    @Test
    fun anUnchangedContactStaysInThePlanButIsNotRewritten() {
        val c = contact("c1", "Muster AG", email = "info@example.org")
        val plan = PhoneContactPlanner.plan(listOf(c), setOf("c1"), listOf(linkOf(c, "p1")), "g1")
        assertEquals("p1", plan.contacts.single().phoneId)
        assertFalse(plan.contacts.single().changed)
        assertEquals("g1", plan.listId)
    }

    @Test
    fun everyWrittenFieldChangesTheFingerprintAndNotesDoNot() {
        val base =
            contact(
                "c1",
                "Hans Muster",
                company = "Muster AG",
                email = "a@example.org",
                url = "https://example.org",
                address = "Musterweg 1",
            )
        val print = phoneContactOf(base, null).fingerprint
        val variants =
            listOf(
                base.copy(name = "Hans Meier"),
                base.copy(company = "Meier AG"),
                base.copy(phone = "+41 44 000 00 01"),
                base.copy(email = "b@example.org"),
                base.copy(url = "https://example.org/x"),
                base.copy(address = "Musterweg 2"),
            )
        for (variant in variants) assertNotEquals(print, phoneContactOf(variant, null).fingerprint)
        assertEquals(print, phoneContactOf(base.copy(notes = "ruft zurück", emergency = true), null).fingerprint)

        val plan = PhoneContactPlanner.plan(listOf(variants.first()), setOf("c1"), listOf(linkOf(base, "p1")), "g1")
        assertEquals("p1", plan.contacts.single().phoneId)
        assertTrue(plan.contacts.single().changed)
    }

    @Test
    fun unchosenAndDeletedContactsAreRemoved() {
        val kept = contact("c1", "Muster AG")
        val unchosen = contact("c2", "Other AG")
        val links = listOf(linkOf(kept, "p1"), linkOf(unchosen, "p2"), PhoneContactLink("gone", "p3", "x"))
        val plan = PhoneContactPlanner.plan(listOf(kept, unchosen), setOf("c1", "gone"), links, "g1")
        assertEquals(listOf("c1"), plan.contacts.map { it.contactId })
        assertEquals(listOf("p2", "p3"), plan.remove)
        assertFalse(plan.removeList)
    }

    @Test
    fun aContactThatLostPhoneAndEmailIsRemoved() {
        val before = contact("c1", "Muster AG")
        val after = before.copy(phone = " ", email = null)
        val plan = PhoneContactPlanner.plan(listOf(after), setOf("c1"), listOf(linkOf(before, "p1")), "g1")
        assertTrue(plan.contacts.isEmpty())
        assertEquals(listOf("p1"), plan.remove)
    }

    @Test
    fun theListGoesWithTheLastContact() {
        val c = contact("c1", "Muster AG")
        val plan = PhoneContactPlanner.plan(listOf(c), emptySet(), listOf(linkOf(c, "p1")), "g1")
        assertTrue(plan.removeList)
        assertEquals(listOf("p1"), plan.remove)

        val idle = PhoneContactPlanner.plan(listOf(c), emptySet(), emptyList(), null)
        assertTrue(idle.nothingToDo)
    }

    @Test
    fun aPhoneOrAnEmailIsNeeded() {
        assertTrue(canBeOnPhone("+41 44 000 00 00", null))
        assertTrue(canBeOnPhone(null, "a@example.org"))
        assertFalse(canBeOnPhone(null, null))
        assertFalse(canBeOnPhone(" ", ""))
    }
}
