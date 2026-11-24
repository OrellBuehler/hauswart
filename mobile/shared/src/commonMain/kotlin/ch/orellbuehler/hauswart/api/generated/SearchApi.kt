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

class SearchApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * Search pages, assets, rooms, tasks, defects, contacts, parts and care hints
     *
     * Full-text search, best match first; every word is matched as a prefix. Archived pages, assets, tasks and parts are not searched. Searched fields: titles and names, plus page text, device data and notes, descriptions, a defect's location, a contact's company and notes (never phone, e-mail or address), a part's number, supplier and notes, a hint's text. Pages are searched without their secret blocks, and every other free text is cut off at the first `:::` block when it mentions a secret, so a snippet never contains secret text. Snippets are plain text. `url` is the app path of the hit.
     *
     * @param type page | asset | room | task | defect | contact | part | asset_hint | insurance_policy | appointment | document
     */
    suspend fun search(
        q: String,
        type: String? = null,
        limit: Long? = null,
    ): SearchResponse =
        http.json("GET", "/api/v1/search", listOf("q" to q, "type" to type, "limit" to limit), SearchResponse.serializer())
}

@Serializable
data class SearchResponse(
    val items: List<SearchHit>,
)
