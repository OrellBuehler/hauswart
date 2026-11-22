package ch.orellbuehler.hauswart.feature.contactsync

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.Contact
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.i18n.tr

const val PHONE_ACCESS_UNKNOWN = "unknown"
const val PHONE_ACCESS_GRANTED = "granted"

/** The person lets the app see only some contacts; it can still write its own. */
const val PHONE_ACCESS_LIMITED = "limited"
const val PHONE_ACCESS_DENIED = "denied"
const val PHONE_ACCESS_UNDETERMINED = "undetermined"

data class PhoneContactChoice(
    val id: String,
    val name: String,
    /** The company, else the phone number or e-mail address; for a contact that cannot be written, why not. */
    val detail: String,
    val chosen: Boolean,
    /** False for a contact with neither phone number nor e-mail address. */
    val possible: Boolean,
)

data class PhoneContactsState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val choices: List<PhoneContactChoice> = emptyList(),
    val chosenCount: Int = 0,
    /** Contacts are chosen but the system blocks the address book: the person has to allow it in the system settings. */
    val accessBlocked: Boolean = false,
    /** The system lets the app write contacts but not keep them in a list. */
    val accessLimited: Boolean = false,
    /** Contacts were written but the phone's contacts account has no lists. */
    val listMissing: Boolean = false,
    /** The phone could not write the last time. */
    val writeFailed: Boolean = false,
)

/** The contacts of the household with a switch each: which ones this device keeps in the phone's address book. */
class PhoneContactsStore(
    private val app: HauswartApp,
) : Store<PhoneContactsState>(PhoneContactsState()) {
    private val prefs = PhoneContactPrefs(app.settings)
    private var all: List<Contact> = emptyList()
    private var access = PHONE_ACCESS_UNKNOWN

    init {
        onChange(app, "contacts") { load() }
        onChange(app, TOPIC_CONTACT_SYNC, TOPIC_CONTACT_SYNC_DONE) { show() }
        load()
    }

    fun refresh() {
        load()
    }

    /** The app reports what the system allows: one of the `PHONE_ACCESS_` values. */
    fun setAccess(value: String) {
        access = value
        show()
    }

    fun setChosen(
        id: String,
        value: Boolean,
    ) {
        prefs.setChosen(id, value)
        app.changed(TOPIC_CONTACT_SYNC)
    }

    /** Unchooses everything; the next sync takes the entries and the list off the phone. */
    fun chooseNone() {
        prefs.saveChosen(emptySet())
        app.changed(TOPIC_CONTACT_SYNC)
    }

    private fun load() {
        update { it.copy(loading = all.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            all =
                fetchAll { cursor ->
                    val page = app.api.contacts.contactsList(cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            update { it.copy(loading = false) }
            show()
        }
    }

    private fun show() {
        val chosen = prefs.chosen()
        val choices =
            all.sortedBy { it.name.lowercase() }.map { c ->
                val possible = canBeOnPhone(c.phone, c.email)
                PhoneContactChoice(
                    id = c.id,
                    name = c.name,
                    detail =
                        if (possible) {
                            listOfNotNull(c.company, c.phone, c.email).firstOrNull { it.isNotBlank() }.orEmpty()
                        } else {
                            tr("m_contact_sync_not_possible")
                        },
                    chosen = possible && c.id in chosen,
                    possible = possible,
                )
            }
        val count = choices.count { it.chosen }
        update {
            it.copy(
                choices = choices,
                chosenCount = count,
                accessBlocked = count > 0 && access == PHONE_ACCESS_DENIED,
                accessLimited = count > 0 && access == PHONE_ACCESS_LIMITED,
                listMissing = access == PHONE_ACCESS_GRANTED && prefs.links().isNotEmpty() && prefs.listId() == null,
                writeFailed = prefs.writeFailed(),
            )
        }
    }
}
