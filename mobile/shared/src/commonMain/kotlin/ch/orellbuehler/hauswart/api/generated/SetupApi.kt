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

class SetupApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * Whether first-run setup is still open
     *
     * `needsSetup` is true until the first administrator account exists. `tokenRequired` is true while setup is open and the server was started with `HAUSWART_SETUP_TOKEN`: the setup request must then carry `setupToken`.
     */
    suspend fun setupStatus(): SetupStatusResponse =
        http.json("GET", "/api/v1/setup", emptyList(), SetupStatusResponse.serializer())

    /**
     * Create the first administrator and sign in
     *
     * Only works while no user exists (409 `setup_complete` afterwards). When the server runs with `HAUSWART_SETUP_TOKEN`, `setupToken` must match it (403 `forbidden`). Starts a browser session (sets the session cookie).
     */
    suspend fun setup(
        body: SetupRequest,
    ): SetupResponse =
        http.json("POST", "/api/v1/setup", emptyList(), SetupRequest.serializer(), body, SetupResponse.serializer())
}

@Serializable
data class SetupStatusResponse(
    val needsSetup: Boolean,
    val tokenRequired: Boolean,
)

@Serializable
data class SetupRequest(
    val username: String,
    val displayName: String,
    val password: String,
    /** de | en */
    val locale: String,
    val setupToken: String? = null,
) {
    companion object {
        val LOCALE_VALUES: List<String> = listOf("de", "en")
    }
}

@Serializable
data class SetupResponse(
    val user: User,
)
