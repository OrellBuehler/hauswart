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
     * @param ownerType asset | room | page | task | defect | service_log | part | asset_hint | contact | cost | insurance_policy | asset_note | tire_set | appointment | ai_task | task_step
     */
    suspend fun attachmentsList(
        cursor: String? = null,
        limit: Long? = null,
        ownerType: String,
        ownerId: String,
    ): AttachmentsListResponse =
        http.json("GET", "/api/v1/attachments", listOf("cursor" to cursor, "limit" to limit, "ownerType" to ownerType, "ownerId" to ownerId), AttachmentsListResponse.serializer())

    /**
     * Attach a file found on the web to an owner
     *
     * JSON `{ownerType, ownerId, url, caption?, guestVisible?}`. The server downloads the file at `url` and stores it exactly like an upload (`POST /attachments`): the same owners and the same scope rules (a page needs `docs:write`, a cost entry `costs:write`; the owner type `ai_task` is refused), the type is detected from the bytes (JPEG, PNG and WebP images are re-encoded and lose their metadata, PDFs are stored as they are; anything else is refused), at most 25 MiB, and the same `invalid_request` errors with `details.code` as an upload (`empty`, `unsupported_type`, `unsupported_heic`, `corrupt_image`, `image_too_large`). The owner is checked before anything is fetched. Because the server connects to an address it was given, only public ones are fetched: `http` or `https`, no user name or password, the standard ports (80 and 443), and a host that is, or resolves to, public internet addresses only (every address a name resolves to is checked; loopback, private networks, carrier-grade NAT, link-local, unique local, multicast, unspecified and reserved ranges, the cloud metadata endpoints and their IPv4-mapped and NAT64 spellings are refused). Redirects are followed by hand, at most 3, and each hop is checked the same way. One timeout of 15 seconds covers the whole download, which is read with a cap and stops at 25 MiB. The request carries `Accept` for images and PDFs and the user agent `hauswart/<version>` and nothing of the household. A download that fails is a 400 field error on `url` whose `details.code` is `blocked_host` (the address, or a redirect, is not a public one on a standard port), `unreachable` (the name does not resolve, the connection or TLS failed, or the time ran out), `upstream_status` (the server answered with an error; `details.status` is its status), `too_large` (more than 25 MiB) or `too_many_redirects`. The check cannot pin the address the connection is made to, so a name that changes its answer between the check and the connection (DNS rebinding) is not caught by it. Answers the attachment, as an upload does.
     */
    suspend fun attachmentsFromUrl(
        body: AttachmentsFromUrlRequest,
    ): Attachment =
        http.json("POST", "/api/v1/attachments/from-url", emptyList(), AttachmentsFromUrlRequest.serializer(), body, Attachment.serializer())

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
     * An attachment sized for an assistant to read
     *
     * The file as something that reads it takes it in, for any attachment (of a device, a page, a task, a receipt, ...). An image is sent as it is stored when its longest side is at most 1600 px and it is at most 1.5 MB, else scaled down and sent as JPEG (a very long, narrow image may keep up to 3200 px on its long side so that its text stays legible). A PDF without `pages` is sent as stored when it is at most 4 MiB, otherwise the answer is a 400 `invalid_request` with `details.code` `too_large` and `details.pageCount`, the number of its pages, so that a range can be asked for. With `pages` (`3` or `3-8`, counted from 1, at most 20 pages) the answer is a PDF of only those pages: a range that reaches past the end is a 400 on `pages` (`details.code` `out_of_range`, `details.pageCount`), `pages` for an image is a 400 on `pages` (`details.code` `not_a_pdf`). A PDF that cannot be opened (encrypted, damaged) is a 400 `details.code` `unreadable` when pages are asked for and when it is over 4 MiB; a smaller one is still sent whole. The header `X-Page-Count` carries the number of pages of the whole stored PDF (left out for images, and for a PDF that cannot be opened). Sent with `nosniff`, an `ETag` and `Cache-Control: private, no-cache` (a copy is kept but asked about every time: `If-None-Match` answers 304); use `GET /attachments/{id}/content` for the original file.
     */
    suspend fun attachmentsPreview(
        id: String,
        pages: String? = null,
    ): BinaryBody =
        http.binary("GET", "/api/v1/attachments/${ApiHttp.segment(id)}/preview", listOf("pages" to pages))

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
data class AttachmentsFromUrlRequest(
    /** asset | room | page | task | defect | service_log | part | asset_hint | contact | cost | insurance_policy | asset_note | tire_set | appointment | ai_task | task_step */
    val ownerType: String,
    val ownerId: String,
    val url: String,
    val caption: String? = null,
    val guestVisible: Boolean? = null,
) {
    companion object {
        val OWNER_TYPE_VALUES: List<String> = listOf("asset", "room", "page", "task", "defect", "service_log", "part", "asset_hint", "contact", "cost", "insurance_policy", "asset_note", "tire_set", "appointment", "ai_task", "task_step")
    }
}

@Serializable
data class AttachmentsUpdateRequest(
    val caption: Patch<String> = Patch.Keep,
    val guestVisible: Boolean? = null,
)
