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

class AttachmentsApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * List the attachments of an owner
     *
     * Oldest first.
     *
     * @param ownerType asset | room | page | task | defect | service_log | part | asset_hint | contact | cost | insurance_policy | asset_note | tire_set | appointment | ai_task
     */
    suspend fun attachmentsList(
        cursor: String? = null,
        limit: Long? = null,
        ownerType: String,
        ownerId: String,
    ): AttachmentsListResponse =
        http.json("GET", "/api/v1/attachments", listOf("cursor" to cursor, "limit" to limit, "ownerType" to ownerType, "ownerId" to ownerId), AttachmentsListResponse.serializer())

    /**
     * Attachment metadata
     */
    suspend fun attachmentsGet(
        id: String,
    ): Attachment =
        http.json("GET", "/api/v1/attachments/${ApiHttp.segment(id)}", emptyList(), Attachment.serializer())

    /**
     * Change the caption or the guest visibility
     *
     * Pages that embed the attachment are rendered again. Needs `docs:write` when the owner is a page.
     */
    suspend fun attachmentsUpdate(
        id: String,
        body: AttachmentsUpdateRequest,
    ): Attachment =
        http.json("PATCH", "/api/v1/attachments/${ApiHttp.segment(id)}", emptyList(), AttachmentsUpdateRequest.serializer(), body, Attachment.serializer())

    /**
     * Delete an attachment
     *
     * Removes the row and, when nothing else uses the stored file, the file (a file stored less than a minute ago is kept until the next cleanup). An asset photo pointing at it is cleared. Pages that embed it are rendered again. Needs `docs:write` when the owner is a page. The file of an open task of the receipt queue (owner type `ai_task`) is a 409 `conflict`: delete the task instead.
     */
    suspend fun attachmentsDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/attachments/${ApiHttp.segment(id)}", emptyList())

    /**
     * The file itself
     *
     * Streams the stored bytes with their detected content type: images and PDFs inline, `?download=1` as a download. Sent with `nosniff`, a restrictive CSP, an ETag (`If-None-Match` answers 304) and `Cache-Control: private, max-age=31536000, immutable`. Works for `<img src>` with the session cookie.
     *
     * @param download 0 | 1 | true | false
     */
    suspend fun attachmentsContent(
        id: String,
        download: String? = null,
    ): BinaryBody =
        http.binary("GET", "/api/v1/attachments/${ApiHttp.segment(id)}/content", listOf("download" to download))

    /**
     * Thumbnail of an image attachment
     *
     * 480 px WebP; 404 for attachments without a thumbnail (PDFs). Same headers as the content endpoint.
     */
    suspend fun attachmentsThumb(
        id: String,
    ): BinaryBody =
        http.binary("GET", "/api/v1/attachments/${ApiHttp.segment(id)}/thumb", emptyList())
}

@Serializable
data class AttachmentsListResponse(
    val items: List<Attachment>,
    val nextCursor: String?,
)

@Serializable
data class AttachmentsUpdateRequest(
    val caption: Patch<String> = Patch.Keep,
    val guestVisible: Boolean? = null,
)
