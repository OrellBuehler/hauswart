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

class UsersApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * Names of everyone in the household
     *
     * Id, display name and ownership share (`ownershipBps`, basis points of the shared costs the person bears; every member can read it from the frozen shares of the cost entries anyway), for assignee pickers, activity lines and split previews. Nothing else about a user. Needs the `read` scope (a token with other scopes only is refused, since the shares are money-related); a browser session has it.
     */
    suspend fun usersDirectory(): UsersDirectoryResponse =
        http.json("GET", "/api/v1/users/directory", emptyList(), UsersDirectoryResponse.serializer())
}

@Serializable
data class UsersDirectoryResponse(
    val items: List<DirectoryUser>,
    val nextCursor: String?,
)
