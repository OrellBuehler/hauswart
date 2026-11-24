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

class RoomsApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * List rooms
     */
    suspend fun roomsList(
        cursor: String? = null,
        limit: Long? = null,
    ): RoomsListResponse =
        http.json("GET", "/api/v1/rooms", listOf("cursor" to cursor, "limit" to limit), RoomsListResponse.serializer())

    /**
     * Create a room
     *
     * The slug is derived from the name unless given.
     */
    suspend fun roomsCreate(
        body: RoomsCreateRequest,
    ): Room =
        http.json("POST", "/api/v1/rooms", emptyList(), RoomsCreateRequest.serializer(), body, Room.serializer())

    /**
     * Get a room
     */
    suspend fun roomsGet(
        id: String,
    ): Room =
        http.json("GET", "/api/v1/rooms/${ApiHttp.segment(id)}", emptyList(), Room.serializer())

    /**
     * Update a room
     */
    suspend fun roomsUpdate(
        id: String,
        body: RoomsUpdateRequest,
    ): Room =
        http.json("PATCH", "/api/v1/rooms/${ApiHttp.segment(id)}", emptyList(), RoomsUpdateRequest.serializer(), body, Room.serializer())

    /**
     * Delete a room
     *
     * Assets and tasks in the room stay and lose their room.
     */
    suspend fun roomsDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/rooms/${ApiHttp.segment(id)}", emptyList())

    /**
     * Take over areas of the connected system as rooms
     *
     * Takes ids from `GET /integrations/{kind}/areas`. Per area, in one transaction: a room that already stores the area id is left alone (`unchanged`); an unlinked room with the same name takes the area id instead of a duplicate (`linked`); otherwise a room named like the area is created (`created`) with the area id in `haAreaId`. An area the system no longer lists answers `not_found` and changes nothing. Repeating the call changes nothing more, and renaming the area later never touches the room. 404 without a connection or for a kind without areas; 502 `upstream_error` when the system does not answer.
     */
    suspend fun roomsImportAreas(
        body: RoomsImportAreasRequest,
    ): RoomAreaImport =
        http.json("POST", "/api/v1/rooms/import-areas", emptyList(), RoomsImportAreasRequest.serializer(), body, RoomAreaImport.serializer())
}

@Serializable
data class RoomsListResponse(
    val items: List<Room>,
    val nextCursor: String?,
)

@Serializable
data class RoomsCreateRequest(
    val name: String,
    val slug: String? = null,
    val haAreaId: String? = null,
    val icon: String? = null,
    val sortOrder: Long? = null,
    val notes: String? = null,
)

@Serializable
data class RoomsUpdateRequest(
    val name: String? = null,
    val slug: String? = null,
    val haAreaId: Patch<String> = Patch.Keep,
    val icon: Patch<String> = Patch.Keep,
    val sortOrder: Long? = null,
    val notes: Patch<String> = Patch.Keep,
)

@Serializable
data class RoomsImportAreasRequest(
    /** homeassistant | paperless | kept */
    val kind: String,
    val areaIds: List<String>,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("homeassistant", "paperless", "kept")
    }
}
