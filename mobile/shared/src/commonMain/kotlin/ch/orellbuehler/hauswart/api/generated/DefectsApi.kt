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

class DefectsApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * List defects
     *
     * Defects that still need attention come first, by deadline (none last), then by number. Filter by status (or active=true for open, reported and in progress), severity, room, asset or a search text.
     *
     * @param status open | reported | in_progress | fixed | rejected
     *
     * @param severity low | medium | high
     */
    suspend fun defectsList(
        cursor: String? = null,
        limit: Long? = null,
        status: String? = null,
        active: Boolean? = null,
        severity: String? = null,
        roomId: String? = null,
        assetId: String? = null,
        q: String? = null,
    ): DefectsListResponse =
        http.json("GET", "/api/v1/defects", listOf("cursor" to cursor, "limit" to limit, "status" to status, "active" to active, "severity" to severity, "roomId" to roomId, "assetId" to assetId, "q" to q), DefectsListResponse.serializer())

    /**
     * Record a defect
     *
     * Without deadlineDate the deadline is the household's handover date plus its defect deadline months, when a handover date is set. A deadline creates a reminder task.
     */
    suspend fun defectsCreate(
        body: DefectsCreateRequest,
    ): Defect =
        http.json("POST", "/api/v1/defects", emptyList(), DefectsCreateRequest.serializer(), body, Defect.serializer())

    /**
     * Defect list as a PDF
     *
     * An A4 document: a table of the defects (filtered by status and room) and the history of each one. Language follows the caller's account.
     *
     * @param status open | reported | in_progress | fixed | rejected
     */
    suspend fun defectsExport(
        status: String? = null,
        roomId: String? = null,
    ): BinaryBody =
        http.binary("GET", "/api/v1/defects/export.pdf", listOf("status" to status, "roomId" to roomId))

    /**
     * Get a defect with its events
     */
    suspend fun defectsGet(
        id: String,
    ): DefectDetail =
        http.json("GET", "/api/v1/defects/${ApiHttp.segment(id)}", emptyList(), DefectDetail.serializer())

    /**
     * Update a defect
     *
     * The status has its own endpoint. Changing the deadline updates the reminder task.
     */
    suspend fun defectsUpdate(
        id: String,
        body: DefectsUpdateRequest,
    ): Defect =
        http.json("PATCH", "/api/v1/defects/${ApiHttp.segment(id)}", emptyList(), DefectsUpdateRequest.serializer(), body, Defect.serializer())

    /**
     * Delete a defect
     *
     * Events, comments and the reminder task go with it. Close a defect (fixed, rejected) to keep the history.
     */
    suspend fun defectsDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/defects/${ApiHttp.segment(id)}", emptyList())

    /**
     * Change the status of a defect
     *
     * From open, reported or in progress to any other status; fixed and rejected defects can only be reopened. Every change is written to the defect's events. Fixed and rejected archive the reminder task, reopening restores it.
     */
    suspend fun defectsStatus(
        id: String,
        body: DefectsStatusRequest,
    ): DefectDetail =
        http.json("POST", "/api/v1/defects/${ApiHttp.segment(id)}/status", emptyList(), DefectsStatusRequest.serializer(), body, DefectDetail.serializer())

    /**
     * Note correspondence on a defect
     *
     * Adds a correspondence entry (a letter sent or received) to the defect's history. Remarks use the generic comments endpoints.
     */
    suspend fun defectsAddEvent(
        id: String,
        body: DefectsAddEventRequest,
    ): DefectEvent =
        http.json("POST", "/api/v1/defects/${ApiHttp.segment(id)}/events", emptyList(), DefectsAddEventRequest.serializer(), body, DefectEvent.serializer())

    /**
     * Events and comments of a defect, oldest first
     */
    suspend fun defectsTimeline(
        id: String,
    ): DefectsTimelineResponse =
        http.json("GET", "/api/v1/defects/${ApiHttp.segment(id)}/timeline", emptyList(), DefectsTimelineResponse.serializer())
}

@Serializable
data class DefectsListResponse(
    val items: List<Defect>,
    val nextCursor: String?,
)

@Serializable
data class DefectsCreateRequest(
    val title: String,
    val descriptionMd: String? = null,
    /** low | medium | high */
    val severity: String? = null,
    val roomId: String? = null,
    val assetId: String? = null,
    val locationDetail: String? = null,
    /** date */
    val discoveredOn: String? = null,
    /** date */
    val reportedOn: String? = null,
    val responsibleContactId: String? = null,
    /** date */
    val deadlineDate: String? = null,
) {
    companion object {
        val SEVERITY_VALUES: List<String> = listOf("low", "medium", "high")
    }
}

@Serializable
data class DefectsUpdateRequest(
    val title: String? = null,
    val descriptionMd: String? = null,
    /** low | medium | high */
    val severity: String? = null,
    val roomId: Patch<String> = Patch.Keep,
    val assetId: Patch<String> = Patch.Keep,
    val locationDetail: Patch<String> = Patch.Keep,
    /** date */
    val discoveredOn: String? = null,
    /** date */
    val reportedOn: Patch<String> = Patch.Keep,
    val responsibleContactId: Patch<String> = Patch.Keep,
    /** date */
    val deadlineDate: Patch<String> = Patch.Keep,
    val deadlineSource: String? = null,
    /** date */
    val fixedOn: Patch<String> = Patch.Keep,
    val resolutionMd: String? = null,
) {
    companion object {
        val SEVERITY_VALUES: List<String> = listOf("low", "medium", "high")
    }
}

@Serializable
data class DefectsStatusRequest(
    /** open | reported | in_progress | fixed | rejected */
    val status: String,
    val note: String? = null,
    /** date */
    val reportedOn: String? = null,
    /** date */
    val fixedOn: String? = null,
) {
    companion object {
        val STATUS_VALUES: List<String> = listOf("open", "reported", "in_progress", "fixed", "rejected")
    }
}

@Serializable
data class DefectsAddEventRequest(
    @EncodeDefault val type: String = "correspondence",
    val bodyMd: String,
    val externalRef: String? = null,
)

@Serializable
data class DefectsTimelineResponse(
    val items: List<DefectTimelineItem>,
)
