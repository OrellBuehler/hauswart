package ch.orellbuehler.hauswart.feature.contactsync

import ch.orellbuehler.hauswart.api.generated.Contact

/** The name of the list in the phone's contacts that holds what hauswart wrote. */
const val PHONE_LIST_NAME = "hauswart"

/**
 * A contact as the phone's address book gets it. [phoneId] is the phone's id of the entry written
 * earlier, null when there is none yet; [changed] says that the entry differs from what was written.
 * The phone creates the entry when [phoneId] is null or no longer exists there, and rewrites it
 * when [changed].
 */
data class PhoneContact(
    val contactId: String,
    val phoneId: String?,
    val changed: Boolean,
    val givenName: String,
    val familyName: String,
    val organization: String,
    val phone: String,
    val email: String,
    val url: String,
    val address: String,
    val fingerprint: String,
)

/** Which entry of the phone belongs to which contact, and what was written into it. */
data class PhoneContactLink(
    val contactId: String,
    val phoneId: String,
    val fingerprint: String,
)

/** What the phone's address book has to hold after a sync. */
data class PhoneContactPlan(
    /** Every chosen contact, changed or not. */
    val contacts: List<PhoneContact>,
    /** Phone ids of entries to delete: no longer chosen, or gone from the server. */
    val remove: List<String>,
    /** The phone's id of the list, null when none was made yet. */
    val listId: String?,
    val listName: String,
    /** Nothing is chosen any more: the list goes too. */
    val removeList: Boolean,
) {
    val nothingToDo: Boolean get() = contacts.isEmpty() && remove.isEmpty() && !removeList
}

/** A phone entry needs a way to reach the contact; a name alone is not written. */
fun canBeOnPhone(
    phone: String?,
    email: String?,
): Boolean = !phone.isNullOrBlank() || !email.isNullOrBlank()

object PhoneContactPlanner {
    fun plan(
        contacts: List<Contact>,
        chosen: Set<String>,
        links: List<PhoneContactLink>,
        listId: String?,
    ): PhoneContactPlan {
        val linked = links.associateBy { it.contactId }
        val wanted =
            contacts
                .filter { it.id in chosen && canBeOnPhone(it.phone, it.email) }
                .map { phoneContactOf(it, linked[it.id]) }
        val kept = wanted.map { it.contactId }.toSet()
        return PhoneContactPlan(
            contacts = wanted,
            remove = links.filter { it.contactId !in kept }.map { it.phoneId },
            listId = listId,
            listName = PHONE_LIST_NAME,
            removeList = wanted.isEmpty() && listId != null,
        )
    }
}

/**
 * hauswart has one name field. With a company, or for a neighbour, it is a person's name and is split
 * at the last space; otherwise it is written as the organisation, so that it shows and sorts as typed.
 */
internal fun phoneContactOf(
    contact: Contact,
    link: PhoneContactLink?,
): PhoneContact {
    val name = contact.name.trim()
    val company = contact.company?.trim().orEmpty()
    val person = (company.isNotEmpty() && company != name) || contact.kind == "neighbor"
    val cut = name.lastIndexOf(' ')
    val given =
        if (!person) {
            ""
        } else if (cut < 0) {
            name
        } else {
            name.substring(0, cut).trim()
        }
    val family = if (!person || cut < 0) "" else name.substring(cut + 1)
    val organization = if (person) company else name
    val phone = contact.phone?.trim().orEmpty()
    val email = contact.email?.trim().orEmpty()
    val url = contact.url?.trim().orEmpty()
    val address = contact.address?.trim().orEmpty()
    val fingerprint = fingerprintOf(listOf(FORMAT, given, family, organization, phone, email, url, address))
    return PhoneContact(
        contactId = contact.id,
        phoneId = link?.phoneId,
        changed = link?.fingerprint != fingerprint,
        givenName = given,
        familyName = family,
        organization = organization,
        phone = phone,
        email = email,
        url = url,
        address = address,
        fingerprint = fingerprint,
    )
}

/** Raise when the mapping changes, so that every entry is written again. */
private const val FORMAT = "1"

/** FNV-1a over the written fields: the same on every platform, and no contact data in the settings. */
private fun fingerprintOf(parts: List<String>): String {
    var hash = 0xcbf29ce484222325uL
    for (b in parts.joinToString("\u001F").encodeToByteArray()) {
        hash = (hash xor (b.toULong() and 0xFFuL)) * 0x100000001b3uL
    }
    return hash.toString(16)
}
