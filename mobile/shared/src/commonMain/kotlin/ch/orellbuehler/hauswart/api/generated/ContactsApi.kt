// Generated from docs/openapi.json by `bun run mobile:api`. Do not edit.
@file:OptIn(ExperimentalSerializationApi::class)

package ch.orellbuehler.hauswart.api.generated

import ch.orellbuehler.hauswart.api.ApiHttp
import ch.orellbuehler.hauswart.api.BinaryBody
import ch.orellbuehler.hauswart.api.Patch
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

class ContactsApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * List contacts
     *
     * Filter by kind, emergency flag or a search text over name, company, e-mail and phone. Sorted by sort order, then name.
     *
     * @param kind installer | property_mgmt | manufacturer_support | emergency | utility | insurance | neighbor | seller | other
     */
    suspend fun contactsList(
        cursor: String? = null,
        limit: Long? = null,
        kind: String? = null,
        emergency: Boolean? = null,
        q: String? = null,
    ): ContactsListResponse =
        http.json("GET", "/api/v1/contacts", listOf("cursor" to cursor, "limit" to limit, "kind" to kind, "emergency" to emergency, "q" to q), ContactsListResponse.serializer())

    /**
     * Create a contact
     *
     * externalSource and externalRef link the contact to a record in another system; the pair is unique.
     */
    suspend fun contactsCreate(
        body: ContactsCreateRequest,
    ): Contact =
        http.json("POST", "/api/v1/contacts", emptyList(), ContactsCreateRequest.serializer(), body, Contact.serializer())

    /**
     * Get a contact with the assets it is linked to
     */
    suspend fun contactsGet(
        id: String,
    ): ContactDetail =
        http.json("GET", "/api/v1/contacts/${ApiHttp.segment(id)}", emptyList(), ContactDetail.serializer())

    /**
     * Update a contact
     */
    suspend fun contactsUpdate(
        id: String,
        body: ContactsUpdateRequest,
    ): Contact =
        http.json("PATCH", "/api/v1/contacts/${ApiHttp.segment(id)}", emptyList(), ContactsUpdateRequest.serializer(), body, Contact.serializer())

    /**
     * Delete a contact
     *
     * Links to assets are removed; service log entries and defects that named the contact keep their text and lose the link.
     */
    suspend fun contactsDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/contacts/${ApiHttp.segment(id)}", emptyList())

    /**
     * Contacts linked to an asset
     */
    suspend fun assetContactsList(
        id: String,
        cursor: String? = null,
        limit: Long? = null,
    ): AssetContactsListResponse =
        http.json("GET", "/api/v1/assets/${ApiHttp.segment(id)}/contacts", listOf("cursor" to cursor, "limit" to limit), AssetContactsListResponse.serializer())

    /**
     * Link a contact to an asset
     *
     * A contact can be linked to an asset once per role; repeating it is a conflict.
     */
    suspend fun assetContactsLink(
        id: String,
        body: AssetContactsLinkRequest,
    ): AssetContact =
        http.json("POST", "/api/v1/assets/${ApiHttp.segment(id)}/contacts", emptyList(), AssetContactsLinkRequest.serializer(), body, AssetContact.serializer())

    /**
     * Unlink a contact from an asset
     */
    suspend fun assetContactsUnlink(
        id: String,
        linkId: String,
    ) =
        http.empty("DELETE", "/api/v1/assets/${ApiHttp.segment(id)}/contacts/${ApiHttp.segment(linkId)}", emptyList())
}

@Serializable
data class ContactsListResponse(
    val items: List<Contact>,
    val nextCursor: String?,
)

@Serializable
data class ContactsCreateRequest(
    /** installer | property_mgmt | manufacturer_support | emergency | utility | insurance | neighbor | seller | other */
    val kind: String? = null,
    val name: String,
    val company: String? = null,
    val phone: String? = null,
    val email: String? = null,
    val url: String? = null,
    val address: String? = null,
    val notes: String? = null,
    val emergency: Boolean? = null,
    val guestVisible: Boolean? = null,
    val sortOrder: Long? = null,
    val externalSource: String? = null,
    val externalRef: String? = null,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("installer", "property_mgmt", "manufacturer_support", "emergency", "utility", "insurance", "neighbor", "seller", "other")
    }
}

@Serializable
data class ContactsUpdateRequest(
    /** installer | property_mgmt | manufacturer_support | emergency | utility | insurance | neighbor | seller | other */
    val kind: String? = null,
    val name: String? = null,
    val company: Patch<String> = Patch.Keep,
    val phone: Patch<String> = Patch.Keep,
    val email: String? = null,
    val url: String? = null,
    val address: Patch<String> = Patch.Keep,
    val notes: Patch<String> = Patch.Keep,
    val emergency: Boolean? = null,
    val guestVisible: Boolean? = null,
    val sortOrder: Long? = null,
    val externalSource: Patch<String> = Patch.Keep,
    val externalRef: Patch<String> = Patch.Keep,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("installer", "property_mgmt", "manufacturer_support", "emergency", "utility", "insurance", "neighbor", "seller", "other")
    }
}

@Serializable
data class AssetContactsListResponse(
    val items: List<AssetContact>,
    val nextCursor: String?,
)

@Serializable
data class AssetContactsLinkRequest(
    val contactId: String,
    /** support | installer | seller | service | other */
    val role: String? = null,
) {
    companion object {
        val ROLE_VALUES: List<String> = listOf("support", "installer", "seller", "service", "other")
    }
}
