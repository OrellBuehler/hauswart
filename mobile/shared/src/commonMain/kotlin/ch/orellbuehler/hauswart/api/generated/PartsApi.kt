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

class PartsApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * List spare parts
     *
     * Filter by a search text, by linked asset or task, or to parts below their minimum stock. Archived parts are left out unless includeArchived=true.
     */
    suspend fun partsList(
        cursor: String? = null,
        limit: Long? = null,
        q: String? = null,
        assetId: String? = null,
        taskId: String? = null,
        lowStock: Boolean? = null,
        includeArchived: Boolean? = null,
    ): PartsListResponse =
        http.json("GET", "/api/v1/parts", listOf("cursor" to cursor, "limit" to limit, "q" to q, "assetId" to assetId, "taskId" to taskId, "lowStock" to lowStock, "includeArchived" to includeArchived), PartsListResponse.serializer())

    /**
     * Create a spare part
     *
     * A starting stock above zero is booked as a movement. The currency defaults to the household's.
     */
    suspend fun partsCreate(
        body: PartsCreateRequest,
    ): Part =
        http.json("POST", "/api/v1/parts", emptyList(), PartsCreateRequest.serializer(), body, Part.serializer())

    /**
     * Parts to order now
     *
     * For each task with linked parts: the parts whose stock (plus what is on order) does not cover the quantity the task needs plus the minimum stock, once today has reached the order-by date (needed-by date minus the part's lead time). Sorted by order-by date.
     */
    suspend fun partsOrderNow(): PartsOrderNowResponse =
        http.json("GET", "/api/v1/parts/order-now", emptyList(), PartsOrderNowResponse.serializer())

    /**
     * Get a spare part with its links and recent movements
     */
    suspend fun partsGet(
        id: String,
    ): PartDetail =
        http.json("GET", "/api/v1/parts/${ApiHttp.segment(id)}", emptyList(), PartDetail.serializer())

    /**
     * Update a spare part
     *
     * Stock is changed with the stock endpoint, which records a movement.
     */
    suspend fun partsUpdate(
        id: String,
        body: PartsUpdateRequest,
    ): Part =
        http.json("PATCH", "/api/v1/parts/${ApiHttp.segment(id)}", emptyList(), PartsUpdateRequest.serializer(), body, Part.serializer())

    /**
     * Delete a spare part
     *
     * Links to assets and tasks and the movement history go with it; preparations that named the part lose the link. Archive to keep the history.
     */
    suspend fun partsDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/parts/${ApiHttp.segment(id)}", emptyList())

    /**
     * Book a stock movement
     *
     * `used` takes stock out (negative delta), `bought` brings it in (positive delta) and ends a pending order, `correction` does either. Stock cannot go below zero. Completing a task that has the part linked books a `used` movement by itself.
     */
    suspend fun partsStock(
        id: String,
        body: PartsStockRequest,
    ): Part =
        http.json("POST", "/api/v1/parts/${ApiHttp.segment(id)}/stock", emptyList(), PartsStockRequest.serializer(), body, Part.serializer())

    /**
     * Stock movements of a part, newest first
     */
    suspend fun partsMovements(
        id: String,
        cursor: String? = null,
        limit: Long? = null,
    ): PartsMovementsResponse =
        http.json("GET", "/api/v1/parts/${ApiHttp.segment(id)}/movements", listOf("cursor" to cursor, "limit" to limit), PartsMovementsResponse.serializer())

    /**
     * Mark a part as ordered
     *
     * Records the order time and quantity (default: the reorder quantity); qty 0 clears the order. Booking the stock as bought clears it too.
     */
    suspend fun partsOrdered(
        id: String,
        body: PartsOrderedRequest,
    ): Part =
        http.json("POST", "/api/v1/parts/${ApiHttp.segment(id)}/ordered", emptyList(), PartsOrderedRequest.serializer(), body, Part.serializer())

    /**
     * Spare parts of an asset
     */
    suspend fun assetPartsList(
        id: String,
        cursor: String? = null,
        limit: Long? = null,
    ): AssetPartsListResponse =
        http.json("GET", "/api/v1/assets/${ApiHttp.segment(id)}/parts", listOf("cursor" to cursor, "limit" to limit), AssetPartsListResponse.serializer())

    /**
     * Link a spare part to an asset
     */
    suspend fun assetPartsLink(
        id: String,
        body: AssetPartsLinkRequest,
    ): AssetPart =
        http.json("POST", "/api/v1/assets/${ApiHttp.segment(id)}/parts", emptyList(), AssetPartsLinkRequest.serializer(), body, AssetPart.serializer())

    /**
     * Unlink a spare part from an asset
     */
    suspend fun assetPartsUnlink(
        id: String,
        partId: String,
    ) =
        http.empty("DELETE", "/api/v1/assets/${ApiHttp.segment(id)}/parts/${ApiHttp.segment(partId)}", emptyList())

    /**
     * Spare parts a task uses
     */
    suspend fun taskPartsList(
        id: String,
        cursor: String? = null,
        limit: Long? = null,
    ): TaskPartsListResponse =
        http.json("GET", "/api/v1/tasks/${ApiHttp.segment(id)}/parts", listOf("cursor" to cursor, "limit" to limit), TaskPartsListResponse.serializer())

    /**
     * Link a spare part to a task
     *
     * Completing the task takes qty of the part out of stock; undoing the completion puts it back.
     */
    suspend fun taskPartsLink(
        id: String,
        body: TaskPartsLinkRequest,
    ): TaskPart =
        http.json("POST", "/api/v1/tasks/${ApiHttp.segment(id)}/parts", emptyList(), TaskPartsLinkRequest.serializer(), body, TaskPart.serializer())

    /**
     * Change the quantity a task uses
     */
    suspend fun taskPartsUpdate(
        id: String,
        partId: String,
        body: TaskPartsUpdateRequest,
    ): TaskPart =
        http.json("PATCH", "/api/v1/tasks/${ApiHttp.segment(id)}/parts/${ApiHttp.segment(partId)}", emptyList(), TaskPartsUpdateRequest.serializer(), body, TaskPart.serializer())

    /**
     * Unlink a spare part from a task
     */
    suspend fun taskPartsUnlink(
        id: String,
        partId: String,
    ) =
        http.empty("DELETE", "/api/v1/tasks/${ApiHttp.segment(id)}/parts/${ApiHttp.segment(partId)}", emptyList())
}

@Serializable
data class PartsListResponse(
    val items: List<Part>,
    val nextCursor: String?,
)

@Serializable
data class PartsCreateRequest(
    val name: String,
    val partNumber: String? = null,
    val supplier: String? = null,
    val shopUrl: String? = null,
    val unitPriceMinor: Long? = null,
    val currency: String? = null,
    val stockCount: Long? = null,
    val minStock: Long? = null,
    val reorderQty: Long? = null,
    val leadTimeDays: Long? = null,
    val notes: String? = null,
)

@Serializable
data class PartsOrderNowResponse(
    val items: List<OrderNowItem>,
)

@Serializable
data class PartsUpdateRequest(
    val name: String? = null,
    val partNumber: Patch<String> = Patch.Keep,
    val supplier: Patch<String> = Patch.Keep,
    val shopUrl: String? = null,
    val unitPriceMinor: Patch<Long> = Patch.Keep,
    val currency: String? = null,
    val minStock: Long? = null,
    val reorderQty: Long? = null,
    val leadTimeDays: Long? = null,
    val notes: Patch<String> = Patch.Keep,
    val archived: Boolean? = null,
)

@Serializable
data class PartsStockRequest(
    val delta: Long,
    /** used | bought | correction */
    val reason: String,
    val note: String? = null,
) {
    companion object {
        val REASON_VALUES: List<String> = listOf("used", "bought", "correction")
    }
}

@Serializable
data class PartsMovementsResponse(
    val items: List<PartMovement>,
    val nextCursor: String?,
)

@Serializable
data class PartsOrderedRequest(
    val qty: Long? = null,
)

@Serializable
data class AssetPartsListResponse(
    val items: List<AssetPart>,
    val nextCursor: String?,
)

@Serializable
data class AssetPartsLinkRequest(
    val partId: String,
)

@Serializable
data class TaskPartsListResponse(
    val items: List<TaskPart>,
    val nextCursor: String?,
)

@Serializable
data class TaskPartsLinkRequest(
    val partId: String,
    val qty: Long? = null,
)

@Serializable
data class TaskPartsUpdateRequest(
    val qty: Long,
)
