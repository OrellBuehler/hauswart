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

class CommentsApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * Comments on a task, defect, asset or other entity
     *
     * Oldest first. Deleted comments stay in the thread with an empty body and deleted=true.
     *
     * @param entityType task | defect | asset | room | part | contact | service_log | asset_hint | doc_page | cost | insurance_policy | appointment
     */
    suspend fun commentsList(
        cursor: String? = null,
        limit: Long? = null,
        entityType: String,
        entityId: String,
    ): CommentsListResponse =
        http.json("GET", "/api/v1/comments", listOf("cursor" to cursor, "limit" to limit, "entityType" to entityType, "entityId" to entityId), CommentsListResponse.serializer())

    /**
     * Add a comment
     *
     * The other household members involved get an in-app notification.
     */
    suspend fun commentsCreate(
        body: CommentsCreateRequest,
    ): Comment =
        http.json("POST", "/api/v1/comments", emptyList(), CommentsCreateRequest.serializer(), body, Comment.serializer())

    /**
     * Edit a comment
     *
     * Only its author may edit, at any time; the edit time is recorded. Deleted comments cannot be edited.
     */
    suspend fun commentsUpdate(
        id: String,
        body: CommentsUpdateRequest,
    ): Comment =
        http.json("PATCH", "/api/v1/comments/${ApiHttp.segment(id)}", emptyList(), CommentsUpdateRequest.serializer(), body, Comment.serializer())

    /**
     * Delete a comment
     *
     * Its author or an administrator may delete. The comment stays in the thread as deleted; deleting twice is not an error.
     */
    suspend fun commentsDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/comments/${ApiHttp.segment(id)}", emptyList())
}

@Serializable
data class CommentsListResponse(
    val items: List<Comment>,
    val nextCursor: String?,
)

@Serializable
data class CommentsCreateRequest(
    /** task | defect | asset | room | part | contact | service_log | asset_hint | doc_page | cost | insurance_policy | appointment */
    val entityType: String,
    val entityId: String,
    val bodyMd: String,
) {
    companion object {
        val ENTITY_TYPE_VALUES: List<String> = listOf("task", "defect", "asset", "room", "part", "contact", "service_log", "asset_hint", "doc_page", "cost", "insurance_policy", "appointment")
    }
}

@Serializable
data class CommentsUpdateRequest(
    val bodyMd: String,
)
