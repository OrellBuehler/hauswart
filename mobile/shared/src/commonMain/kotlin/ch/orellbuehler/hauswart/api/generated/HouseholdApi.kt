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

class HouseholdApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * The household's name, settings and time zone
     */
    suspend fun householdGet(): Household =
        http.json("GET", "/api/v1/household", emptyList(), Household.serializer())

    /**
     * Change the household's name, handover date or settings
     */
    suspend fun householdUpdate(
        body: HouseholdUpdateRequest,
    ): Household =
        http.json("PATCH", "/api/v1/household", emptyList(), HouseholdUpdateRequest.serializer(), body, Household.serializer())
}

@Serializable
data class HouseholdUpdateRequest(
    val name: String? = null,
    val currency: String? = null,
    /** date */
    val handoverDate: Patch<String> = Patch.Keep,
    val settings: HouseholdSettings? = null,
)
