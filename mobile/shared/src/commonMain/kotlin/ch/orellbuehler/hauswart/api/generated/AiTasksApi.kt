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

class AiTasksApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * List the tasks of the receipt queue
     *
     * Every member sees every task (the queue is household data, like cost entries). Newest first; filter by `status` (`pending|done|dismissed`) and `kind`. Without a filter all statuses are listed.
     *
     * @param status pending | done | dismissed
     *
     * @param kind receipt | fuel_receipt | service_invoice | insurance_policy
     */
    suspend fun aiTasksList(
        cursor: String? = null,
        limit: Long? = null,
        status: String? = null,
        kind: String? = null,
    ): AiTasksListResponse =
        http.json("GET", "/api/v1/ai-tasks", listOf("cursor" to cursor, "limit" to limit, "status" to status, "kind" to kind), AiTasksListResponse.serializer())

    /**
     * Count the tasks of the receipt queue
     *
     * `{count}` with the filters of the list (`status`, `kind`) and without reading the tasks, for a badge: `?status=pending` is how many receipts wait to be booked. Every member sees the same number (the queue is household data). The dashboard carries the pending count as `pendingReceiptCount`.
     *
     * @param status pending | done | dismissed
     *
     * @param kind receipt | fuel_receipt | service_invoice | insurance_policy
     */
    suspend fun aiTasksCount(
        status: String? = null,
        kind: String? = null,
    ): AiTaskCount =
        http.json("GET", "/api/v1/ai-tasks/count", listOf("status" to status, "kind" to kind), AiTaskCount.serializer())

    /**
     * Get a task of the receipt queue
     *
     * With the file (`attachment`, whose `url` and `thumbUrl` serve it), the uploader's note and hints, `claim` (who opened the pending task within the last 15 minutes, if anybody), `bookedSoFar` (the cost entries that exist and were booked for the task with `receiptTaskId`, oldest first: what an interrupted client or somebody else's client already did) and, once processed, the result: the ids the processor reported and the cost entries that still exist (`result.costs`).
     */
    suspend fun aiTasksGet(
        id: String,
    ): AiTask =
        http.json("GET", "/api/v1/ai-tasks/${ApiHttp.segment(id)}", emptyList(), AiTask.serializer())

    /**
     * Delete a task
     *
     * Only the uploader or an administrator (403 `forbidden` otherwise). Removes the task and the file while it still belongs to the task (pending or dismissed); a file that moved to a cost entry stays there as that entry's receipt. The cost entries are not touched.
     */
    suspend fun aiTasksDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/ai-tasks/${ApiHttp.segment(id)}", emptyList())

    /**
     * The task's file sized for an assistant to read
     *
     * The receipt as an image of at most 1600 px on the longest side and about 1.5 MB: an image that is smaller is sent as stored, a larger one is scaled down and sent as JPEG (a very long, narrow receipt may keep up to 3200 px on its long side so that its text stays legible). A PDF is sent as stored. 404 when the task has no file any more. Sent with `nosniff`, an `ETag` and `Cache-Control: private, no-cache` (a copy is kept but asked about every time, since the scaled copy can change while the file does not: `If-None-Match` answers 304); use `GET /attachments/{id}/content` (the task's `attachment.url`) for the original.
     */
    suspend fun aiTasksPreview(
        id: String,
    ): BinaryBody =
        http.binary("GET", "/api/v1/ai-tasks/${ApiHttp.segment(id)}/preview", emptyList())

    /**
     * Mark a task as being worked on
     *
     * A soft lease for clients that work through the queue: it records the caller as the one who opened the pending task, for 15 minutes (renewed by calling this again, and by booking for the task with `receiptTaskId`), and answers the task with its `claim`. If somebody else holds an unexpired lease it stays theirs and the answer says so, so a client can warn before it books a receipt another client may be booking right now. Nothing is locked: booking and completing work for everybody, and the rules of the queue (a closed task takes no more bookings, a second completion with other entries is a 409) are what keep a receipt from being booked twice. A task that is done or dismissed is answered as it is, with no claim. No request body; needs `costs:write` like the other writes of the queue.
     */
    suspend fun aiTasksClaim(
        id: String,
    ): AiTask =
        http.json("POST", "/api/v1/ai-tasks/${ApiHttp.segment(id)}/claim", emptyList(), AiTask.serializer())

    /**
     * Close a task as done with the entries it produced
     *
     * `createdCostIds` and `createdFuelLogIds` name entries that must exist (400 on the field otherwise) and must be the task's result: booked for this task (`receiptTaskId`) or created after the task was queued. An entry that existed before the task, a fuel log entry made before it and an entry booked for another task are a 400 on the field, naming the ids (a payment booked twice is not what the receipt became; dismiss the task if it was booked already). At least one entry is needed (a receipt that produced nothing is dismissed instead). In one transaction every cost entry named, and the cost entry each named fuel log entry booked, is flagged `reviewNeeded` (it was booked from a receipt somebody else read; entries booked for the task were flagged then, and a review a person did since is never undone), the file moves to the first of those cost entries as its receipt (the others get a copy; a free fuel fill has no cost entry) and the task becomes `done` with the result, `completedAt`, `completedVia` (`session` or the token kind) and who closed it (`completedByUserId`, `completedByName`: the person in the browser, or the owner of the token). `note` is for the people reading the entries (what was unsure). Idempotent: completing a done task with the same entries (in any order) answers 200 with the task as it is (the first closer stays); with other entries it is a 409 `conflict`, and so is completing a dismissed task. Send a JSON body.
     */
    suspend fun aiTasksComplete(
        id: String,
        body: AiTasksCompleteRequest,
    ): AiTask =
        http.json("POST", "/api/v1/ai-tasks/${ApiHttp.segment(id)}/complete", emptyList(), AiTasksCompleteRequest.serializer(), body, AiTask.serializer())

    /**
     * Close a task without booking anything
     *
     * For a file that is no receipt, unreadable or already booked; `reason` (at most 500 characters) tells the uploader why. The file stays with the task until the task is deleted. Who dismissed it is recorded like for a completion (`completedByUserId`, `completedByName`). Idempotent: dismissing a dismissed task answers 200 with the task as it is (the first reason and the first closer stay); a done task is a 409 `conflict`. Send a JSON body (`{}` is enough).
     */
    suspend fun aiTasksDismiss(
        id: String,
        body: AiTasksDismissRequest,
    ): AiTask =
        http.json("POST", "/api/v1/ai-tasks/${ApiHttp.segment(id)}/dismiss", emptyList(), AiTasksDismissRequest.serializer(), body, AiTask.serializer())
}

@Serializable
data class AiTasksListResponse(
    val items: List<AiTask>,
    val nextCursor: String?,
)

@Serializable
data class AiTasksCompleteRequest(
    val createdCostIds: List<String>? = null,
    val createdFuelLogIds: List<String>? = null,
    val note: String? = null,
)

@Serializable
data class AiTasksDismissRequest(
    val reason: String? = null,
)
