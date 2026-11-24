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

class AssetNotesApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * Notes on an asset for the next appointment
     *
     * Small issues to mention at the next service appointment ("brakes squeak"), newest first. status: open (default), resolved or all.
     *
     * @param status open | resolved | all
     */
    suspend fun assetNotesList(
        id: String,
        cursor: String? = null,
        limit: Long? = null,
        status: String? = null,
    ): AssetNotesListResponse =
        http.json("GET", "/api/v1/assets/${ApiHttp.segment(id)}/notes", listOf("cursor" to cursor, "limit" to limit, "status" to status), AssetNotesListResponse.serializer())

    /**
     * Add a note to an asset
     *
     * A photo of the issue is an attachment of the owner type asset_note.
     */
    suspend fun assetNotesCreate(
        id: String,
        body: AssetNotesCreateRequest,
    ): AssetNote =
        http.json("POST", "/api/v1/assets/${ApiHttp.segment(id)}/notes", emptyList(), AssetNotesCreateRequest.serializer(), body, AssetNote.serializer())

    /**
     * Change the text of a note, resolve or reopen it
     *
     * status resolved records who resolved it and when; open reopens it and forgets the service log entry that had addressed it. A service log entry resolves notes itself (resolvedNoteIds).
     */
    suspend fun assetNotesUpdate(
        id: String,
        body: AssetNotesUpdateRequest,
    ): AssetNote =
        http.json("PATCH", "/api/v1/asset-notes/${ApiHttp.segment(id)}", emptyList(), AssetNotesUpdateRequest.serializer(), body, AssetNote.serializer())

    /**
     * Delete a note
     *
     * Its attachments go with it. Resolve a note to keep it.
     */
    suspend fun assetNotesDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/asset-notes/${ApiHttp.segment(id)}", emptyList())

    /**
     * Turn a note into a defect
     *
     * Creates a defect on the note's asset (title from the first line, description the whole text, discovered the day the note was written, no deadline) and marks the note resolved with a link to it, in one transaction. Answers with both. 409 when the note already is a defect.
     */
    suspend fun assetNotesToDefect(
        id: String,
    ): AssetNotesToDefectResponse =
        http.json("POST", "/api/v1/asset-notes/${ApiHttp.segment(id)}/to-defect", emptyList(), AssetNotesToDefectResponse.serializer())
}

@Serializable
data class AssetNotesListResponse(
    val items: List<AssetNote>,
    val nextCursor: String?,
)

@Serializable
data class AssetNotesCreateRequest(
    val body: String,
)

@Serializable
data class AssetNotesUpdateRequest(
    val body: String? = null,
    /** open | resolved */
    val status: String? = null,
) {
    companion object {
        val STATUS_VALUES: List<String> = listOf("open", "resolved")
    }
}

@Serializable
data class AssetNotesToDefectResponse(
    val note: AssetNote,
    val defect: Defect,
)
