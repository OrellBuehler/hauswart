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

class TasksApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * List tasks with their due state
     *
     * Ordered overdue first, then by due date. assignee=me or a user id matches the current assignee. hasSteps=true lists only the tasks that have steps telling how to do them, hasSteps=false only those without (every row carries `stepCount`).
     *
     * @param status ok | open | due | overdue | snoozed | unknown
     *
     * @param category cleaning | maintenance | filter | plant | waste | inspection | payment | order | warranty | defect | other
     */
    suspend fun tasksList(
        cursor: String? = null,
        limit: Long? = null,
        status: String? = null,
        category: String? = null,
        assetId: String? = null,
        roomId: String? = null,
        assignee: String? = null,
        q: String? = null,
        includeArchived: Boolean? = null,
        externalSource: String? = null,
        externalRef: String? = null,
        hasSteps: Boolean? = null,
    ): TasksListResponse =
        http.json("GET", "/api/v1/tasks", listOf("cursor" to cursor, "limit" to limit, "status" to status, "category" to category, "assetId" to assetId, "roomId" to roomId, "assignee" to assignee, "q" to q, "includeArchived" to includeArchived, "externalSource" to externalSource, "externalRef" to externalRef, "hasSteps" to hasSteps), TasksListResponse.serializer())

    /**
     * Create a task
     *
     * The trigger is validated by the due-date engine; the first due date is computed before the response.
     */
    suspend fun tasksCreate(
        body: TasksCreateRequest,
    ): Task =
        http.json("POST", "/api/v1/tasks", emptyList(), TasksCreateRequest.serializer(), body, Task.serializer())

    /**
     * Preview what a trigger would give
     *
     * Evaluates the trigger as if it had never been completed. Nothing is stored. POST for the body; needs only read access.
     */
    suspend fun tasksPreview(
        body: TasksPreviewRequest,
    ): DueResult =
        http.json("POST", "/api/v1/tasks/preview", emptyList(), TasksPreviewRequest.serializer(), body, DueResult.serializer())

    /**
     * Get a task with preparations, steps and recent completions
     *
     * Besides the task: its preparations, the most recent completions, the `steps` that say how to do it (in order, each with the pictures attached to it) and `stepsSource`, where those steps come from. `stepsSource` is null when none was given, and when the file it named has been deleted and nothing else was said; otherwise it carries the `label`, the web `url` or the `attachment` (and `page` of it) of hauswart. If only the file is gone, `attachmentId`, `attachment` and `page` read as null.
     */
    suspend fun tasksGet(
        id: String,
    ): TaskDetail =
        http.json("GET", "/api/v1/tasks/${ApiHttp.segment(id)}", emptyList(), TaskDetail.serializer())

    /**
     * Update or archive a task
     *
     * Re-evaluates the task. archived=true archives, false restores.
     */
    suspend fun tasksUpdate(
        id: String,
        body: TasksUpdateRequest,
    ): Task =
        http.json("PATCH", "/api/v1/tasks/${ApiHttp.segment(id)}", emptyList(), TasksUpdateRequest.serializer(), body, Task.serializer())

    /**
     * Delete a task
     *
     * Removes the task with its completions, preparations, steps (and the pictures attached to them) and notifications. Archive instead to keep the history.
     */
    suspend fun tasksDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/tasks/${ApiHttp.segment(id)}", emptyList())

    /**
     * Replace the steps that say how to do a task
     *
     * Replaces the whole list in one transaction: `steps` is the new list in order (at most 30; send `[]` to remove them all). A step with the `id` of one of this task's steps keeps its id, its pictures and its creation time and takes the new `title` (one line, at most 200 characters), `body` (plain text, at most 2000, default empty) and place; a step without an `id` is new; a step of the task that the list leaves out is deleted together with its pictures. An `id` that is not a step of this task, or the same `id` twice, is a 400 on `steps`. Pictures are attachments of the owner type `task_step` with the step's id as `ownerId`: upload them with `POST /attachments` (or `POST /attachments/from-url`) after the step exists, and they come back in `images` in upload order. `source` says where the steps come from: left out it is unchanged, `null` removes it, an object replaces it entirely: `label` (at most 200 characters), then either `url` (http or https, at most 2000 characters, no user name or password) or `attachmentId` (a file of hauswart that exists, else a 400 on `source`; typically the manual attached to the device) with an optional `page` (1 to 9999, only together with `attachmentId`); `url` and `attachmentId` exclude each other and an object with nothing in it is a 400 (use `null`). Answers the steps, the resolved source and `stepCount` as `GET /tasks/{id}` carries them. Archived tasks can be edited. The task itself is not touched: it is not re-evaluated and its `updatedAt` stays. 404 for a missing task.
     */
    suspend fun tasksStepsPut(
        id: String,
        body: TasksStepsPutRequest,
    ): TaskSteps =
        http.json("PUT", "/api/v1/tasks/${ApiHttp.segment(id)}/steps", emptyList(), TasksStepsPutRequest.serializer(), body, TaskSteps.serializer())

    /**
     * Mark a task done
     *
     * Returns the completion and the re-evaluated task. A repeated idempotencyKey returns the first completion with status 200. Browser sessions are attributed as manual (or qr when sent); API tokens by their kind (mcp, ha, otherwise api) and their source field is ignored. Linked spare parts are taken out of stock. With serviceLog the work is also logged on the task's asset (400 for a task without an asset); the entry comes back as serviceLog, and serviceLog.resolvedNoteIds resolves notes of that asset with it (undoing the completion reopens them, except a note that has become a defect meanwhile; another asset's note is a 400 and nothing is completed). The returned task is read after the entry was written, so its openNoteCount is current. A counterValue of a task that counts on a vehicle's odometer is a reading of it: A reading below the one before its date or above the one after it is a 400 on the value field (`counterValue` here) whose `details` carry `code` (`lower_than_previous` or `higher_than_next`), `field` and `reading` (`{value, date}` of the neighbouring reading in the way) besides the English field error; no such code for any other problem.
     */
    suspend fun tasksComplete(
        id: String,
        body: TasksCompleteRequest,
    ): TasksCompleteResponse =
        http.json("POST", "/api/v1/tasks/${ApiHttp.segment(id)}/complete", emptyList(), TasksCompleteRequest.serializer(), body, TasksCompleteResponse.serializer())

    /**
     * Skip the current occurrence of a task
     *
     * Like complete, but recorded as skipped: the next occurrence follows without counting as done.
     */
    suspend fun tasksSkip(
        id: String,
        body: TasksSkipRequest,
    ): TasksCompleteResponse =
        http.json("POST", "/api/v1/tasks/${ApiHttp.segment(id)}/skip", emptyList(), TasksSkipRequest.serializer(), body, TasksCompleteResponse.serializer())

    /**
     * Hide a task until a date
     *
     * until must be after today; null ends the snooze. Snoozed tasks send no notifications.
     */
    suspend fun tasksSnooze(
        id: String,
        body: TasksSnoozeRequest,
    ): Task =
        http.json("POST", "/api/v1/tasks/${ApiHttp.segment(id)}/snooze", emptyList(), TasksSnoozeRequest.serializer(), body, Task.serializer())

    /**
     * List the preparations of a task
     */
    suspend fun preparationsList(
        id: String,
    ): PreparationsListResponse =
        http.json("GET", "/api/v1/tasks/${ApiHttp.segment(id)}/preparations", emptyList(), PreparationsListResponse.serializer())

    /**
     * Add a preparation to a task
     */
    suspend fun preparationsCreate(
        id: String,
        body: PreparationsCreateRequest,
    ): Preparation =
        http.json("POST", "/api/v1/tasks/${ApiHttp.segment(id)}/preparations", emptyList(), PreparationsCreateRequest.serializer(), body, Preparation.serializer())

    /**
     * Update a preparation
     */
    suspend fun preparationsUpdate(
        id: String,
        prepId: String,
        body: PreparationsUpdateRequest,
    ): Preparation =
        http.json("PATCH", "/api/v1/tasks/${ApiHttp.segment(id)}/preparations/${ApiHttp.segment(prepId)}", emptyList(), PreparationsUpdateRequest.serializer(), body, Preparation.serializer())

    /**
     * Delete a preparation
     */
    suspend fun preparationsDelete(
        id: String,
        prepId: String,
    ) =
        http.empty("DELETE", "/api/v1/tasks/${ApiHttp.segment(id)}/preparations/${ApiHttp.segment(prepId)}", emptyList())

    /**
     * Tick off a preparation
     *
     * For the occurrence the task shows now unless occurrenceKey is given. Repeating it is not an error.
     */
    suspend fun preparationsComplete(
        id: String,
        prepId: String,
        body: PreparationsCompleteRequest,
    ): Preparation =
        http.json("POST", "/api/v1/tasks/${ApiHttp.segment(id)}/preparations/${ApiHttp.segment(prepId)}/complete", emptyList(), PreparationsCompleteRequest.serializer(), body, Preparation.serializer())

    /**
     * Recent completions, newest first
     */
    suspend fun completionsList(
        cursor: String? = null,
        limit: Long? = null,
        taskId: String? = null,
        userId: String? = null,
        includeRevoked: Boolean? = null,
    ): CompletionsListResponse =
        http.json("GET", "/api/v1/completions", listOf("cursor" to cursor, "limit" to limit, "taskId" to taskId, "userId" to userId, "includeRevoked" to includeRevoked), CompletionsListResponse.serializer())

    /**
     * Undo a completion
     *
     * Any household member may undo within 7 days of the completion being recorded; the task goes back to its previous due date. Notes that the service log entry written with the completion had resolved are open again (the entry stays in the log), except a note that has become a defect meanwhile: that stays resolved. Undoing twice is not an error.
     */
    suspend fun completionsUndo(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/completions/${ApiHttp.segment(id)}", emptyList())
}

@Serializable
data class TasksListResponse(
    val items: List<Task>,
    val nextCursor: String?,
)

@Serializable
data class TasksCreateRequest(
    val title: String,
    val descriptionMd: String? = null,
    /** cleaning | maintenance | filter | plant | waste | inspection | payment | order | warranty | defect | other */
    val category: String? = null,
    /** low | normal | high */
    val priority: String? = null,
    val effortMinutes: Long? = null,
    val assetId: String? = null,
    val roomId: String? = null,
    val trigger: Trigger,
    /** none | fixed | rotate */
    val assignMode: String? = null,
    val assigneeUserId: String? = null,
    val rotationOrder: List<String>? = null,
    /** alternate | fair */
    val rotationStrategy: String? = null,
    /** assignee | all */
    val notifyMode: String? = null,
    val graceDays: Long? = null,
    val dueSoonDays: Long? = null,
    /** manual | seed | kept | paperless | ha | mcp | system */
    val source: String? = null,
    val externalSource: String? = null,
    val externalRef: String? = null,
    val externalUrl: String? = null,
) {
    companion object {
        val CATEGORY_VALUES: List<String> = listOf("cleaning", "maintenance", "filter", "plant", "waste", "inspection", "payment", "order", "warranty", "defect", "other")
        val PRIORITY_VALUES: List<String> = listOf("low", "normal", "high")
        val ASSIGN_MODE_VALUES: List<String> = listOf("none", "fixed", "rotate")
        val ROTATION_STRATEGY_VALUES: List<String> = listOf("alternate", "fair")
        val NOTIFY_MODE_VALUES: List<String> = listOf("assignee", "all")
        val SOURCE_VALUES: List<String> = listOf("manual", "seed", "kept", "paperless", "ha", "mcp", "system")
    }
}

@Serializable
data class TasksPreviewRequest(
    val trigger: Trigger,
    val graceDays: Long? = null,
    val dueSoonDays: Long? = null,
    /** date */
    val today: String? = null,
)

@Serializable
data class TasksUpdateRequest(
    val title: String? = null,
    val descriptionMd: String? = null,
    /** cleaning | maintenance | filter | plant | waste | inspection | payment | order | warranty | defect | other */
    val category: String? = null,
    /** low | normal | high */
    val priority: String? = null,
    val effortMinutes: Patch<Long> = Patch.Keep,
    val assetId: Patch<String> = Patch.Keep,
    val roomId: Patch<String> = Patch.Keep,
    val trigger: Trigger? = null,
    /** none | fixed | rotate */
    val assignMode: String? = null,
    val assigneeUserId: Patch<String> = Patch.Keep,
    val rotationOrder: List<String>? = null,
    /** alternate | fair */
    val rotationStrategy: String? = null,
    /** assignee | all */
    val notifyMode: String? = null,
    val graceDays: Long? = null,
    val dueSoonDays: Patch<Long> = Patch.Keep,
    val externalUrl: Patch<String> = Patch.Keep,
    val archived: Boolean? = null,
) {
    companion object {
        val CATEGORY_VALUES: List<String> = listOf("cleaning", "maintenance", "filter", "plant", "waste", "inspection", "payment", "order", "warranty", "defect", "other")
        val PRIORITY_VALUES: List<String> = listOf("low", "normal", "high")
        val ASSIGN_MODE_VALUES: List<String> = listOf("none", "fixed", "rotate")
        val ROTATION_STRATEGY_VALUES: List<String> = listOf("alternate", "fair")
        val NOTIFY_MODE_VALUES: List<String> = listOf("assignee", "all")
    }
}

@Serializable
data class TasksStepsPutRequestStepsItem(
    val id: String? = null,
    val title: String,
    val body: String? = null,
)

@Serializable
data class TasksStepsPutRequestSource(
    val label: Patch<String> = Patch.Keep,
    val url: Patch<String> = Patch.Keep,
    val attachmentId: Patch<String> = Patch.Keep,
    val page: Patch<Long> = Patch.Keep,
)

@Serializable
data class TasksStepsPutRequest(
    val steps: List<TasksStepsPutRequestStepsItem>,
    val source: Patch<TasksStepsPutRequestSource> = Patch.Keep,
)

@Serializable
data class TasksCompleteRequestServiceLog(
    /** maintenance | repair | installation | inspection | replacement | other */
    val kind: String? = null,
    val title: String? = null,
    val descriptionMd: String? = null,
    val contactId: String? = null,
    val costMinor: Long? = null,
    val resolvedNoteIds: List<String>? = null,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("maintenance", "repair", "installation", "inspection", "replacement", "other")
    }
}

@Serializable
data class TasksCompleteRequest(
    val note: String? = null,
    val occurrenceKey: String? = null,
    /** date-time */
    val completedAt: String? = null,
    val idempotencyKey: String? = null,
    /** manual | qr | notification */
    val source: String? = null,
    val counterValue: Double? = null,
    val serviceLog: TasksCompleteRequestServiceLog? = null,
) {
    companion object {
        val SOURCE_VALUES: List<String> = listOf("manual", "qr", "notification")
    }
}

@Serializable
data class TasksCompleteResponse(
    val completion: Completion,
    val task: Task,
    val serviceLog: ServiceLogEntry?,
)

@Serializable
data class TasksSkipRequest(
    val note: String? = null,
    val occurrenceKey: String? = null,
    /** date-time */
    val completedAt: String? = null,
    val idempotencyKey: String? = null,
    /** manual | qr | notification */
    val source: String? = null,
) {
    companion object {
        val SOURCE_VALUES: List<String> = listOf("manual", "qr", "notification")
    }
}

@Serializable
data class TasksSnoozeRequest(
    /** date */
    val until: String?,
)

@Serializable
data class PreparationsListResponse(
    val items: List<Preparation>,
    val nextCursor: String?,
)

@Serializable
data class PreparationsCreateRequest(
    val title: String,
    /** generic | order_part */
    val kind: String? = null,
    val leadDays: Long? = null,
    val leadValue: PreparationLeadValue? = null,
    val partId: String? = null,
    val qty: Long? = null,
    val sortOrder: Long? = null,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("generic", "order_part")
    }
}

@Serializable
data class PreparationsUpdateRequestLeadValue(
    val entityId: String,
    /** eq | ne | gt | gte | lt | lte */
    val op: String,
    val value: JsonElement,
) {
    companion object {
        val OP_VALUES: List<String> = listOf("eq", "ne", "gt", "gte", "lt", "lte")
    }
}

@Serializable
data class PreparationsUpdateRequest(
    val title: String? = null,
    /** generic | order_part */
    val kind: String? = null,
    val leadDays: Patch<Long> = Patch.Keep,
    val leadValue: Patch<PreparationsUpdateRequestLeadValue> = Patch.Keep,
    val partId: Patch<String> = Patch.Keep,
    val qty: Long? = null,
    val sortOrder: Long? = null,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("generic", "order_part")
    }
}

@Serializable
data class PreparationsCompleteRequest(
    val occurrenceKey: String? = null,
)

@Serializable
data class CompletionsListResponse(
    val items: List<Completion>,
    val nextCursor: String?,
)
