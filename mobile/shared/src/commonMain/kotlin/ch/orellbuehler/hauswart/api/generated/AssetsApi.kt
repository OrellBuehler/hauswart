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

class AssetsApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * List assets (devices, plants, fixtures)
     *
     * Filter by kind, room or a search text (name, manufacturer, model, category, species and, for a vehicle, its plate: case, spaces, dots and dashes do not matter, so `zh 000.000` finds `ZH 000000`). Archived assets are left out unless includeArchived=true.
     *
     * @param kind device | plant | fixture | vehicle | other
     */
    suspend fun assetsList(
        cursor: String? = null,
        limit: Long? = null,
        kind: String? = null,
        roomId: String? = null,
        q: String? = null,
        includeArchived: Boolean? = null,
    ): AssetsListResponse =
        http.json("GET", "/api/v1/assets", listOf("cursor" to cursor, "limit" to limit, "kind" to kind, "roomId" to roomId, "q" to q, "includeArchived" to includeArchived), AssetsListResponse.serializer())

    /**
     * Create an asset
     *
     * Gets a random qrSlug for QR deep links. The slug is derived from the name unless given.
     */
    suspend fun assetsCreate(
        body: AssetsCreateRequest,
    ): Asset =
        http.json("POST", "/api/v1/assets", emptyList(), AssetsCreateRequest.serializer(), body, Asset.serializer())

    /**
     * Look up an asset by its QR slug
     */
    suspend fun assetsByQr(
        qrSlug: String,
    ): Asset =
        http.json("GET", "/api/v1/assets/by-qr/${ApiHttp.segment(qrSlug)}", emptyList(), Asset.serializer())

    /**
     * Get an asset
     */
    suspend fun assetsGet(
        id: String,
    ): Asset =
        http.json("GET", "/api/v1/assets/${ApiHttp.segment(id)}", emptyList(), Asset.serializer())

    /**
     * Update or archive an asset
     *
     * Set archived to true to archive, false to restore. A vehicle that holds saved details, odometer readings or tire sets cannot change its kind: 400 with a field error on `kind` until they are removed (details saved with nothing in them do not count).
     */
    suspend fun assetsUpdate(
        id: String,
        body: AssetsUpdateRequest,
    ): Asset =
        http.json("PATCH", "/api/v1/assets/${ApiHttp.segment(id)}", emptyList(), AssetsUpdateRequest.serializer(), body, Asset.serializer())

    /**
     * Delete an asset
     *
     * Tasks of the asset stay and lose the link. Archive instead to keep it.
     */
    suspend fun assetsDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/assets/${ApiHttp.segment(id)}", emptyList())
}

@Serializable
data class AssetsListResponse(
    val items: List<Asset>,
    val nextCursor: String?,
)

@Serializable
data class AssetsCreateRequest(
    /** device | plant | fixture | vehicle | other */
    val kind: String? = null,
    val name: String,
    val slug: String? = null,
    val roomId: String? = null,
    val category: String? = null,
    val manufacturer: String? = null,
    val model: String? = null,
    val serialNumber: String? = null,
    /** date */
    val purchaseDate: String? = null,
    /** date */
    val installedDate: String? = null,
    /** date */
    val warrantyUntil: String? = null,
    /** date */
    val warrantyExtendedUntil: String? = null,
    val showOnEmergency: Boolean? = null,
    val notes: String? = null,
    val species: String? = null,
    val light: String? = null,
    val waterNotes: String? = null,
    val photoAttachmentId: String? = null,
    val externalSource: String? = null,
    val externalRef: String? = null,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("device", "plant", "fixture", "vehicle", "other")
    }
}

@Serializable
data class AssetsUpdateRequest(
    /** device | plant | fixture | vehicle | other */
    val kind: String? = null,
    val name: String? = null,
    val slug: String? = null,
    val roomId: Patch<String> = Patch.Keep,
    val category: Patch<String> = Patch.Keep,
    val manufacturer: Patch<String> = Patch.Keep,
    val model: Patch<String> = Patch.Keep,
    val serialNumber: Patch<String> = Patch.Keep,
    /** date */
    val purchaseDate: Patch<String> = Patch.Keep,
    /** date */
    val installedDate: Patch<String> = Patch.Keep,
    /** date */
    val warrantyUntil: Patch<String> = Patch.Keep,
    /** date */
    val warrantyExtendedUntil: Patch<String> = Patch.Keep,
    val showOnEmergency: Boolean? = null,
    val notes: Patch<String> = Patch.Keep,
    val species: Patch<String> = Patch.Keep,
    val light: Patch<String> = Patch.Keep,
    val waterNotes: Patch<String> = Patch.Keep,
    val photoAttachmentId: Patch<String> = Patch.Keep,
    val externalSource: Patch<String> = Patch.Keep,
    val externalRef: Patch<String> = Patch.Keep,
    val archived: Boolean? = null,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("device", "plant", "fixture", "vehicle", "other")
    }
}
