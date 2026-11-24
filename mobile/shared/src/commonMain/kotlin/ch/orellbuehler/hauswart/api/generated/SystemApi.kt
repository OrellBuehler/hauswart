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

class SystemApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * Liveness probe
     */
    suspend fun health(): HealthResponse =
        http.json("GET", "/api/v1/health", emptyList(), HealthResponse.serializer())

    /**
     * OpenAPI document of this API
     */
    suspend fun openapi(): OpenapiResponse =
        http.json("GET", "/api/v1/openapi.json", emptyList(), OpenapiResponse.serializer())
}

@Serializable
data class HealthResponse(
    @EncodeDefault val status: String = "ok",
    val version: String,
)

@Serializable
data class OpenapiResponseInfo(
    val title: String,
    val version: String,
)

@Serializable
data class OpenapiResponse(
    val openapi: String,
    val info: OpenapiResponseInfo,
    val paths: JsonObject,
)
