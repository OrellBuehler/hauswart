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

class WarrantiesApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * Warranty overview
     *
     * Assets with a warranty date, by the day the warranty ends (the later of warrantyUntil and warrantyExtendedUntil). Status: expired once that day has passed, expiring within 90 days, otherwise valid.
     *
     * @param status valid | expiring | expired
     */
    suspend fun warrantiesList(
        cursor: String? = null,
        limit: Long? = null,
        status: String? = null,
    ): WarrantiesListResponse =
        http.json("GET", "/api/v1/warranties", listOf("cursor" to cursor, "limit" to limit, "status" to status), WarrantiesListResponse.serializer())
}

@Serializable
data class WarrantiesListResponse(
    val items: List<Warranty>,
    val nextCursor: String?,
)
