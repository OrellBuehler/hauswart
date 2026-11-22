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

class ServiceLogApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * Recent service log entries across all assets
     *
     * Newest first; filter by asset, kind or a date range.
     *
     * @param kind maintenance | repair | installation | inspection | replacement | other
     */
    suspend fun serviceLogList(
        cursor: String? = null,
        limit: Long? = null,
        assetId: String? = null,
        kind: String? = null,
        from: String? = null,
        to: String? = null,
    ): ServiceLogListResponse =
        http.json("GET", "/api/v1/service-log", listOf("cursor" to cursor, "limit" to limit, "assetId" to assetId, "kind" to kind, "from" to from, "to" to to), ServiceLogListResponse.serializer())

    /**
     * Service log of an asset, newest first
     *
     * @param kind maintenance | repair | installation | inspection | replacement | other
     */
    suspend fun assetServiceLogList(
        id: String,
        cursor: String? = null,
        limit: Long? = null,
        kind: String? = null,
    ): AssetServiceLogListResponse =
        http.json("GET", "/api/v1/assets/${ApiHttp.segment(id)}/service-log", listOf("cursor" to cursor, "limit" to limit, "kind" to kind), AssetServiceLogListResponse.serializer())

    /**
     * Add a service log entry
     *
     * resolvedNoteIds: notes of this asset (see /assets/{id}/notes) the work addressed. They become resolved with this entry; another asset's note or an unknown id is a 400 and nothing is written. A vehicle's odometer value is a reading of it: A reading below the one before its date or above the one after it is a 400 on the value field (`odometer` here) whose `details` carry `code` (`lower_than_previous` or `higher_than_next`), `field` and `reading` (`{value, date}` of the neighbouring reading in the way) besides the English field error; no such code for any other problem.
     */
    suspend fun assetServiceLogCreate(
        id: String,
        body: AssetServiceLogCreateRequest,
    ): ServiceLogEntry =
        http.json("POST", "/api/v1/assets/${ApiHttp.segment(id)}/service-log", emptyList(), AssetServiceLogCreateRequest.serializer(), body, ServiceLogEntry.serializer())

    /**
     * Get a service log entry
     */
    suspend fun assetServiceLogGet(
        id: String,
        entryId: String,
    ): ServiceLogEntry =
        http.json("GET", "/api/v1/assets/${ApiHttp.segment(id)}/service-log/${ApiHttp.segment(entryId)}", emptyList(), ServiceLogEntry.serializer())

    /**
     * Update a service log entry
     *
     * resolvedNoteIds adds notes of this asset to those the entry resolved (open ones become resolved with it, resolved ones stay as they are); it can be the only field. Notes are reopened by changing the note, deleting the entry or undoing the completion the entry was written with; a note that has become a defect stays resolved when the entry goes. A vehicle's odometer value is a reading of it: A reading below the one before its date or above the one after it is a 400 on the value field (`odometer` here) whose `details` carry `code` (`lower_than_previous` or `higher_than_next`), `field` and `reading` (`{value, date}` of the neighbouring reading in the way) besides the English field error; no such code for any other problem.
     */
    suspend fun assetServiceLogUpdate(
        id: String,
        entryId: String,
        body: AssetServiceLogUpdateRequest,
    ): ServiceLogEntry =
        http.json("PATCH", "/api/v1/assets/${ApiHttp.segment(id)}/service-log/${ApiHttp.segment(entryId)}", emptyList(), AssetServiceLogUpdateRequest.serializer(), body, ServiceLogEntry.serializer())

    /**
     * Delete a service log entry
     *
     * The notes the entry had resolved are open again, except a note that has become a defect meanwhile (it stays resolved); its attachments and comments go with it.
     */
    suspend fun assetServiceLogDelete(
        id: String,
        entryId: String,
    ) =
        http.empty("DELETE", "/api/v1/assets/${ApiHttp.segment(id)}/service-log/${ApiHttp.segment(entryId)}", emptyList())
}

@Serializable
data class ServiceLogListResponse(
    val items: List<ServiceLogEntry>,
    val nextCursor: String?,
)

@Serializable
data class AssetServiceLogListResponse(
    val items: List<ServiceLogEntry>,
    val nextCursor: String?,
)

@Serializable
data class AssetServiceLogCreateRequest(
    /** date */
    val date: String? = null,
    /** maintenance | repair | installation | inspection | replacement | other */
    val kind: String? = null,
    val title: String,
    val descriptionMd: String? = null,
    val contactId: String? = null,
    val costMinor: Long? = null,
    val currency: String? = null,
    val odometer: Double? = null,
    val performedBy: String? = null,
    val resolvedNoteIds: List<String>? = null,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("maintenance", "repair", "installation", "inspection", "replacement", "other")
    }
}

@Serializable
data class AssetServiceLogUpdateRequest(
    /** date */
    val date: String? = null,
    /** maintenance | repair | installation | inspection | replacement | other */
    val kind: String? = null,
    val title: String? = null,
    val descriptionMd: String? = null,
    val contactId: Patch<String> = Patch.Keep,
    val costMinor: Patch<Long> = Patch.Keep,
    val currency: Patch<String> = Patch.Keep,
    val odometer: Patch<Double> = Patch.Keep,
    val performedBy: Patch<String> = Patch.Keep,
    val resolvedNoteIds: List<String>? = null,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("maintenance", "repair", "installation", "inspection", "replacement", "other")
    }
}
