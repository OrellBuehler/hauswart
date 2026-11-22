package ch.orellbuehler.hauswart.feature.contacts

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.Patch
import ch.orellbuehler.hauswart.api.generated.Contact
import ch.orellbuehler.hauswart.api.generated.ContactDetail
import ch.orellbuehler.hauswart.api.generated.ContactsCreateRequest
import ch.orellbuehler.hauswart.api.generated.ContactsUpdateRequest
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.i18n.tr

val CONTACT_KINDS: List<String> = Contact.KIND_VALUES

fun contactKindLabel(kind: String): String = tr("contact_kind_$kind")

data class ContactGroup(
    val kind: String,
    val title: String,
    val contacts: List<Contact>,
)

data class ContactsListState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val query: String = "",
    val emergencyOnly: Boolean = false,
    /** Every contact that matches the filters, grouped by kind in the order of [CONTACT_KINDS]. */
    val groups: List<ContactGroup> = emptyList(),
    val total: Int = 0,
) {
    val filtered: Boolean get() = query.isNotBlank() || emergencyOnly

    /** How many contacts match the filters. */
    val shown: Int get() = groups.sumOf { it.contacts.size }
}

class ContactsListStore(
    private val app: HauswartApp,
) : Store<ContactsListState>(ContactsListState()) {
    private var all: List<Contact> = emptyList()

    init {
        onChange(app, "contacts") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun search(query: String) {
        update { it.copy(query = query) }
        show()
    }

    fun setEmergencyOnly(value: Boolean) {
        update { it.copy(emergencyOnly = value) }
        show()
    }

    private fun load() {
        update { it.copy(loading = all.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            all =
                fetchAll { cursor ->
                    val page = app.api.contacts.contactsList(cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            show()
            update { it.copy(loading = false) }
        }
    }

    private fun show() {
        val state = current
        val needle = state.query.trim().lowercase()
        val matching =
            all.filter { c ->
                (!state.emergencyOnly || c.emergency) &&
                    (needle.isEmpty() || listOfNotNull(c.name, c.company, c.notes).any { it.lowercase().contains(needle) })
            }
        val groups =
            CONTACT_KINDS.mapNotNull { kind ->
                val members = matching.filter { it.kind == kind }
                if (members.isEmpty()) null else ContactGroup(kind, tr("contact_group_$kind"), members)
            }
        update { it.copy(groups = groups, total = all.size) }
    }
}

data class ContactDetailState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val contact: ContactDetail? = null,
    val deleting: Boolean = false,
    /** A failed delete; the contact is still shown. */
    val actionError: UiError? = null,
    /** True once the contact is gone: the screen closes. */
    val deleted: Boolean = false,
)

class ContactDetailStore(
    private val app: HauswartApp,
    private val id: String,
) : Store<ContactDetailState>(ContactDetailState()) {
    init {
        onChange(app, "contacts") { if (!current.deleted) load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun delete() {
        if (current.deleting) return
        update { it.copy(deleting = true, actionError = null) }
        launch({ e -> update { it.copy(deleting = false, actionError = e) } }) {
            app.api.contacts.contactsDelete(id)
            update { it.copy(deleting = false, deleted = true) }
            app.changed("contacts")
        }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun load() {
        update { it.copy(loading = it.contact == null, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val contact = app.api.contacts.contactsGet(id)
            update { it.copy(loading = false, contact = contact) }
        }
    }
}

/** What the form holds: every field as the person typed it. */
data class ContactForm(
    val kind: String = "other",
    val name: String = "",
    val company: String = "",
    val phone: String = "",
    val email: String = "",
    val url: String = "",
    val address: String = "",
    val notes: String = "",
    val emergency: Boolean = false,
    val guestVisible: Boolean = false,
)

data class ContactEditState(
    val isNew: Boolean,
    /** Loading the contact to edit. The form is shown once [initial] is there. */
    val loading: Boolean,
    val loadError: UiError? = null,
    /** The values the form starts with; the screen keeps its own copy while the person types. */
    val initial: ContactForm? = null,
    val saving: Boolean = false,
    val error: UiError? = null,
    /** Messages per form field (`name`, `email`, `url`, ...), shown under the field. */
    val fieldErrors: Map<String, String> = emptyMap(),
    /** The id of the saved contact; the screen closes when it is set. */
    val savedId: String? = null,
)

/** Creates a contact ([id] null) or edits one. */
class ContactEditStore(
    private val app: HauswartApp,
    private val id: String?,
) : Store<ContactEditState>(
        ContactEditState(isNew = id == null, loading = id != null, initial = if (id == null) ContactForm() else null),
    ) {
    init {
        if (id != null) load(id)
    }

    fun retry() {
        if (id != null) load(id)
    }

    fun save(form: ContactForm) {
        if (current.saving) return
        if (form.name.isBlank()) {
            update { it.copy(fieldErrors = mapOf("name" to tr("m_field_required")), error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e -> update { it.copy(saving = false, error = if (e.fields.isEmpty()) e else null, fieldErrors = e.fields) } }) {
            val saved =
                if (id == null) {
                    app.api.contacts.contactsCreate(
                        ContactsCreateRequest(
                            kind = form.kind,
                            name = form.name.trim(),
                            company = form.company.trim().ifEmpty { null },
                            phone = form.phone.trim().ifEmpty { null },
                            email = form.email.trim().ifEmpty { null },
                            url = form.url.trim().ifEmpty { null },
                            address = form.address.trim().ifEmpty { null },
                            notes = form.notes.trim().ifEmpty { null },
                            emergency = form.emergency,
                            guestVisible = form.guestVisible,
                        ),
                    )
                } else {
                    app.api.contacts.contactsUpdate(
                        id,
                        ContactsUpdateRequest(
                            kind = form.kind,
                            name = form.name.trim(),
                            company = Patch.of(form.company.trim().ifEmpty { null }),
                            phone = Patch.of(form.phone.trim().ifEmpty { null }),
                            email = form.email.trim(),
                            url = form.url.trim(),
                            address = Patch.of(form.address.trim().ifEmpty { null }),
                            notes = Patch.of(form.notes.trim().ifEmpty { null }),
                            emergency = form.emergency,
                            guestVisible = form.guestVisible,
                        ),
                    )
                }
            app.changed("contacts")
            update { it.copy(saving = false, savedId = saved.id) }
        }
    }

    private fun load(contactId: String) {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val c = app.api.contacts.contactsGet(contactId)
            val form =
                ContactForm(
                    kind = c.kind,
                    name = c.name,
                    company = c.company ?: "",
                    phone = c.phone ?: "",
                    email = c.email ?: "",
                    url = c.url ?: "",
                    address = c.address ?: "",
                    notes = c.notes ?: "",
                    emergency = c.emergency,
                    guestVisible = c.guestVisible,
                )
            update { it.copy(loading = false, initial = form) }
        }
    }
}
