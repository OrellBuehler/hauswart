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

class DocumentsApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * Documents of the caller's document system
     *
     * Read through the caller's own connection, so everybody sees what their own account may see. With `q` the title and text are searched live in the provider (at most 100 hits); without it the synced household documents are listed (tag, correspondent and linked filters apply to both). Every item says where hauswart uses it (`linkedTo`). 404 without a connection; 502 `upstream_error` when the system does not answer.
     */
    suspend fun documentsList(
        cursor: String? = null,
        limit: Long? = null,
        q: String? = null,
        tag: Long? = null,
        correspondent: Long? = null,
        linked: Boolean? = null,
    ): DocumentsListResponse =
        http.json("GET", "/api/v1/documents", listOf("cursor" to cursor, "limit" to limit, "q" to q, "tag" to tag, "correspondent" to correspondent, "linked" to linked), DocumentsListResponse.serializer())

    /**
     * Inventory and contact suggestions from the document system
     *
     * `kind=asset`: receipts (documents with a receipt tag) with a warranty date that no asset is linked to yet; accepting creates the asset and links the document with role `receipt` (the link fills the warranty dates). `kind=contact`: correspondents of the synced documents that no contact stands for yet; pass `externalSource` and `externalRef` of the item when creating the contact. Built from the caller's own synced documents only.
     *
     * @param kind asset | contact
     */
    suspend fun documentsSuggestions(
        kind: String,
    ): DocumentsSuggestionsResponse =
        http.json("GET", "/api/v1/documents/suggestions", listOf("kind" to kind), DocumentsSuggestionsResponse.serializer())

    /**
     * State of a push to the document system
     *
     * Only the person who started the job sees it (404 for everybody else). Poll until `status` is `done` or `failed`.
     */
    suspend fun documentUploadsGet(
        jobId: String,
    ): DocumentUpload =
        http.json("GET", "/api/v1/documents/uploads/${ApiHttp.segment(jobId)}", emptyList(), DocumentUpload.serializer())

    /**
     * One document: metadata and where it is used
     *
     * Asked live through the caller's own connection (never another person's): 404 when the caller has no connection or the system does not show them the document.
     */
    suspend fun documentsGet(
        provider: String,
        externalId: String,
    ): ExternalDocumentDetail =
        http.json("GET", "/api/v1/documents/${ApiHttp.segment(provider)}/${ApiHttp.segment(externalId)}", emptyList(), ExternalDocumentDetail.serializer())

    /**
     * Preview of a document (PDF or image)
     *
     * Streamed through the caller's own connection, at most 25 MB; only PDF, raster images and plain text are sent inline, anything else as `application/octet-stream` download. `nosniff`, a restrictive CSP, `Cache-Control: private`. 404 without a connection or when the account may not see the document.
     */
    suspend fun documentsPreview(
        provider: String,
        externalId: String,
    ): BinaryBody =
        http.binary("GET", "/api/v1/documents/${ApiHttp.segment(provider)}/${ApiHttp.segment(externalId)}/preview", emptyList())

    /**
     * Thumbnail of a document
     *
     * Same rules as the preview; WebP.
     */
    suspend fun documentsThumb(
        provider: String,
        externalId: String,
    ): BinaryBody =
        http.binary("GET", "/api/v1/documents/${ApiHttp.segment(provider)}/${ApiHttp.segment(externalId)}/thumb", emptyList())

    /**
     * Download of a document
     *
     * The archived PDF, or with `?original=1` the original file; sent as an attachment. Same rules as the preview.
     *
     * @param original 0 | 1 | true | false
     */
    suspend fun documentsDownload(
        provider: String,
        externalId: String,
        original: String? = null,
    ): BinaryBody =
        http.binary("GET", "/api/v1/documents/${ApiHttp.segment(provider)}/${ApiHttp.segment(externalId)}/download", listOf("original" to original))

    /**
     * Links between documents and things in hauswart
     *
     * Filter by owner (`ownerType` + `ownerId`) or by document (`provider` + `externalId`). Each link says whether the caller's own account can read the document (`available`); a document that is not shared with the caller shows no title.
     *
     * @param ownerType asset | room | page | task | defect | service_log | part | contact | cost | insurance_policy
     *
     * @param provider paperless
     */
    suspend fun documentLinksList(
        cursor: String? = null,
        limit: Long? = null,
        ownerType: String? = null,
        ownerId: String? = null,
        provider: String? = null,
        externalId: Long? = null,
    ): DocumentLinksListResponse =
        http.json("GET", "/api/v1/document-links", listOf("cursor" to cursor, "limit" to limit, "ownerType" to ownerType, "ownerId" to ownerId, "provider" to provider, "externalId" to externalId), DocumentLinksListResponse.serializer())

    /**
     * Link a document to an asset, room, task, ...
     *
     * The caller's own account must be able to read the document (404 otherwise). The same document can be linked to the same owner once per role (409 `conflict`). A receipt or warranty document on an asset fills its warranty dates when they are empty or came from a document. A page owner needs `docs:write`. With the connection setting `writeBackNotes` a note with the hauswart link is added to the document (once).
     */
    suspend fun documentLinksCreate(
        body: DocumentLinksCreateRequest,
    ): DocumentLink =
        http.json("POST", "/api/v1/document-links", emptyList(), DocumentLinksCreateRequest.serializer(), body, DocumentLink.serializer())

    /**
     * Remove a link
     *
     * Only the link: the document stays in its system and an asset keeps the warranty dates it got. A page owner needs `docs:write`.
     */
    suspend fun documentLinksDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/document-links/${ApiHttp.segment(id)}", emptyList())

    /**
     * Send an attachment to the caller's document system
     *
     * Starts a job (202) that uploads the file with the connection's upload tags, storage path and correspondent, waits until the system has consumed it, gives the connection's groups access, links the new document to the attachment's owner and, when enabled, leaves a note with the hauswart link. Poll `GET /documents/uploads/{jobId}`. Owners that cannot be linked (a hint) are refused with 400; 404 without a connection.
     */
    suspend fun attachmentsPushToDocuments(
        id: String,
        body: AttachmentsPushToDocumentsRequest,
    ): DocumentUpload =
        http.json("POST", "/api/v1/attachments/${ApiHttp.segment(id)}/push-to-documents", emptyList(), AttachmentsPushToDocumentsRequest.serializer(), body, DocumentUpload.serializer())
}

@Serializable
data class DocumentsListResponse(
    val items: List<ExternalDocument>,
    val nextCursor: String?,
)

@Serializable
data class DocumentsSuggestionsResponse(
    val items: List<JsonElement>,
)

@Serializable
data class DocumentLinksListResponse(
    val items: List<DocumentLink>,
    val nextCursor: String?,
)

@Serializable
data class DocumentLinksCreateRequest(
    /** paperless */
    val provider: String? = null,
    val externalId: Long,
    /** asset | room | page | task | defect | service_log | part | contact | cost | insurance_policy */
    val ownerType: String,
    val ownerId: String,
    /** manual | receipt | warranty | datasheet | correspondence | invoice | policy | registration | other */
    val role: String? = null,
    val label: String? = null,
) {
    companion object {
        val OWNER_TYPE_VALUES: List<String> = listOf("asset", "room", "page", "task", "defect", "service_log", "part", "contact", "cost", "insurance_policy")
        val ROLE_VALUES: List<String> = listOf("manual", "receipt", "warranty", "datasheet", "correspondence", "invoice", "policy", "registration", "other")
    }
}

@Serializable
data class AttachmentsPushToDocumentsRequest(
    /** paperless */
    val provider: String? = null,
    val title: String? = null,
    /** manual | receipt | warranty | datasheet | correspondence | invoice | policy | registration | other */
    val role: String? = null,
    val label: String? = null,
) {
    companion object {
        val ROLE_VALUES: List<String> = listOf("manual", "receipt", "warranty", "datasheet", "correspondence", "invoice", "policy", "registration", "other")
    }
}
