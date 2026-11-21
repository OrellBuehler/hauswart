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

class DocsApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * List documentation pages
     *
     * Pinned first, then by sortOrder and title; with q, best match first. q is a full-text search over title and text (secret blocks excluded); archived pages are never found by it. Archived pages are left out unless includeArchived=true.
     *
     * @param section general | device | room | emergency | rules | howto
     */
    suspend fun pagesList(
        cursor: String? = null,
        limit: Long? = null,
        section: String? = null,
        assetId: String? = null,
        roomId: String? = null,
        q: String? = null,
        pinned: Boolean? = null,
        includeArchived: Boolean? = null,
    ): PagesListResponse =
        http.json("GET", "/api/v1/pages", listOf("cursor" to cursor, "limit" to limit, "section" to section, "assetId" to assetId, "roomId" to roomId, "q" to q, "pinned" to pinned, "includeArchived" to includeArchived), PagesListResponse.serializer())

    /**
     * Create a documentation page
     *
     * The markdown is rendered before the response (member and guest HTML, plain text, headings). 400 `invalid_request` with `details.code` `too_large` (over 200 KB) or `too_complex` (rendering exceeded its time limit) when it cannot be rendered. Writes revision 1. `attachment:<id>` links and images resolve to attachments, `[[slug]]` and `[[slug|label]]` to `/docs/<slug>`.
     */
    suspend fun pagesCreate(
        body: PagesCreateRequest,
    ): DocPage =
        http.json("POST", "/api/v1/pages", emptyList(), PagesCreateRequest.serializer(), body, DocPage.serializer())

    /**
     * Render markdown for the editor preview
     *
     * Renders as a member sees the page (secret blocks shown). Nothing is stored. Same size and complexity limits as saving; rate limited per user (429 `rate_limited`).
     */
    suspend fun pagesPreview(
        body: PagesPreviewRequest,
    ): PagesPreviewResponse =
        http.json("POST", "/api/v1/pages/preview", emptyList(), PagesPreviewRequest.serializer(), body, PagesPreviewResponse.serializer())

    /**
     * Get a documentation page
     *
     * Markdown source, rendered HTML for members (secret blocks included), headings, revision number and backlinks.
     */
    suspend fun pagesGet(
        slug: String,
    ): DocPage =
        http.json("GET", "/api/v1/pages/${ApiHttp.segment(slug)}", emptyList(), DocPage.serializer())

    /**
     * Edit, move, pin or archive a page
     *
     * `rev` is the revision the client edited; when the page has moved on the answer is 409 `conflict` with `details.currentRev`. Every successful save writes a revision (the last 50 are kept). Changing the slug does not rewrite `[[links]]` in other pages.
     */
    suspend fun pagesUpdate(
        slug: String,
        body: PagesUpdateRequest,
    ): DocPage =
        http.json("PATCH", "/api/v1/pages/${ApiHttp.segment(slug)}", emptyList(), PagesUpdateRequest.serializer(), body, DocPage.serializer())

    /**
     * Delete a page
     *
     * Removes the page with its revisions and attachments. Archive instead to keep it.
     */
    suspend fun pagesDelete(
        slug: String,
    ) =
        http.empty("DELETE", "/api/v1/pages/${ApiHttp.segment(slug)}", emptyList())

    /**
     * Revision history of a page, newest first
     *
     * The last 50 saved states (no markdown; fetch one for that).
     */
    suspend fun pageRevisionsList(
        slug: String,
    ): PageRevisionsListResponse =
        http.json("GET", "/api/v1/pages/${ApiHttp.segment(slug)}/revisions", emptyList(), PageRevisionsListResponse.serializer())

    /**
     * One saved state of a page, with its markdown
     */
    suspend fun pageRevisionsGet(
        slug: String,
        rev: String,
    ): PageRevision =
        http.json("GET", "/api/v1/pages/${ApiHttp.segment(slug)}/revisions/${ApiHttp.segment(rev)}", emptyList(), PageRevision.serializer())

    /**
     * Make an earlier revision the current one
     *
     * Saves the title and markdown of that revision as a new revision (history is never rewritten, so nothing is lost). Returns the page.
     */
    suspend fun pageRevisionsRestore(
        slug: String,
        rev: String,
    ): DocPage =
        http.json("POST", "/api/v1/pages/${ApiHttp.segment(slug)}/revisions/${ApiHttp.segment(rev)}/restore", emptyList(), DocPage.serializer())
}

@Serializable
data class PagesListResponse(
    val items: List<DocPageSummary>,
    val nextCursor: String?,
)

@Serializable
data class PagesCreateRequest(
    val title: String,
    val slug: String? = null,
    /** general | device | room | emergency | rules | howto */
    val section: String? = null,
    val assetId: String? = null,
    val roomId: String? = null,
    val bodyMd: String? = null,
    val sortOrder: Long? = null,
    val guestVisible: Boolean? = null,
    val pinned: Boolean? = null,
) {
    companion object {
        val SECTION_VALUES: List<String> = listOf("general", "device", "room", "emergency", "rules", "howto")
    }
}

@Serializable
data class PagesPreviewRequest(
    val bodyMd: String,
)

@Serializable
data class PagesPreviewResponse(
    val html: String,
    val headings: List<Heading>,
)

@Serializable
data class PagesUpdateRequest(
    val rev: Long,
    val title: String? = null,
    val slug: String? = null,
    /** general | device | room | emergency | rules | howto */
    val section: String? = null,
    val assetId: Patch<String> = Patch.Keep,
    val roomId: Patch<String> = Patch.Keep,
    val bodyMd: String? = null,
    val sortOrder: Long? = null,
    val guestVisible: Boolean? = null,
    val pinned: Boolean? = null,
    val archived: Boolean? = null,
) {
    companion object {
        val SECTION_VALUES: List<String> = listOf("general", "device", "room", "emergency", "rules", "howto")
    }
}

@Serializable
data class PageRevisionsListResponse(
    val items: List<PageRevisionSummary>,
)
