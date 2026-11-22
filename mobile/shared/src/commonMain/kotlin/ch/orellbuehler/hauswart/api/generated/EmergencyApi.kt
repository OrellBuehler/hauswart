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

class EmergencyApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * Everything for the emergency page
     *
     * Pages of the sections `emergency` and `rules` (member HTML, secret blocks included), contacts marked as emergency contacts and devices marked `showOnEmergency` with their pinned hints.
     */
    suspend fun emergencyGet(): Emergency =
        http.json("GET", "/api/v1/emergency", emptyList(), Emergency.serializer())

    /**
     * Printable emergency and cover sheet as a PDF
     *
     * An A4 document with the emergency contacts, the important places and devices (with pinned hints) and the text of the emergency and rules pages. Secret blocks are left out unless `includeSecrets=1`; the sheet then carries a prominent confidentiality notice. Language follows the caller's account.
     *
     * @param includeSecrets 0 | 1 | true | false
     */
    suspend fun emergencyExport(
        includeSecrets: String? = null,
    ): BinaryBody =
        http.binary("GET", "/api/v1/emergency/export.pdf", listOf("includeSecrets" to includeSecrets))
}
