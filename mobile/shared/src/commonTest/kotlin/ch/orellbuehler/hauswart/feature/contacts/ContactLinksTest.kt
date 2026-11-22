package ch.orellbuehler.hauswart.feature.contacts

import kotlin.test.Test
import kotlin.test.assertEquals

class ContactLinksTest {
    @Test
    fun aPhoneNumberKeepsOnlyWhatTheDialerNeeds() {
        assertEquals("tel:+41000000000", telUri("+41 (0)00 000 00 00".replace("(0)", "")))
        assertEquals("tel:0000000000", telUri("000 / 000 00 00"))
    }

    @Test
    fun anAddressBecomesAMapSearch() {
        assertEquals("geo:0,0?q=Example%20Street%201%2C8000%20Zurich", mapUri("Example Street 1\n8000 Zurich"))
        assertEquals("geo:0,0?q=Caf%C3%A9", mapUri("Café"))
    }

    @Test
    fun anEmailAddressIsTrimmed() {
        assertEquals("mailto:anna@example.org", mailUri(" anna@example.org "))
    }
}
