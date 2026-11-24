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

class HintsApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * Care hints of an asset
     *
     * Pinned hints first, then by sort order and creation time.
     */
    suspend fun assetHintsList(
        id: String,
        cursor: String? = null,
        limit: Long? = null,
    ): AssetHintsListResponse =
        http.json("GET", "/api/v1/assets/${ApiHttp.segment(id)}/hints", listOf("cursor" to cursor, "limit" to limit), AssetHintsListResponse.serializer())

    /**
     * Add a care hint to an asset
     *
     * A hint is a tip, rule or warning for using or caring for the device. It may link a recurring task and carry a signal reaction (stored; an adapter carries it out). Without sortOrder it goes to the end.
     */
    suspend fun assetHintsCreate(
        id: String,
        body: AssetHintsCreateRequest,
    ): Hint =
        http.json("POST", "/api/v1/assets/${ApiHttp.segment(id)}/hints", emptyList(), AssetHintsCreateRequest.serializer(), body, Hint.serializer())

    /**
     * List care hints across assets
     *
     * Filter by asset, kind or reactive=true (hints with a signal reaction). Archived assets' hints are left out.
     *
     * @param kind tip | rule | warning
     */
    suspend fun hintsList(
        cursor: String? = null,
        limit: Long? = null,
        assetId: String? = null,
        reactive: Boolean? = null,
        kind: String? = null,
    ): HintsListResponse =
        http.json("GET", "/api/v1/hints", listOf("cursor" to cursor, "limit" to limit, "assetId" to assetId, "reactive" to reactive, "kind" to kind), HintsListResponse.serializer())

    /**
     * Get a care hint
     */
    suspend fun hintsGet(
        id: String,
    ): Hint =
        http.json("GET", "/api/v1/hints/${ApiHttp.segment(id)}", emptyList(), Hint.serializer())

    /**
     * Update a care hint
     *
     * Reorder by changing sortOrder; pin with pinned.
     */
    suspend fun hintsUpdate(
        id: String,
        body: HintsUpdateRequest,
    ): Hint =
        http.json("PATCH", "/api/v1/hints/${ApiHttp.segment(id)}", emptyList(), HintsUpdateRequest.serializer(), body, Hint.serializer())

    /**
     * Delete a care hint
     *
     * Its comments go with it; a linked task stays.
     */
    suspend fun hintsDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/hints/${ApiHttp.segment(id)}", emptyList())
}

@Serializable
data class AssetHintsListResponse(
    val items: List<Hint>,
    val nextCursor: String?,
)

@Serializable
data class AssetHintsCreateRequest(
    val title: String,
    val bodyMd: String? = null,
    /** tip | rule | warning */
    val kind: String? = null,
    val pinned: Boolean? = null,
    val sortOrder: Long? = null,
    val guestVisible: Boolean? = null,
    val taskId: String? = null,
    val reaction: SignalReaction? = null,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("tip", "rule", "warning")
    }
}

@Serializable
data class HintsListResponse(
    val items: List<Hint>,
    val nextCursor: String?,
)

@Serializable
data class HintsUpdateRequest(
    val title: String? = null,
    val bodyMd: String? = null,
    /** tip | rule | warning */
    val kind: String? = null,
    val pinned: Boolean? = null,
    val sortOrder: Long? = null,
    val guestVisible: Boolean? = null,
    val taskId: Patch<String> = Patch.Keep,
    val reaction: Patch<SignalReaction> = Patch.Keep,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("tip", "rule", "warning")
    }
}
