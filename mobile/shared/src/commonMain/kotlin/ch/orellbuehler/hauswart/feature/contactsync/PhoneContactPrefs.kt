package ch.orellbuehler.hauswart.feature.contactsync

import ch.orellbuehler.hauswart.platform.KeyValueStore
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

@Serializable
private data class StoredLink(
    val contactId: String,
    val phoneId: String,
    val fingerprint: String,
)

/**
 * Which contacts this device keeps in the phone's address book, and what it wrote there. Plain
 * storage of the device: the choice is the person's own and never reaches the server.
 */
class PhoneContactPrefs(
    private val store: KeyValueStore,
) {
    private val json = Json { ignoreUnknownKeys = true }

    /** The ids of the chosen contacts; empty when there are none or they cannot be read. */
    fun chosen(): Set<String> {
        val text = store.load(CHOSEN) ?: return emptySet()
        return runCatching { json.decodeFromString(ListSerializer(String.serializer()), text) }.getOrNull()?.toSet() ?: emptySet()
    }

    fun saveChosen(ids: Set<String>) {
        store.save(CHOSEN, json.encodeToString(ListSerializer(String.serializer()), ids.toList()))
    }

    fun setChosen(
        id: String,
        value: Boolean,
    ) {
        saveChosen(if (value) chosen() + id else chosen() - id)
    }

    fun links(): List<PhoneContactLink> {
        val text = store.load(LINKS) ?: return emptyList()
        val items = runCatching { json.decodeFromString(ListSerializer(StoredLink.serializer()), text) }.getOrNull() ?: return emptyList()
        return items.map { PhoneContactLink(it.contactId, it.phoneId, it.fingerprint) }
    }

    fun saveLinks(links: List<PhoneContactLink>) {
        val items = links.map { StoredLink(it.contactId, it.phoneId, it.fingerprint) }
        store.save(LINKS, json.encodeToString(ListSerializer(StoredLink.serializer()), items))
    }

    fun listId(): String? = store.load(LIST)

    fun saveListId(id: String?) {
        if (id == null) store.delete(LIST) else store.save(LIST, id)
    }

    /** True when the phone could not write the last plan. */
    fun writeFailed(): Boolean = store.load(FAILED) == "1"

    fun saveWriteFailed(value: Boolean) {
        if (value) store.save(FAILED, "1") else store.delete(FAILED)
    }

    private companion object {
        const val CHOSEN = "contact_sync_chosen"
        const val LINKS = "contact_sync_links"
        const val LIST = "contact_sync_list"
        const val FAILED = "contact_sync_failed"
    }
}
